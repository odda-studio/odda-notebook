"""Tests for cloud-storage sync: planning, OAuth state, config resolution,
token refresh, connectors (httpx.MockTransport) and the sync runner."""

import json
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from pydantic import SecretStr

from open_notebook.domain.integration import (
    IntegrationAccount,
    IntegrationProviderApp,
    IntegrationSettings,
    SyncedFile,
    SyncLink,
)
from open_notebook.exceptions import ConfigurationError, InvalidInputError
from open_notebook.integrations import oauth_state, registry, sync
from open_notebook.integrations.base import RemoteFile, TokenSet
from open_notebook.integrations.dropbox import DropboxProvider
from open_notebook.integrations.google_drive import GoogleDriveProvider
from open_notebook.integrations.tokens import get_valid_access_token


def remote(id="f1", name="a.pdf", revision="r1", content_hash=None, size=10):
    return RemoteFile(
        id=id, name=name, path=f"/{name}", revision=revision,
        content_hash=content_hash, size=size,
    )


def mapping(remote_id="f1", name="a.pdf", revision="r1", content_hash=None,
            status="synced", source="source:1", sync_enabled=True):
    return SyncedFile(
        link="sync_link:1", remote_id=remote_id, name=name,
        remote_revision=revision, content_hash=content_hash, status=status, source=source,
        sync_enabled=sync_enabled,
    )


def everything(_):
    return True


@pytest.fixture
def encryption_key(monkeypatch):
    monkeypatch.setenv("OPEN_NOTEBOOK_ENCRYPTION_KEY", "test-key")


# =============================================================================
# plan_sync
# =============================================================================


class TestPlanSync:
    def test_new_changed_unchanged_removed(self):
        plan = sync.plan_sync(
            [remote("new"), remote("chg", revision="r2"), remote("same")],
            [mapping("chg"), mapping("same"), mapping("gone")],
            everything,
        )
        assert [r.id for r, _ in plan.new] == ["new"]
        assert [r.id for r, _ in plan.changed] == ["chg"]
        assert [m.remote_id for m in plan.removed] == ["gone"]
        assert plan.unchanged == 1

    def test_hash_wins_over_revision(self):
        # Drive bumps `version` on metadata-only edits: same md5 = no reprocess
        plan = sync.plan_sync(
            [remote(revision="r2", content_hash="h1")],
            [mapping(content_hash="h1")],
            everything,
        )
        assert not plan.changed and plan.unchanged == 1

    def test_rename_without_content_change(self):
        plan = sync.plan_sync([remote(name="b.pdf")], [mapping(name="a.pdf")], everything)
        assert [r.name for r, _ in plan.renamed] == ["b.pdf"]
        assert not plan.changed

    def test_ignored_file_is_not_reimported_until_it_changes(self):
        ignored = mapping(status="ignored", source=None)
        assert sync.plan_sync([remote()], [ignored], everything).unchanged == 1
        plan = sync.plan_sync([remote(revision="r2")], [ignored], everything)
        assert plan.new == [(plan.new[0][0], ignored)]

    def test_unsupported_waits_for_a_new_revision(self):
        unsupported = mapping(status="unsupported", source=None)
        assert sync.plan_sync([remote()], [unsupported], everything).unchanged == 1
        assert len(sync.plan_sync([remote(revision="r2")], [unsupported], everything).new) == 1

    def test_errors_are_retried(self):
        with_source = sync.plan_sync([remote()], [mapping(status="error")], everything)
        assert len(with_source.changed) == 1
        without = sync.plan_sync([remote()], [mapping(status="error", source=None)], everything)
        assert len(without.new) == 1

    def test_frozen_file_is_neither_updated_nor_deleted(self):
        frozen = mapping(sync_enabled=False)
        plan = sync.plan_sync([remote(revision="r2", name="b.pdf")], [frozen], everything)
        assert not plan.changed and not plan.renamed and plan.frozen == 1
        gone = sync.plan_sync([], [mapping(sync_enabled=False)], everything)
        assert not gone.removed and gone.frozen == 1

    def test_excluded_file_is_never_imported_nor_deleted(self):
        detached = mapping(status="excluded", source=None)
        plan = sync.plan_sync([remote(revision="r9")], [detached], everything)
        assert not plan.new and not plan.changed
        kept = sync.plan_sync([], [mapping(status="excluded")], everything)
        assert not kept.removed  # its (kept) source survives
        cleanup = sync.plan_sync([], [detached], everything)
        assert cleanup.removed == [detached]  # mapping without source is dropped

    def test_filters_never_delete_imported_sources(self):
        plan = sync.plan_sync(
            [remote("old"), remote("fresh")],
            [mapping("old")],
            lambda f: False,
        )
        assert not plan.removed
        assert [r.id for r in plan.skipped] == ["fresh"]


def test_settings_eligibility():
    settings = IntegrationSettings.model_construct(
        allowed_extensions=["pdf", ".DOCX"], max_file_mb=1
    )
    assert IntegrationSettings.is_eligible(settings, "PDF", 100)
    assert IntegrationSettings.is_eligible(settings, "docx", None)
    assert not IntegrationSettings.is_eligible(settings, "exe", 1)
    assert not IntegrationSettings.is_eligible(settings, "pdf", 2 * 1024 * 1024)


# =============================================================================
# OAuth state
# =============================================================================


class TestOAuthState:
    def test_roundtrip(self, encryption_key):
        oauth_state.verify_state(oauth_state.sign_state("dropbox"), "dropbox")

    def test_tampered(self, encryption_key):
        state = oauth_state.sign_state("dropbox")
        payload, signature = state.split(".")
        with pytest.raises(InvalidInputError):
            oauth_state.verify_state(f"{payload}x.{signature}", "dropbox")
        with pytest.raises(InvalidInputError):
            oauth_state.verify_state("garbage", "dropbox")

    def test_wrong_provider(self, encryption_key):
        with pytest.raises(InvalidInputError):
            oauth_state.verify_state(oauth_state.sign_state("dropbox"), "google_drive")

    def test_expired(self, encryption_key):
        state = oauth_state.sign_state("dropbox", now=0)
        with pytest.raises(InvalidInputError, match="expired"):
            oauth_state.verify_state(state, "dropbox", now=oauth_state.STATE_TTL_SECONDS + 1)

    def test_other_key_rejects(self, monkeypatch, encryption_key):
        state = oauth_state.sign_state("dropbox")
        monkeypatch.setenv("OPEN_NOTEBOOK_ENCRYPTION_KEY", "another-key")
        with pytest.raises(InvalidInputError):
            oauth_state.verify_state(state, "dropbox")

    def test_requires_key(self, monkeypatch):
        monkeypatch.delenv("OPEN_NOTEBOOK_ENCRYPTION_KEY", raising=False)
        monkeypatch.delenv("OPEN_NOTEBOOK_ENCRYPTION_KEY_FILE", raising=False)
        with pytest.raises(ConfigurationError):
            oauth_state.sign_state("dropbox")


# =============================================================================
# Registry / config resolution
# =============================================================================


class TestRegistry:
    @pytest.mark.asyncio
    async def test_env_takes_precedence_over_db(self, monkeypatch, encryption_key):
        monkeypatch.setenv("DROPBOX_APP_KEY", "env-key")
        monkeypatch.setenv("DROPBOX_APP_SECRET", "env-secret")
        db_app = IntegrationProviderApp(
            provider="dropbox", client_id="db-key", client_secret=SecretStr("db-secret")
        )
        with patch.object(IntegrationProviderApp, "get_by_provider", AsyncMock(return_value=db_app)):
            config = await registry.resolve_app_config("dropbox")
        assert (config.client_id, config.client_secret, config.source) == (
            "env-key", "env-secret", "env",
        )

    @pytest.mark.asyncio
    async def test_db_config_used_without_env(self, monkeypatch):
        monkeypatch.delenv("DROPBOX_APP_KEY", raising=False)
        monkeypatch.delenv("DROPBOX_APP_SECRET", raising=False)
        db_app = IntegrationProviderApp(
            provider="dropbox", client_id="db-key", client_secret=SecretStr("db-secret")
        )
        with patch.object(IntegrationProviderApp, "get_by_provider", AsyncMock(return_value=db_app)):
            config = await registry.resolve_app_config("dropbox")
        assert config.configured and config.source == "db"

    @pytest.mark.asyncio
    async def test_unconfigured_provider_raises(self, monkeypatch):
        monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
        monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_SECRET", raising=False)
        with patch.object(IntegrationProviderApp, "get_by_provider", AsyncMock(return_value=None)):
            with pytest.raises(ConfigurationError):
                await registry.get_provider("google_drive")

    def test_public_url(self, monkeypatch):
        monkeypatch.delenv(registry.PUBLIC_URL_ENV, raising=False)
        settings = IntegrationSettings.model_construct(public_url="https://nb.example.com/")
        assert registry.resolve_public_url(settings) == ("https://nb.example.com", "db")
        monkeypatch.setenv(registry.PUBLIC_URL_ENV, "http://env.local:3000")
        assert registry.resolve_public_url(settings) == ("http://env.local:3000", "env")
        assert registry.redirect_uri("http://x", "dropbox") == (
            "http://x/api/integrations/providers/dropbox/callback"
        )
        with pytest.raises(InvalidInputError):
            registry.normalize_public_url("ftp://nope")

    def test_unknown_provider(self):
        with pytest.raises(InvalidInputError):
            registry.provider_class("onedrive")


# =============================================================================
# Token refresh
# =============================================================================


class TestTokens:
    @pytest.mark.asyncio
    async def test_valid_token_is_reused(self):
        account = IntegrationAccount(
            provider="dropbox", name="me", access_token=SecretStr("current"),
            token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        provider: Any = SimpleNamespace(refresh=AsyncMock())
        assert await get_valid_access_token(account, provider) == "current"
        provider.refresh.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_expiring_token_is_refreshed_and_saved(self):
        account = IntegrationAccount(
            provider="dropbox", name="me", access_token=SecretStr("old"),
            refresh_token=SecretStr("refresh"),
            token_expires_at=datetime.now(timezone.utc) + timedelta(seconds=10),
        )
        new_expiry = datetime.now(timezone.utc) + timedelta(hours=4)
        provider: Any = SimpleNamespace(
            refresh=AsyncMock(return_value=TokenSet("new", None, new_expiry))
        )
        with patch.object(IntegrationAccount, "save", AsyncMock()) as save:
            assert await get_valid_access_token(account, provider) == "new"
        provider.refresh.assert_awaited_once_with("refresh")
        save.assert_awaited_once()
        assert account.refresh_token and account.refresh_token.get_secret_value() == "refresh"
        assert account.token_expires_at == new_expiry


def test_account_tokens_are_encrypted_at_rest(encryption_key):
    account = IntegrationAccount(
        provider="dropbox", name="me",
        access_token=SecretStr("access"), refresh_token=SecretStr("refresh"),
    )
    data = account._prepare_save_data()
    assert data["access_token"] != "access" and data["refresh_token"] != "refresh"
    restored = IntegrationAccount.from_row({**data, "id": "integration_account:1"})
    assert restored.access_token.get_secret_value() == "access"
    assert restored.refresh_token.get_secret_value() == "refresh"


# =============================================================================
# Connectors
# =============================================================================


class TestDropbox:
    @pytest.mark.asyncio
    async def test_list_files_paginates_and_keeps_files_only(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content or b"null")
            calls.append((request.url.path, body))
            if request.url.path.endswith("/files/list_folder"):
                assert body["path"] == "id:root" and body["recursive"] is True
                return httpx.Response(200, json={
                    "entries": [
                        {".tag": "folder", "id": "id:sub", "name": "sub", "path_display": "/sub"},
                        {".tag": "file", "id": "id:1", "name": "a.pdf", "path_display": "/a.pdf",
                         "rev": "r1", "content_hash": "h1", "size": 5,
                         "server_modified": "2026-01-01T00:00:00Z"},
                    ],
                    "cursor": "c1", "has_more": True,
                })
            assert body == {"cursor": "c1"}
            return httpx.Response(200, json={
                "entries": [{".tag": "file", "id": "id:2", "name": "b.md",
                             "path_display": "/sub/b.md", "rev": "r2"}],
                "cursor": "c2", "has_more": False,
            })

        provider = DropboxProvider("key", "secret", transport=httpx.MockTransport(handler))
        files = await provider.list_files("tok", "id:root", True, {})
        assert [f.id for f in files] == ["id:1", "id:2"]
        assert files[0].content_hash == "h1"
        assert files[0].modified_at and files[0].modified_at.year == 2026
        assert len(calls) == 2

    @pytest.mark.asyncio
    async def test_folder_exists_false_when_not_found(self):
        def handler(request):
            return httpx.Response(409, json={"error_summary": "path/not_found/.."})

        provider = DropboxProvider("key", "secret", transport=httpx.MockTransport(handler))
        assert await provider.folder_exists("tok", "id:gone") is False
        assert await provider.folder_exists("tok", "") is True  # root

    @pytest.mark.asyncio
    async def test_exchange_code_and_authorize_url(self):
        def handler(request):
            form = dict(x.split("=") for x in request.content.decode().split("&"))
            assert form["grant_type"] == "authorization_code" and form["code"] == "abc"
            return httpx.Response(200, json={
                "access_token": "at", "refresh_token": "rt", "expires_in": 14400,
            })

        provider = DropboxProvider("key", "secret", transport=httpx.MockTransport(handler))
        tokens = await provider.exchange_code("abc", "http://x/cb")
        assert tokens.access_token == "at" and tokens.refresh_token == "rt"
        assert tokens.expires_at and tokens.expires_at > datetime.now(timezone.utc)
        url = provider.authorize_url("st", "http://x/cb")
        assert "token_access_type=offline" in url and "state=st" in url


class TestDropboxBrowse:
    @pytest.mark.asyncio
    async def test_list_children_and_get_file(self):
        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content or b"null")
            if request.url.path.endswith("/files/get_metadata"):
                if body["path"] == "id:gone":
                    return httpx.Response(409, json={"error_summary": "path/not_found/"})
                if body["path"] == "id:file":
                    return httpx.Response(200, json={
                        ".tag": "file", "id": "id:file", "name": "c d.pdf",
                        "path_display": "/Docs/c d.pdf", "rev": "r1",
                    })
                return httpx.Response(200, json={".tag": "folder", "path_display": "/Docs"})
            return httpx.Response(200, json={
                "entries": [
                    {".tag": "file", "id": "id:b", "name": "b.md", "path_display": "/Docs/b.md", "rev": "1"},
                    {".tag": "folder", "id": "id:sub", "name": "Sub", "path_display": "/Docs/Sub"},
                    {".tag": "file", "id": "id:a", "name": "A.pdf", "path_display": "/Docs/A.pdf", "rev": "1"},
                ],
                "has_more": False,
            })

        provider = DropboxProvider("key", "secret", transport=httpx.MockTransport(handler))
        path, folders, files = await provider.list_children("tok", "id:docs", {})
        assert path == "/Docs"
        assert [f.name for f in folders] == ["Sub"]
        assert [f.name for f in files] == ["A.pdf", "b.md"]
        assert folders[0].web_url == "https://www.dropbox.com/home/Docs/Sub"

        single = await provider.get_file("tok", "id:file", {})
        assert single and single.web_url == "https://www.dropbox.com/home/Docs?preview=c%20d.pdf"
        assert await provider.get_file("tok", "id:gone", {}) is None


class TestSharedFolders:
    @pytest.mark.asyncio
    async def test_drive_root_offers_virtual_shared_groups(self):
        def handler(request: httpx.Request) -> httpx.Response:
            path = request.url.path
            if path.endswith("/files"):
                q = request.url.params["q"]
                if "sharedWithMe" in q:
                    assert "corpora" not in request.url.params
                    return httpx.Response(200, json={"files": [
                        {"id": "sf", "name": "Team", "mimeType": "application/vnd.google-apps.folder"},
                        {"id": "sp", "name": "brief.pdf", "mimeType": "application/pdf", "version": "1"},
                    ]})
                assert request.url.params["corpora"] == "allDrives"
                return httpx.Response(200, json={"files": []})
            if path.endswith("/drives"):
                return httpx.Response(200, json={"drives": [{"id": "d1", "name": "Company"}]})
            return httpx.Response(200, json={"id": "root-id"})

        provider = GoogleDriveProvider("id", "secret", transport=httpx.MockTransport(handler))
        _, root_folders, _ = await provider.list_children("tok", None, {})
        virtual = [f for f in root_folders if not f.selectable]
        assert [f.id for f in virtual] == ["virtual:shared-with-me", "virtual:shared-drives"]

        path, folders, files = await provider.list_children("tok", "virtual:shared-with-me", {})
        assert path == "/Shared with me"
        assert [f.name for f in folders] == ["Team"] and folders[0].selectable
        assert [f.name for f in files] == ["brief.pdf"]

        _, drives, _ = await provider.list_children("tok", "virtual:shared-drives", {})
        assert [(d.id, d.path) for d in drives] == [("d1", "/Shared drives/Company")]

    @pytest.mark.asyncio
    async def test_dropbox_shared_folders_and_namespace_browsing(self):
        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content or b"null")
            if request.url.path.endswith("/sharing/list_folders"):
                return httpx.Response(200, json={"entries": [
                    {"shared_folder_id": "123", "name": "Campaign", "preview_url": "https://db/sh/1"},
                ]})
            if request.url.path.endswith("/files/list_folder"):
                if body["path"] == "":
                    return httpx.Response(200, json={"entries": [], "has_more": False})
                assert body["path"] == "ns:123"
                return httpx.Response(200, json={"entries": [
                    {".tag": "file", "id": "id:f", "name": "map.pdf", "rev": "1"},
                ], "has_more": False})
            raise AssertionError(request.url.path)

        provider = DropboxProvider("key", "secret", transport=httpx.MockTransport(handler))
        _, root_folders, _ = await provider.list_children("tok", None, {})
        assert root_folders[0].id == "virtual:shared-with-me" and not root_folders[0].selectable

        _, shared, _ = await provider.list_children("tok", "virtual:shared-with-me", {})
        assert [(f.id, f.name) for f in shared] == [("ns:123", "Campaign")]

        _, _, files = await provider.list_children("tok", "ns:123", {})
        assert files[0].path == "/Shared with me/map.pdf" and files[0].web_url is None
        assert await provider.folder_exists("tok", "ns:123") is True

    @pytest.mark.asyncio
    async def test_dropbox_missing_sharing_scope_explains_fix(self):
        def handler(request):
            return httpx.Response(401, json={"error_summary": "missing_scope/.."})

        provider = DropboxProvider("key", "secret", transport=httpx.MockTransport(handler))
        with pytest.raises(InvalidInputError, match="sharing.read"):
            await provider.list_children("tok", "virtual:shared-with-me", {})


class TestGoogleDrive:
    @pytest.mark.asyncio
    async def test_get_file_trashed_or_missing_is_none(self):
        def handler(request: httpx.Request) -> httpx.Response:
            if "gone" in request.url.path:
                return httpx.Response(404, json={})
            if "trashed" in request.url.path:
                return httpx.Response(200, json={"id": "trashed", "name": "x", "trashed": True})
            if request.url.path.endswith("/files/doc"):
                return httpx.Response(200, json={
                    "id": "doc", "name": "Notes", "version": "4", "parents": ["root"],
                    "mimeType": "application/vnd.google-apps.document",
                    "webViewLink": "https://docs.google.com/document/d/doc",
                })
            return httpx.Response(200, json={"id": "root", "name": "My Drive"})

        provider = GoogleDriveProvider("id", "secret", transport=httpx.MockTransport(handler))
        doc = await provider.get_file("tok", "doc", {})
        assert doc and doc.local_name == "Notes.docx" and doc.path == "/Notes"
        assert doc.web_url == "https://docs.google.com/document/d/doc"
        assert await provider.get_file("tok", "gone", {}) is None
        assert await provider.get_file("tok", "trashed", {}) is None


    @pytest.mark.asyncio
    async def test_list_files_recursive_with_exports(self):
        children = {
            "root-id": [
                {"id": "sub", "name": "Sub", "mimeType": "application/vnd.google-apps.folder"},
                {"id": "pdf", "name": "a.pdf", "mimeType": "application/pdf",
                 "md5Checksum": "m1", "version": "3", "size": "12"},
                {"id": "doc", "name": "Notes", "mimeType": "application/vnd.google-apps.document",
                 "version": "7"},
                {"id": "form", "name": "Survey", "mimeType": "application/vnd.google-apps.form"},
            ],
            "sub": [
                {"id": "sheet", "name": "Budget",
                 "mimeType": "application/vnd.google-apps.spreadsheet", "version": "2"},
            ],
        }

        def handler(request: httpx.Request) -> httpx.Response:
            query = request.url.params["q"]
            parent = query.split("'")[1]
            return httpx.Response(200, json={"files": children[parent]})

        provider = GoogleDriveProvider("id", "secret", transport=httpx.MockTransport(handler))
        files = {f.id: f for f in await provider.list_files(
            "tok", "root-id", True, {"document": "pdf", "spreadsheet": "csv"}
        )}
        assert set(files) == {"pdf", "doc", "sheet"}  # form skipped, folder traversed
        assert files["pdf"].content_hash == "m1" and files["pdf"].size == 12
        assert files["doc"].local_name == "Notes.pdf"
        assert files["doc"].export_mime == "application/pdf"
        assert files["sheet"].local_name == "Budget.csv"
        assert files["sheet"].path == "/Sub/Budget"

    @pytest.mark.asyncio
    async def test_download_exports_native_documents(self, tmp_path):
        seen = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request.url)
            return httpx.Response(200, content=b"exported")

        provider = GoogleDriveProvider("id", "secret", transport=httpx.MockTransport(handler))
        native = RemoteFile(id="doc", name="Notes", path="/Notes", revision="1",
                            export_mime="text/markdown", export_extension="md")
        dest = tmp_path / "Notes.md"
        await provider.download("tok", native, str(dest))
        assert dest.read_bytes() == b"exported"
        assert seen[0].path.endswith("/files/doc/export")
        assert seen[0].params["mimeType"] == "text/markdown"

    @pytest.mark.asyncio
    async def test_folder_exists_handles_missing_and_trashed(self):
        def handler(request):
            if "gone" in request.url.path:
                return httpx.Response(404, json={"error": {"code": 404}})
            return httpx.Response(200, json={
                "id": "t", "mimeType": "application/vnd.google-apps.folder", "trashed": True,
            })

        provider = GoogleDriveProvider("id", "secret", transport=httpx.MockTransport(handler))
        assert await provider.folder_exists("tok", "gone") is False
        assert await provider.folder_exists("tok", "trashed") is False
        assert await provider.folder_exists("tok", "root") is True


# =============================================================================
# Sync runner
# =============================================================================


def _link(kind="folder", notebooks=("notebook:1",)):
    return SyncLink(
        id="sync_link:1", account="integration_account:1", kind=kind,
        notebooks=list(notebooks), remote_id="id:folder", remote_path="/Research",
        name="Research", interval_minutes=15,
    )


class TestRunSync:
    @pytest.mark.asyncio
    async def test_missing_remote_folder_deletes_nothing(self):
        provider = SimpleNamespace(
            folder_exists=AsyncMock(return_value=False), list_files=AsyncMock()
        )
        account = IntegrationAccount(provider="dropbox", name="me")
        with (
            patch.object(sync.SyncLink, "get", AsyncMock(return_value=_link())),
            patch.object(sync, "_acquire", AsyncMock(return_value=True)),
            patch.object(sync.IntegrationAccount, "get", AsyncMock(return_value=account)),
            patch.object(sync, "get_provider", AsyncMock(return_value=provider)),
            patch.object(sync, "get_valid_access_token", AsyncMock(return_value="tok")),
            patch.object(sync.IntegrationSettings, "load_fresh",
                         AsyncMock(return_value=IntegrationSettings.model_construct())),
            patch.object(sync.ContentSettings, "get_instance",
                         AsyncMock(return_value=SimpleNamespace(auto_delete_files="no"))),
            patch.object(sync.Source, "delete", AsyncMock()) as delete_source,
            patch.object(sync, "_set_link_state", AsyncMock()) as set_state,
        ):
            result = await sync.run_sync("sync_link:1")

        assert result.skipped_reason and "No sources were deleted" in result.skipped_reason
        provider.list_files.assert_not_awaited()
        delete_source.assert_not_awaited()
        assert set_state.await_args
        state = set_state.await_args.kwargs
        assert state["status"] == "error" and "not found" in state["last_error"]

    @pytest.mark.asyncio
    async def test_file_link_missing_file_removes_its_source(self):
        provider = SimpleNamespace(get_file=AsyncMock(return_value=None), folder_exists=AsyncMock())
        account = IntegrationAccount(provider="dropbox", name="me")
        imported = mapping(remote_id="id:folder")
        with (
            patch.object(sync.SyncLink, "get", AsyncMock(return_value=_link(kind="file"))),
            patch.object(sync, "_acquire", AsyncMock(return_value=True)),
            patch.object(sync.IntegrationAccount, "get", AsyncMock(return_value=account)),
            patch.object(sync, "get_provider", AsyncMock(return_value=provider)),
            patch.object(sync, "get_valid_access_token", AsyncMock(return_value="tok")),
            patch.object(sync.IntegrationSettings, "load_fresh",
                         AsyncMock(return_value=IntegrationSettings.model_construct())),
            patch.object(sync.ContentSettings, "get_instance",
                         AsyncMock(return_value=SimpleNamespace(auto_delete_files="no"))),
            patch.object(sync.SyncedFile, "list_for_link", AsyncMock(return_value=[imported])),
            patch.object(sync.SyncedFile, "delete", AsyncMock()),
            patch.object(sync.Source, "get", AsyncMock(return_value=SimpleNamespace(delete=AsyncMock()))),
            patch.object(sync, "_set_link_state", AsyncMock()),
        ):
            result = await sync.run_sync("sync_link:1")
        provider.folder_exists.assert_not_awaited()  # no folder guard for single files
        assert result.deleted == 1 and not result.skipped_reason

    @pytest.mark.asyncio
    async def test_already_running_is_skipped(self):
        with (
            patch.object(sync.SyncLink, "get", AsyncMock(return_value=_link())),
            patch.object(sync, "_acquire", AsyncMock(return_value=False)),
            patch.object(sync, "_set_link_state", AsyncMock()) as set_state,
        ):
            result = await sync.run_sync("sync_link:1")
        assert result.skipped_reason == "Sync already running"
        set_state.assert_not_awaited()


class TestUpdateInPlace:
    @pytest.mark.asyncio
    async def test_file_replaced_atomically_and_source_reprocessed(self, tmp_path, monkeypatch):
        monkeypatch.setattr(sync, "UPLOADS_FOLDER", str(tmp_path))
        existing = tmp_path / "report.pdf"
        existing.write_bytes(b"old")

        async def download(token, file, dest):
            with open(dest, "wb") as f:
                f.write(b"new")

        provider: Any = SimpleNamespace(download=download)
        source = SimpleNamespace(
            id="source:1", title="report.pdf", asset=sync.Asset(file_path=str(existing)),
            get_status=AsyncMock(return_value="completed"), save=AsyncMock(),
        )
        synced = mapping(name="report.pdf", source="source:1")
        result = sync.SyncResult()
        runner = sync._LinkSync(_link(), provider, "tok", False, result)

        with (
            patch.object(sync.Source, "get", AsyncMock(return_value=source)),
            patch.object(sync, "check_file_support",
                         AsyncMock(return_value=SimpleNamespace(supported=True))),
            patch.object(sync, "repo_query", AsyncMock()) as query,
            patch.object(sync, "_submit_processing", AsyncMock(return_value="command:1")) as submit,
            patch.object(sync.SyncedFile, "save", AsyncMock()),
        ):
            await runner.update_changed(remote(name="report-v2.pdf", revision="r2"), synced)

        assert existing.read_bytes() == b"new"
        assert [p.name for p in tmp_path.iterdir()] == ["report.pdf"]  # no temp leftovers
        assert query.await_args and "DELETE source_insight" in query.await_args.args[0]
        assert source.title == "report-v2.pdf"
        submit.assert_awaited_once()
        assert synced.remote_revision == "r2" and synced.status == "synced"
        assert result.updated == 1

    @pytest.mark.asyncio
    async def test_change_deferred_while_processing(self):
        source = SimpleNamespace(get_status=AsyncMock(return_value="running"))
        result = sync.SyncResult()
        runner = sync._LinkSync(_link(), SimpleNamespace(), "tok", False, result)  # type: ignore[arg-type]
        synced = mapping()
        with patch.object(sync.Source, "get", AsyncMock(return_value=source)):
            await runner.update_changed(remote(revision="r2"), synced)
        assert result.deferred == 1 and synced.remote_revision == "r1"


# =============================================================================
# API
# =============================================================================


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from api.main import app

    return TestClient(app)


class TestIntegrationsApi:
    def test_env_managed_provider_is_read_only_and_secret_hidden(self, client, monkeypatch):
        monkeypatch.setenv("DROPBOX_APP_KEY", "env-key")
        monkeypatch.setenv("DROPBOX_APP_SECRET", "super-secret")
        monkeypatch.setenv(registry.PUBLIC_URL_ENV, "https://nb.example.com")
        with patch.object(IntegrationProviderApp, "get_by_provider", AsyncMock(return_value=None)), \
             patch.object(IntegrationSettings, "load_fresh",
                          AsyncMock(return_value=IntegrationSettings.model_construct(public_url=None))):
            listing = client.get("/api/integrations/providers")
            put = client.put("/api/integrations/providers/dropbox",
                             json={"client_id": "x", "client_secret": "y"})

        assert listing.status_code == 200
        assert "super-secret" not in listing.text
        dropbox = next(p for p in listing.json() if p["provider"] == "dropbox")
        assert dropbox["config_source"] == "env" and dropbox["has_secret"] is True
        assert dropbox["redirect_uri"] == (
            "https://nb.example.com/api/integrations/providers/dropbox/callback"
        )
        assert put.status_code == 409

    def test_unknown_provider_is_rejected(self, client):
        response = client.put("/api/integrations/providers/onedrive",
                              json={"client_id": "x", "client_secret": "y"})
        assert response.status_code == 400

    def test_settings_extensions_are_normalized(self):
        from api.models import IntegrationSettingsUpdate

        update = IntegrationSettingsUpdate(allowed_extensions=[".PDF", "docx", "pdf", " "])
        assert update.allowed_extensions == ["pdf", "docx"]
        with pytest.raises(ValueError):
            IntegrationSettingsUpdate(allowed_extensions=["../etc"])

    def test_callback_bad_state_redirects_with_error(self, client, monkeypatch, encryption_key):
        monkeypatch.setenv(registry.PUBLIC_URL_ENV, "https://nb.example.com")
        with patch.object(IntegrationSettings, "load_fresh",
                          AsyncMock(return_value=IntegrationSettings.model_construct())):
            response = client.get(
                "/api/integrations/providers/dropbox/callback?code=c&state=forged",
                follow_redirects=False,
            )
        assert response.status_code == 302
        location = response.headers["location"]
        assert location.startswith("https://nb.example.com/settings/integrations?")
        assert "integration_error=" in location

    def test_callbacks_are_excluded_from_password_auth(self):
        from api.auth import PasswordAuthMiddleware
        from api.main import app

        middleware = next(m for m in app.user_middleware if m.cls is PasswordAuthMiddleware)
        excluded: list[str] = middleware.kwargs["excluded_paths"]  # type: ignore[assignment]
        for provider in registry.PROVIDER_CLASSES:
            assert f"/api/integrations/providers/{provider}/callback" in excluded
        # nothing else under /api/integrations is public
        assert not [p for p in excluded if p.startswith("/api/integrations") and "callback" not in p]


def test_env_does_not_leak_between_tests():
    assert os.environ.get("DROPBOX_APP_SECRET") != "super-secret"
