"""
Link sync: diff a linked remote folder (or single file) against what was
imported and apply it.

- new remote file          -> new source, added to the link's notebooks
                              (none = general sources)
- changed remote file      -> the same source is re-processed in place
                              (file replaced, insights regenerated, re-embedded)
- renamed only             -> source title updated (no re-processing)
- remote file gone         -> source deleted
- source deleted by user   -> mapping kept as 'ignored', re-imported only if
                              the remote file changes
- file sync switched off   -> source frozen: never updated nor deleted
- file excluded            -> never imported again

The diff (`plan_sync`) is a pure function; `run_sync` performs it.
"""

import asyncio
import os
import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from content_core import check_file_support
from loguru import logger
from surreal_commands import submit_command

from open_notebook.config import UPLOADS_FOLDER
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.content_settings import ContentSettings
from open_notebook.domain.integration import (
    IntegrationAccount,
    IntegrationSettings,
    SyncedFile,
    SyncLink,
    utcnow,
)
from open_notebook.domain.notebook import Asset, Source
from open_notebook.exceptions import ConfigurationError, NotFoundError
from open_notebook.integrations.base import (
    ProviderAuthError,
    RemoteFile,
    RemoteNotFoundError,
    StorageProvider,
)
from open_notebook.integrations.registry import get_provider
from open_notebook.integrations.tokens import get_valid_access_token
from open_notebook.utils.notebook_transformations import (
    merge_transformation_ids,
    notebook_default_transformations,
)
from open_notebook.utils.uploads import generate_unique_filename

MAX_ERROR_LENGTH = 1000


# =============================================================================
# Planning (pure)
# =============================================================================


@dataclass
class SyncPlan:
    # (remote file, existing mapping if any: ignored/errored/unsupported rows)
    new: List[Tuple[RemoteFile, Optional[SyncedFile]]] = field(default_factory=list)
    changed: List[Tuple[RemoteFile, SyncedFile]] = field(default_factory=list)
    renamed: List[Tuple[RemoteFile, SyncedFile]] = field(default_factory=list)
    removed: List[SyncedFile] = field(default_factory=list)
    # not eligible (extension/size filters) and never imported
    skipped: List[RemoteFile] = field(default_factory=list)
    unchanged: int = 0
    frozen: int = 0


def content_changed(remote: RemoteFile, synced: SyncedFile) -> bool:
    # Prefer the content hash: Drive's `version` also bumps on metadata edits
    if remote.content_hash and synced.content_hash:
        return remote.content_hash != synced.content_hash
    return remote.revision != synced.remote_revision


def plan_sync(
    remote_files: List[RemoteFile],
    synced_files: List[SyncedFile],
    is_eligible: Callable[[RemoteFile], bool],
) -> SyncPlan:
    plan = SyncPlan()
    by_remote_id: Dict[str, SyncedFile] = {s.remote_id: s for s in synced_files}

    for remote in remote_files:
        synced = by_remote_id.pop(remote.id, None)
        if synced is not None and synced.status == "excluded":
            plan.unchanged += 1
            continue
        if synced is not None and not synced.sync_enabled and synced.source:
            plan.frozen += 1
            continue
        if not is_eligible(remote):
            # Filters apply to what gets imported; they never delete sources
            # already imported (changing a filter is not a remote deletion).
            if synced is None:
                plan.skipped.append(remote)
            else:
                plan.unchanged += 1
            continue
        if synced is None:
            plan.new.append((remote, None))
        elif synced.status == "error":
            # Retried every run: errors are usually transient (network, quota)
            if synced.source:
                plan.changed.append((remote, synced))
            else:
                plan.new.append((remote, synced))
        elif synced.status in ("ignored", "unsupported") or not synced.source:
            if content_changed(remote, synced):
                plan.new.append((remote, synced))
            else:
                plan.unchanged += 1
        elif content_changed(remote, synced):
            plan.changed.append((remote, synced))
        elif remote.name != synced.name:
            plan.renamed.append((remote, synced))
        else:
            plan.unchanged += 1

    for synced in by_remote_id.values():
        if synced.source and (not synced.sync_enabled or synced.status == "excluded"):
            plan.frozen += 1  # frozen/excluded sources survive a remote deletion
        else:
            plan.removed.append(synced)
    return plan


# =============================================================================
# Execution
# =============================================================================


@dataclass
class SyncResult:
    skipped_reason: Optional[str] = None
    created: int = 0
    updated: int = 0
    renamed: int = 0
    deleted: int = 0
    unsupported: int = 0
    deferred: int = 0
    failed: int = 0
    errors: List[str] = field(default_factory=list)


class SyncAborted(Exception):
    """Permanent problem with the link/account: record it, don't retry."""


def _short(error: BaseException | str) -> str:
    return str(error)[:MAX_ERROR_LENGTH]


def _within_uploads(path: str) -> bool:
    root = os.path.realpath(UPLOADS_FOLDER)
    return os.path.realpath(path).startswith(root + os.sep)


async def _submit_processing(
    source: Source,
    file_path: str,
    notebook_ids: List[str],
    transformations: List[str],
    delete_source: bool,
) -> str:
    """Queue `process_source` for an existing source record (same contract as
    the upload and retry endpoints)."""
    args = {
        "source_id": str(source.id),
        "content_state": {"file_path": file_path, "delete_source": delete_source},
        "notebook_ids": notebook_ids,
        "transformations": transformations,
        "embed": True,
    }
    command_id = await asyncio.to_thread(
        submit_command, "open_notebook", "process_source", args
    )
    source.command = ensure_record_id(str(command_id))
    await source.save()
    return str(command_id)


async def _download_checked(
    provider: StorageProvider, token: str, remote: RemoteFile, dest_path: str
) -> Optional[str]:
    """Download to dest_path; return None if supported, else the reason.
    The file is removed on failure or when unsupported."""
    try:
        await provider.download(token, remote, dest_path)
    except BaseException:
        Path(dest_path).unlink(missing_ok=True)
        raise
    try:
        support = await check_file_support(dest_path)
    except Exception as e:
        # Same policy as the upload endpoint: never reject on a failed
        # pre-flight check, real extraction will surface the problem.
        logger.debug(f"File-support check skipped for {dest_path}: {e}")
        return None
    if not support.supported:
        Path(dest_path).unlink(missing_ok=True)
        reason = support.reason or "Unsupported file type"
        if support.identified_type:
            reason = f"{reason} (detected type: {support.identified_type})"
        return reason
    return None


def _apply_remote(mapping: SyncedFile, remote: RemoteFile) -> None:
    mapping.name = remote.name
    mapping.remote_path = remote.path
    mapping.remote_revision = remote.revision
    mapping.content_hash = remote.content_hash
    mapping.remote_modified_at = remote.modified_at
    mapping.web_url = remote.web_url


class _LinkSync:
    def __init__(
        self,
        link: SyncLink,
        provider: StorageProvider,
        token: str,
        delete_source_files: bool,
        result: SyncResult,
    ):
        self.link = link
        self.provider = provider
        self.token = token
        self.delete_source_files = delete_source_files
        self.result = result

    async def _transformations(self) -> List[str]:
        """The link's transformations plus its notebooks' defaults."""
        return merge_transformation_ids(
            self.link.transformations,
            await notebook_default_transformations(self.link.notebooks),
        )

    def _mapping(self, remote: RemoteFile, existing: Optional[SyncedFile]) -> SyncedFile:
        if existing:
            return existing
        assert self.link.id
        return SyncedFile(link=self.link.id, remote_id=remote.id, name=remote.name)

    async def _mark(
        self,
        remote: RemoteFile,
        existing: Optional[SyncedFile],
        status: str,
        error: Optional[str],
        record_revision: bool,
    ) -> None:
        mapping = self._mapping(remote, existing)
        if record_revision:
            _apply_remote(mapping, remote)
        mapping.name = remote.name
        mapping.status = status  # type: ignore[assignment]
        mapping.last_error = error
        await mapping.save()

    async def import_new(self, remote: RemoteFile, existing: Optional[SyncedFile]) -> None:
        dest = await asyncio.to_thread(
            generate_unique_filename, remote.local_name, UPLOADS_FOLDER
        )
        reason = await _download_checked(self.provider, self.token, remote, dest)
        if reason:
            self.result.unsupported += 1
            # Record the revision so it is not retried until the file changes
            await self._mark(remote, existing, "unsupported", reason, record_revision=True)
            return

        source = Source(title=remote.name, topics=[], asset=Asset(file_path=dest))
        try:
            await source.save()
        except BaseException:
            Path(dest).unlink(missing_ok=True)
            raise
        try:
            for notebook_id in self.link.notebooks:
                await source.add_to_notebook(notebook_id)
            await _submit_processing(
                source,
                dest,
                self.link.notebooks,
                await self._transformations(),
                self.delete_source_files,
            )
        except BaseException:
            await source.delete()  # also removes the downloaded file
            raise

        mapping = self._mapping(remote, existing)
        _apply_remote(mapping, remote)
        mapping.source = str(source.id)
        mapping.status = "synced"
        mapping.last_error = None
        await mapping.save()
        self.result.created += 1

    async def update_changed(self, remote: RemoteFile, mapping: SyncedFile) -> None:
        assert mapping.source
        try:
            source = await Source.get(mapping.source)
        except NotFoundError:
            mapping.source = None
            await self.import_new(remote, mapping)
            return

        if await source.get_status() in ("new", "queued", "running"):
            # Previous processing still in flight; pick the change up next run
            self.result.deferred += 1
            return

        current = source.asset.file_path if source.asset else None
        same_type = (
            current is not None
            and _within_uploads(current)
            and Path(current).suffix.lower() == Path(remote.local_name).suffix.lower()
        )
        target = (
            current
            if same_type and current
            else await asyncio.to_thread(
                generate_unique_filename, remote.local_name, UPLOADS_FOLDER
            )
        )
        # Download next to the target, then swap atomically: a failed download
        # never leaves the source pointing at a half-written file.
        tmp = os.path.join(
            os.path.dirname(target), f".sync-{uuid.uuid4().hex}-{os.path.basename(target)}"
        )
        reason = await _download_checked(self.provider, self.token, remote, tmp)
        if reason:
            if not same_type:
                Path(target).unlink(missing_ok=True)
            self.result.unsupported += 1
            mapping.last_error = reason
            _apply_remote(mapping, remote)
            await mapping.save()
            return
        os.replace(tmp, target)
        if current and not same_type and _within_uploads(current):
            Path(current).unlink(missing_ok=True)

        # Re-processing would otherwise pile new insights onto the old ones
        await repo_query(
            "DELETE source_insight WHERE source = $source_id",
            {"source_id": ensure_record_id(str(source.id))},
        )
        if source.title == mapping.name:  # keep titles the user edited
            source.title = remote.name
        source.asset = Asset(file_path=target)
        await source.save()
        await _submit_processing(
            source,
            target,
            self.link.notebooks,
            await self._transformations(),
            self.delete_source_files,
        )

        _apply_remote(mapping, remote)
        mapping.status = "synced"
        mapping.last_error = None
        await mapping.save()
        self.result.updated += 1

    async def rename(self, remote: RemoteFile, mapping: SyncedFile) -> None:
        assert mapping.source
        try:
            source = await Source.get(mapping.source)
            if source.title == mapping.name:
                source.title = remote.name
                await source.save()
        except NotFoundError:
            pass
        mapping.name = remote.name
        mapping.remote_path = remote.path
        mapping.remote_revision = remote.revision
        mapping.web_url = remote.web_url
        await mapping.save()
        self.result.renamed += 1

    async def remove(self, mapping: SyncedFile) -> None:
        if mapping.source:
            try:
                source = await Source.get(mapping.source)
                await source.delete()
                self.result.deleted += 1
            except NotFoundError:
                pass
        await mapping.delete()

    async def record_skipped(self, remote: RemoteFile) -> None:
        await self._mark(
            remote, None, "unsupported", "Excluded by the extension or size filter",
            record_revision=True,
        )


async def _set_link_state(link_id: str, **fields) -> None:
    await repo_query(
        "UPDATE $id MERGE $data", {"id": ensure_record_id(link_id), "data": fields}
    )


async def _acquire(link_id: str) -> bool:
    rows = await repo_query(
        "UPDATE $id SET status = 'running', status_changed_at = time::now() "
        "WHERE status != 'running' RETURN AFTER",
        {"id": ensure_record_id(link_id)},
    )
    return bool(rows)


async def _list_remote(
    provider: StorageProvider, token: str, link: SyncLink, export_formats: Dict[str, str]
) -> List[RemoteFile]:
    if link.kind == "file":
        # A missing single file is a remote deletion (auth problems raise instead)
        remote = await provider.get_file(token, link.remote_id, export_formats)
        return [remote] if remote else []
    # Guard against mass deletion: if the folder is gone, inaccessible or the
    # account revoked, stop before computing removals.
    if not await provider.folder_exists(token, link.remote_id):
        raise SyncAborted(
            f"Remote folder '{link.remote_path}' was not found or is no longer "
            "accessible. No sources were deleted."
        )
    return await provider.list_files(token, link.remote_id, link.recursive, export_formats)


async def run_sync(link_id: str) -> SyncResult:
    result = SyncResult()
    try:
        link = await SyncLink.get(link_id)
    except NotFoundError:
        result.skipped_reason = "Link no longer exists"
        return result
    if not await _acquire(link_id):
        result.skipped_reason = "Sync already running"
        return result

    error: Optional[str] = None
    try:
        account = await IntegrationAccount.get(link.account)
        provider = await get_provider(account.provider)
        token = await get_valid_access_token(account, provider)
        settings = await IntegrationSettings.load_fresh()
        content_settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]

        remote_files = await _list_remote(provider, token, link, settings.google_export_formats)
        if link.kind == "file" and remote_files and remote_files[0].name != link.name:
            await _set_link_state(link_id, name=remote_files[0].name)
        assert link.id
        synced_files = await SyncedFile.list_for_link(link.id)
        plan = plan_sync(
            remote_files,
            synced_files,
            lambda f: settings.is_eligible(f.extension, f.size),
        )
        logger.info(
            f"Sync {link.id}: {len(plan.new)} new, {len(plan.changed)} changed, "
            f"{len(plan.renamed)} renamed, {len(plan.removed)} removed, "
            f"{plan.unchanged} unchanged, {plan.frozen} frozen"
        )

        runner = _LinkSync(
            link,
            provider,
            token,
            delete_source_files=content_settings.auto_delete_files == "yes",
            result=result,
        )

        async def guarded(label: str, remote: Optional[RemoteFile], mapping, coro):
            try:
                await coro
            except (ProviderAuthError, ConfigurationError):
                raise  # account-level: abort the whole run
            except Exception as e:
                result.failed += 1
                result.errors.append(f"{label}: {_short(e)}")
                logger.warning(f"Sync {link.id} failed on {label}: {e}")
                if remote is not None:
                    try:
                        await runner._mark(remote, mapping, "error", _short(e), record_revision=False)
                    except Exception as mark_error:
                        logger.warning(f"Could not record sync error: {mark_error}")

        for remote, existing in plan.new:
            await guarded(remote.path, remote, existing, runner.import_new(remote, existing))
        for remote, mapping in plan.changed:
            await guarded(remote.path, remote, mapping, runner.update_changed(remote, mapping))
        for remote, mapping in plan.renamed:
            await guarded(remote.path, remote, mapping, runner.rename(remote, mapping))
        for mapping in plan.removed:
            await guarded(mapping.remote_path or mapping.name, None, None, runner.remove(mapping))
        for remote in plan.skipped:
            await guarded(remote.path, remote, None, runner.record_skipped(remote))

        if result.failed:
            error = f"{result.failed} file(s) failed: " + "; ".join(result.errors[:3])
        return result
    except (SyncAborted, ProviderAuthError, RemoteNotFoundError, ConfigurationError, NotFoundError) as e:
        error = _short(e)
        result.skipped_reason = error
        return result
    except BaseException as e:
        # Transient (network, provider 5xx, DB conflict): surfaced, then retried
        error = _short(e)
        raise
    finally:
        now = utcnow()
        await _set_link_state(
            link_id,
            status="error" if error else "idle",
            last_error=error,
            last_sync_at=now,
            next_sync_at=now + timedelta(minutes=max(link.interval_minutes, 1)),
            status_changed_at=now,
        )
