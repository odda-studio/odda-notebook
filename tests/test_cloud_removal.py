"""Un-syncing and deleting cloud-imported sources (links, accounts, files)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api import integrations_service as service
from api.models import CancelJobsResponse
from open_notebook.domain.integration import SyncedFile, SyncLink


def mapping(id, source=None, status="synced", sync_enabled=True):
    m = SyncedFile(id=id, link="sync_link:l", remote_id=id, name=id, source=source,
                   status=status, sync_enabled=sync_enabled)
    object.__setattr__(m, "save", AsyncMock())
    return m


def link(kind="folder"):
    item = SyncLink(id="sync_link:l", account="integration_account:a", kind=kind,
                    remote_id="r", remote_path="/r", name="R")
    object.__setattr__(item, "delete", AsyncMock())
    return item


@pytest.fixture
def cancel_target():
    async def fake(target_type, target_id, delete_target):
        return CancelJobsResponse(
            canceled=1, stopping=0, deleted_target=delete_target and target_type == "source"
        )

    with patch.object(service.activity_service, "cancel_target", AsyncMock(side_effect=fake)) as m:
        yield m


@pytest.mark.asyncio
async def test_delete_link_keeps_sources_by_default(cancel_target):
    item = link()
    with (
        patch.object(SyncLink, "get", AsyncMock(return_value=item)),
        patch.object(SyncedFile, "list_for_link", AsyncMock(return_value=[mapping("f1", "source:1")])),
    ):
        result = await service.delete_link("sync_link:l")

    assert (result.sources_deleted, result.jobs_canceled) == (0, 1)
    cancel_target.assert_awaited_once_with("link", "sync_link:l", delete_target=False)
    item.delete.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_link_with_sources_stops_and_deletes_them(cancel_target):
    item = link()
    files = [mapping("f1", "source:1"), mapping("f2"), mapping("f3", "source:3")]
    with (
        patch.object(SyncLink, "get", AsyncMock(return_value=item)),
        patch.object(SyncedFile, "list_for_link", AsyncMock(return_value=files)),
    ):
        result = await service.delete_link("sync_link:l", delete_sources=True)

    assert (result.sources_deleted, result.jobs_canceled) == (2, 3)
    deleted = [c.args[1] for c in cancel_target.await_args_list if c.args[0] == "source"]
    assert deleted == ["source:1", "source:3"]
    item.delete.assert_awaited_once()


@pytest.mark.asyncio
async def test_disconnect_folder_file_keeps_source_as_regular(cancel_target):
    m = mapping("f1", "source:1")
    with patch.object(service, "_source_context", AsyncMock(return_value=(m, link()))):
        result = await service.disconnect_source("source:1", delete_source=False)

    assert (m.status, m.source, result.sources_deleted) == ("excluded", None, 0)
    cancel_target.assert_not_awaited()
    m.save.assert_awaited_once()


@pytest.mark.asyncio
async def test_disconnect_single_file_link_deletes_link_and_source(cancel_target):
    item = link(kind="file")
    with patch.object(service, "_source_context",
                      AsyncMock(return_value=(mapping("f1", "source:1"), item))):
        result = await service.disconnect_source("source:1", delete_source=True)

    assert result.sources_deleted == 1
    assert [c.args[0] for c in cancel_target.await_args_list] == ["link", "source"]
    item.delete.assert_awaited_once()


@pytest.mark.asyncio
async def test_bulk_actions(cancel_target):
    files = {
        "f1": mapping("f1", "source:1"),
        "f2": mapping("f2", "source:2", status="excluded"),
        "f3": mapping("f3", "source:3"),
    }
    get = AsyncMock(side_effect=lambda fid: files[fid])
    with patch.object(SyncedFile, "get", get):
        stopped = await service.bulk_files(["f1", "f2"], "stop_sync")
        assert stopped.updated == 1 and files["f1"].sync_enabled is False  # excluded skipped

        deleted = await service.bulk_files(["f1", "f3"], "delete")
        assert (deleted.updated, deleted.sources_deleted) == (2, 2)
        assert files["f1"].status == files["f3"].status == "excluded"
        assert files["f1"].source is None


def test_routes_accept_delete_sources():
    from fastapi.testclient import TestClient

    from api.main import app

    response = MagicMock(message="Link removed", sources_deleted=2, jobs_canceled=1)
    with patch.object(service, "delete_link", AsyncMock(return_value=response)) as delete:
        TestClient(app).delete("/api/integrations/links/sync_link:l?delete_sources=true")
    delete.assert_awaited_once_with("sync_link:l", True)
