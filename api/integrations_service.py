"""
Business logic for the cloud-storage integrations API (Dropbox, Google Drive).

NEVER returns secrets (client secret, access/refresh tokens) - metadata only.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

from loguru import logger
from pydantic import SecretStr

from api.credentials_service import require_encryption_key
from api.models import (
    BrowseResponse,
    GoogleExportFormats,
    IntegrationAccountResponse,
    IntegrationProviderResponse,
    IntegrationProviderUpdate,
    IntegrationSettingsResponse,
    IntegrationSettingsUpdate,
    LinkImportRequest,
    LinkImportResponse,
    RemoteItemResponse,
    SourceCloudInfoResponse,
    SyncedFileResponse,
    SyncLinkResponse,
    SyncLinkUpdate,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.integration import (
    PROVIDER_NAMES,
    IntegrationAccount,
    IntegrationProviderApp,
    IntegrationSettings,
    SyncedFile,
    SyncLink,
)
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.domain.transformation import Transformation
from open_notebook.exceptions import (
    ConfigurationError,
    InvalidInputError,
    NotFoundError,
)
from open_notebook.integrations import registry
from open_notebook.integrations.base import StorageProvider, is_virtual
from open_notebook.integrations.oauth_state import sign_state, verify_state
from open_notebook.integrations.scheduler import enqueue_sync, scheduler_forced_off
from open_notebook.integrations.tokens import get_valid_access_token


class ManagedByEnvironmentError(InvalidInputError):
    """The setting is pinned by an environment variable and is read-only."""


def _require_key() -> None:
    try:
        require_encryption_key()
    except ValueError as e:
        raise ConfigurationError(str(e))


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


# =============================================================================
# Provider app credentials
# =============================================================================


async def _provider_response(
    provider: str, public_url: Optional[str]
) -> IntegrationProviderResponse:
    cls = registry.provider_class(provider)
    config = await registry.resolve_app_config(provider)
    return IntegrationProviderResponse(
        provider=provider,  # type: ignore[arg-type]
        display_name=cls.display_name,
        configured=config.configured,
        config_source=config.source,
        client_id=config.client_id,
        has_secret=bool(config.client_secret),
        redirect_uri=registry.redirect_uri(public_url, provider),
        console_url=cls.console_url,
    )


async def _public_url() -> Optional[str]:
    settings = await IntegrationSettings.load_fresh()
    return registry.resolve_public_url(settings)[0]


async def list_providers() -> List[IntegrationProviderResponse]:
    public_url = await _public_url()
    return [await _provider_response(p, public_url) for p in PROVIDER_NAMES]


async def get_provider_response(provider: str) -> IntegrationProviderResponse:
    registry.validate_provider_name(provider)
    return await _provider_response(provider, await _public_url())


async def save_provider_app(
    provider: str, update: IntegrationProviderUpdate
) -> IntegrationProviderResponse:
    registry.validate_provider_name(provider)
    if registry.env_app_config(provider):
        raise ManagedByEnvironmentError(
            "This provider is configured through environment variables."
        )
    _require_key()
    app = await IntegrationProviderApp.get_by_provider(provider)
    secret = update.client_secret.strip() if update.client_secret else None
    if app is None:
        if not secret:
            raise InvalidInputError("Client secret is required")
        app = IntegrationProviderApp(provider=provider, client_id=update.client_id.strip())
    app.client_id = update.client_id.strip()
    if secret:
        app.client_secret = SecretStr(secret)
    await app.save()
    return await get_provider_response(provider)


async def delete_provider_app(provider: str) -> None:
    registry.validate_provider_name(provider)
    if registry.env_app_config(provider):
        raise ManagedByEnvironmentError(
            "This provider is configured through environment variables."
        )
    app = await IntegrationProviderApp.get_by_provider(provider)
    if app:
        await app.delete()


# =============================================================================
# Global settings
# =============================================================================


def _settings_response(settings: IntegrationSettings) -> IntegrationSettingsResponse:
    public_url, source = registry.resolve_public_url(settings)
    formats = settings.google_export_formats or {}
    return IntegrationSettingsResponse(
        public_url=public_url,
        public_url_source=source,
        scheduler_enabled=settings.scheduler_enabled,
        scheduler_forced_off=scheduler_forced_off(),
        default_interval_minutes=settings.default_interval_minutes,
        max_file_mb=settings.max_file_mb,
        allowed_extensions=settings.allowed_extensions,
        google_export_formats=GoogleExportFormats(**formats),
    )


async def get_settings() -> IntegrationSettingsResponse:
    return _settings_response(await IntegrationSettings.load_fresh())


async def update_settings(update: IntegrationSettingsUpdate) -> IntegrationSettingsResponse:
    settings = await IntegrationSettings.load_fresh()
    fields = update.model_dump(exclude_unset=True)
    if "public_url" in fields:
        if registry.resolve_public_url(settings)[1] == "env":
            raise ManagedByEnvironmentError(
                f"The public URL is set by {registry.PUBLIC_URL_ENV}."
            )
        settings.public_url = registry.normalize_public_url(fields.pop("public_url"))
    if fields.get("google_export_formats") is not None:
        settings.google_export_formats = dict(fields.pop("google_export_formats"))
    for key, value in fields.items():
        if value is not None:
            setattr(settings, key, value)
    await settings.update()
    return _settings_response(await IntegrationSettings.load_fresh())


# =============================================================================
# OAuth
# =============================================================================


async def start_authorize(provider: str) -> str:
    registry.validate_provider_name(provider)
    public_url = await _public_url()
    if not public_url:
        raise ConfigurationError(
            "Set the public URL in Settings → Integrations before connecting an account."
        )
    _require_key()
    connector = await registry.get_provider(provider)
    return connector.authorize_url(
        sign_state(provider), registry.redirect_uri(public_url, provider) or ""
    )


def _settings_redirect(public_url: Optional[str], params: Dict[str, str]) -> str:
    base = public_url or ""
    return f"{base}/settings/integrations?{urlencode(params)}"


async def complete_authorize(
    provider: str,
    code: Optional[str],
    state: Optional[str],
    error: Optional[str],
) -> str:
    """Finish the OAuth flow and return the URL to redirect the browser to."""
    public_url = await _public_url()
    try:
        registry.validate_provider_name(provider)
        if error:
            raise InvalidInputError(f"Authorization was not granted ({error})")
        if not code or not state:
            raise InvalidInputError("Missing authorization code")
        verify_state(state, provider)
        connector = await registry.get_provider(provider)
        tokens = await connector.exchange_code(
            code, registry.redirect_uri(public_url, provider) or ""
        )
        info = await connector.get_account(tokens.access_token)

        account = await IntegrationAccount.find_by_external_id(provider, info.external_id)
        if account is None:
            account = IntegrationAccount(provider=provider, name=info.name)
        account.name = info.name
        account.account_email = info.email
        account.external_account_id = info.external_id
        account.access_token = SecretStr(tokens.access_token)
        if tokens.refresh_token:
            account.refresh_token = SecretStr(tokens.refresh_token)
        account.token_expires_at = tokens.expires_at
        account.scopes = tokens.scopes
        await account.save()
        logger.info(f"Connected {provider} account {account.id}")
        return _settings_redirect(public_url, {"connected": provider})
    except Exception as e:
        logger.warning(f"OAuth callback for {provider} failed: {e}")
        message = str(e) if isinstance(e, (InvalidInputError, ConfigurationError)) else (
            "Could not complete the connection with the provider. Check the app "
            "credentials and the redirect URI."
        )
        return _settings_redirect(public_url, {"integration_error": message[:300]})


# =============================================================================
# Accounts & browsing
# =============================================================================


async def list_accounts() -> List[IntegrationAccountResponse]:
    rows = await repo_query(
        "SELECT id, provider, name, account_email, created, updated "
        "FROM integration_account ORDER BY created ASC"
    )
    counts = await repo_query("SELECT account, count() AS n FROM sync_link GROUP BY account")
    count_by_account = {str(c["account"]): c["n"] for c in counts}
    return [
        IntegrationAccountResponse(
            id=str(r["id"]),
            provider=r["provider"],
            name=r["name"],
            account_email=r.get("account_email"),
            sync_folder_count=count_by_account.get(str(r["id"]), 0),
            created=_iso(r.get("created")),
            updated=_iso(r.get("updated")),
        )
        for r in rows
    ]


async def delete_account(account_id: str) -> None:
    account = await IntegrationAccount.get(account_id)
    await account.delete()  # links and file mappings cascade (migration 26)


async def _connect(account: IntegrationAccount) -> Tuple[StorageProvider, str]:
    connector = await registry.get_provider(account.provider)
    return connector, await get_valid_access_token(account, connector)


async def browse(account_id: str, parent_id: Optional[str]) -> BrowseResponse:
    account = await IntegrationAccount.get(account_id)
    connector, token = await _connect(account)
    settings = await IntegrationSettings.load_fresh()
    path, folders, files = await connector.list_children(
        token, parent_id, settings.google_export_formats
    )
    items = [
        RemoteItemResponse(
            id=f.id, name=f.name, path=f.path, kind="folder", web_url=f.web_url,
            selectable=f.selectable,
        )
        for f in folders
    ] + [
        RemoteItemResponse(
            id=f.id,
            name=f.name,
            path=f.path,
            kind="file",
            size=f.size,
            modified_at=_iso(f.modified_at),
            mime_type=f.mime_type,
            extension=f.extension or None,
            eligible=settings.is_eligible(f.extension, f.size),
            web_url=f.web_url,
        )
        for f in files
    ]
    return BrowseResponse(
        parent_id=parent_id or connector.root_folder_id,
        path=path,
        selectable=not is_virtual(parent_id),
        items=items,
    )


# =============================================================================
# Links
# =============================================================================


async def _link_responses(links: List[SyncLink]) -> List[SyncLinkResponse]:
    if not links:
        return []
    accounts = await repo_query("SELECT id, name, provider FROM integration_account")
    account_by_id = {str(a["id"]): a for a in accounts}
    notebooks = await repo_query("SELECT id, name FROM notebook")
    notebook_names = {str(n["id"]): n.get("name") or "" for n in notebooks}
    # No `link IN $ids` filter: with the composite (link, remote_id) index
    # SurrealDB v2 returns no rows for it.
    counts = await repo_query(
        "SELECT link, count() AS n FROM synced_file WHERE source != NONE GROUP BY link"
    )
    count_by_link = {str(c["link"]): c["n"] for c in counts}

    responses = []
    for link in links:
        account = account_by_id.get(link.account, {})
        responses.append(
            SyncLinkResponse(
                id=str(link.id),
                account_id=link.account,
                provider=account.get("provider", "dropbox"),
                account_name=account.get("name", ""),
                kind=link.kind,
                remote_id=link.remote_id,
                remote_path=link.remote_path,
                name=link.name,
                web_url=link.web_url,
                notebook_ids=link.notebooks,
                notebook_names=[notebook_names.get(n, "") for n in link.notebooks],
                recursive=link.recursive,
                interval_minutes=link.interval_minutes,
                transformations=link.transformations,
                sync_enabled=link.sync_enabled,
                status=link.status,
                last_sync_at=_iso(link.last_sync_at),
                next_sync_at=_iso(link.next_sync_at),
                last_error=link.last_error,
                file_count=count_by_link.get(str(link.id), 0),
            )
        )
    return responses


async def list_links(notebook_id: Optional[str] = None) -> List[SyncLinkResponse]:
    if notebook_id:
        rows = await repo_query(
            "SELECT * FROM sync_link WHERE notebooks CONTAINS $notebook ORDER BY created ASC",
            {"notebook": ensure_record_id(notebook_id)},
        )
        links = [SyncLink(**row) for row in rows]
    else:
        links = await SyncLink.get_all(order_by="created asc")
    return await _link_responses(links)


async def get_link(link_id: str) -> SyncLinkResponse:
    return (await _link_responses([await SyncLink.get(link_id)]))[0]


async def _validate_notebooks(ids: List[str]) -> List[str]:
    validated: List[str] = []
    for notebook_id in ids:
        notebook = await Notebook.get(notebook_id)  # NotFoundError -> 404
        if str(notebook.id) not in validated:
            validated.append(str(notebook.id))
    return validated


async def _validate_transformations(ids: List[str]) -> List[str]:
    for transformation_id in ids:
        await Transformation.get(transformation_id)  # NotFoundError -> 404
    return ids


async def _relink_source(source_id: str, add: List[str], remove: List[str]) -> None:
    source = ensure_record_id(source_id)
    for notebook_id in remove:
        await repo_query(
            "DELETE reference WHERE in = $source AND out = $notebook",
            {"source": source, "notebook": ensure_record_id(notebook_id)},
        )
    for notebook_id in add:
        existing = await repo_query(
            "SELECT id FROM reference WHERE in = $source AND out = $notebook",
            {"source": source, "notebook": ensure_record_id(notebook_id)},
        )
        if not existing:
            await repo_query(
                "RELATE $source->reference->$notebook",
                {"source": source, "notebook": ensure_record_id(notebook_id)},
            )


async def _relink_sources(link: SyncLink, add: List[str], remove: List[str]) -> int:
    """Add/remove notebooks on every source imported by this link."""
    assert link.id
    count = 0
    for mapping in await SyncedFile.list_for_link(link.id):
        if mapping.source:
            await _relink_source(mapping.source, add, remove)
            count += 1
    return count


async def _queue(link_id: str) -> None:
    try:
        await enqueue_sync(link_id)
    except Exception as e:
        # The scheduler (or "sync now") will pick it up
        logger.warning(f"Could not queue sync for {link_id}: {e}")


async def import_links(data: LinkImportRequest) -> LinkImportResponse:
    account = await IntegrationAccount.get(data.account_id)
    assert account.id
    notebook_ids = await _validate_notebooks(data.notebook_ids)
    transformations = await _validate_transformations(data.transformations)
    connector, token = await _connect(account)
    settings = await IntegrationSettings.load_fresh()

    # Pass 1 - resolve every item without writing anything, so an invalid
    # item rejects the whole request instead of leaving a partial import.
    existing_links: List[SyncLink] = []
    reused_mappings: List[SyncedFile] = []
    new_links: List[SyncLink] = []
    for item in data.items:
        if is_virtual(item.remote_id):
            raise InvalidInputError(f"'{item.name}' is a grouping, pick the folders inside it")
        # Same remote item already linked: reuse it (no duplicate sources)
        existing = await SyncLink.find(account.id, item.remote_id)
        if existing:
            existing_links.append(existing)
            continue

        if item.kind == "file":
            # Already imported through a folder link of this account?
            # (account filtered in Python: SurrealDB v2 drops rows when this
            # WHERE also traverses `link.account` on the indexed table)
            rows = await repo_query(
                "SELECT *, link.account AS link_account FROM synced_file "
                "WHERE remote_id = $remote_id AND source != NONE",
                {"remote_id": item.remote_id},
            )
            rows = [r for r in rows if str(r.get("link_account")) == account.id]
            if rows:
                rows[0].pop("link_account", None)
                reused_mappings.append(SyncedFile(**rows[0]))
                continue
            remote = await connector.get_file(token, item.remote_id, settings.google_export_formats)
            if remote is None:
                raise InvalidInputError(f"'{item.name}' was not found or is not accessible")
            web_url = remote.web_url
        else:
            if not await connector.folder_exists(token, item.remote_id):
                raise InvalidInputError(f"'{item.name}' was not found or is not accessible")
            web_url = connector.folder_web_url(item.remote_id, item.remote_path)

        if any(link.remote_id == item.remote_id for link in new_links):
            continue  # same item twice in one request
        new_links.append(
            SyncLink(
                account=account.id,
                kind=item.kind,
                remote_id=item.remote_id,
                remote_path=item.remote_path,
                name=item.name,
                web_url=web_url,
                notebooks=notebook_ids,
                recursive=data.recursive,
                interval_minutes=data.interval_minutes or settings.default_interval_minutes,
                transformations=transformations,
                sync_enabled=data.sync_enabled,
            )
        )

    # Pass 2 - apply
    reused = 0
    for existing in existing_links:
        added = [n for n in notebook_ids if n not in existing.notebooks]
        if added:
            reused += await _relink_sources(existing, added, [])
            existing.notebooks = existing.notebooks + added
        if data.sync_enabled:
            existing.sync_enabled = True
        await existing.save()
    for mapping in reused_mappings:
        assert mapping.source
        await _relink_source(mapping.source, notebook_ids, [])
        reused += 1
    for link in new_links:
        await link.save()
    links = existing_links + new_links

    # First import (or refresh) of every link, whether it stays in sync or not
    for link in links:
        await _queue(str(link.id))
    refreshed = [await SyncLink.get(str(link.id)) for link in links]
    return LinkImportResponse(links=await _link_responses(refreshed), reused_sources=reused)


async def update_link(link_id: str, data: SyncLinkUpdate) -> SyncLinkResponse:
    link = await SyncLink.get(link_id)
    fields = data.model_dump(exclude_unset=True)
    if fields.get("notebook_ids") is not None:
        new_ids = await _validate_notebooks(fields["notebook_ids"])
        added = [n for n in new_ids if n not in link.notebooks]
        removed = [n for n in link.notebooks if n not in new_ids]
        if added or removed:
            await _relink_sources(link, added, removed)
        link.notebooks = new_ids
    if fields.get("transformations") is not None:
        link.transformations = await _validate_transformations(fields["transformations"])
    for key in ("recursive", "interval_minutes", "sync_enabled"):
        if fields.get(key) is not None:
            setattr(link, key, fields[key])
    await link.save()
    return await get_link(link_id)


async def delete_link(link_id: str) -> None:
    link = await SyncLink.get(link_id)
    await link.delete()  # mappings cascade; imported sources stay as regular sources


async def trigger_sync(link_id: str) -> Optional[str]:
    await SyncLink.get(link_id)
    return await enqueue_sync(link_id)


# =============================================================================
# Files of a link
# =============================================================================


def _file_response(m: SyncedFile) -> SyncedFileResponse:
    return SyncedFileResponse(
        id=str(m.id),
        link_id=m.link,
        remote_id=m.remote_id,
        name=m.name,
        path=m.remote_path,
        source_id=m.source,
        status=m.status,
        sync_enabled=m.sync_enabled,
        last_error=m.last_error,
        remote_modified_at=_iso(m.remote_modified_at),
        updated=_iso(m.updated),
        web_url=m.web_url,
    )


async def list_link_files(link_id: str) -> List[SyncedFileResponse]:
    await SyncLink.get(link_id)
    return [_file_response(m) for m in await SyncedFile.list_for_link(link_id)]


async def set_file_sync(file_id: str, enabled: bool) -> SyncedFileResponse:
    mapping = await SyncedFile.get(file_id)
    mapping.sync_enabled = enabled
    await mapping.save()
    return _file_response(mapping)


async def exclude_file(file_id: str, delete_source: bool) -> SyncedFileResponse:
    """Never import this file again. Its source is deleted, or kept frozen."""
    mapping = await SyncedFile.get(file_id)
    if delete_source and mapping.source:
        try:
            await (await Source.get(mapping.source)).delete()
        except NotFoundError:
            pass
        mapping.source = None
    mapping.status = "excluded"
    mapping.last_error = None
    await mapping.save()
    return _file_response(mapping)


async def include_file(file_id: str) -> SyncedFileResponse:
    """Undo an exclusion: the next sync imports (or refreshes) the file."""
    mapping = await SyncedFile.get(file_id)
    mapping.status = "synced"
    mapping.sync_enabled = True
    mapping.last_error = None
    # Forget the revision so the next sync treats the file as changed
    mapping.remote_revision = None
    mapping.content_hash = None
    await mapping.save()
    return _file_response(mapping)


# =============================================================================
# Per-source view (source cards and detail)
# =============================================================================


def _cloud_info(
    mapping: Dict[str, Any], link: Dict[str, Any], account: Dict[str, Any]
) -> SourceCloudInfoResponse:
    link_enabled = bool(link.get("sync_enabled", True))
    file_enabled = bool(mapping.get("sync_enabled", True))
    return SourceCloudInfoResponse(
        source_id=str(mapping["source"]),
        provider=account.get("provider", "dropbox"),
        account_name=account.get("name", ""),
        link_id=str(link["id"]),
        link_kind=link.get("kind", "folder"),
        link_name=link.get("name", ""),
        synced_file_id=str(mapping["id"]),
        sync_enabled=link_enabled and file_enabled and mapping.get("status") != "excluded",
        link_sync_enabled=link_enabled,
        file_sync_enabled=file_enabled,
        file_status=mapping.get("status", "synced"),
        link_status=link.get("status", "idle"),
        last_sync_at=_iso(link.get("last_sync_at")),
        last_error=mapping.get("last_error") or link.get("last_error"),
        remote_path=mapping.get("remote_path"),
        web_url=mapping.get("web_url"),
    )


async def source_map() -> Dict[str, SourceCloudInfoResponse]:
    mappings = await repo_query("SELECT * FROM synced_file WHERE source != NONE")
    if not mappings:
        return {}
    links = {str(r["id"]): r for r in await repo_query("SELECT * FROM sync_link")}
    accounts = {
        str(a["id"]): a
        for a in await repo_query("SELECT id, name, provider FROM integration_account")
    }
    result: Dict[str, SourceCloudInfoResponse] = {}
    for mapping in mappings:
        link = links.get(str(mapping["link"]))
        if not link:
            continue
        info = _cloud_info(mapping, link, accounts.get(str(link["account"]), {}))
        result[info.source_id] = info
    return result


async def _source_context(source_id: str) -> Tuple[SyncedFile, SyncLink]:
    mapping = await SyncedFile.find_by_source(source_id)
    if not mapping:
        raise NotFoundError("This source was not imported from cloud storage")
    return mapping, await SyncLink.get(mapping.link)


async def get_source_info(source_id: str) -> SourceCloudInfoResponse:
    mapping, link = await _source_context(source_id)
    account = await repo_query(
        "SELECT id, name, provider FROM $id", {"id": ensure_record_id(link.account)}
    )
    return _cloud_info(
        mapping.model_dump(), link.model_dump(), account[0] if account else {}
    )


async def set_source_sync(source_id: str, enabled: bool) -> SourceCloudInfoResponse:
    """A single-file link toggles the link; a file from a folder only itself."""
    mapping, link = await _source_context(source_id)
    if link.kind == "file":
        link.sync_enabled = enabled
        await link.save()
        if enabled and not mapping.sync_enabled:
            mapping.sync_enabled = True
            await mapping.save()
    else:
        mapping.sync_enabled = enabled
        await mapping.save()
    return await get_source_info(source_id)


async def trigger_source_sync(source_id: str) -> Optional[str]:
    _, link = await _source_context(source_id)
    return await enqueue_sync(str(link.id))
