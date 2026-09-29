"""Tests for GET /sources/count and POST /sources/bulk-delete."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from open_notebook.domain.notebook import Source
from open_notebook.exceptions import NotFoundError


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


class TestCountSources:
    def test_returns_total(self, client):
        with patch(
            "api.routers.sources.repo_query", new_callable=AsyncMock
        ) as mock_query:
            mock_query.return_value = [{"n": 42}]
            response = client.get("/api/sources/count")

        assert response.status_code == 200
        assert response.json() == {"count": 42}

    def test_empty_table_returns_zero(self, client):
        with patch(
            "api.routers.sources.repo_query", new_callable=AsyncMock
        ) as mock_query:
            mock_query.return_value = []
            response = client.get("/api/sources/count")

        assert response.status_code == 200
        assert response.json() == {"count": 0}

    def test_not_shadowed_by_the_id_route(self, client):
        """"/sources/count" must not be captured by GET /sources/{source_id}
        with source_id="count" - a classic FastAPI route-ordering gotcha."""
        with patch(
            "api.routers.sources.repo_query", new_callable=AsyncMock
        ) as mock_query, patch.object(Source, "get", new_callable=AsyncMock) as mock_get:
            mock_query.return_value = [{"n": 7}]
            response = client.get("/api/sources/count")

        assert response.status_code == 200
        mock_get.assert_not_awaited()


class TestBulkDeleteValidation:
    def test_requires_ids_or_all(self, client):
        response = client.post("/api/sources/bulk-delete", json={})
        assert response.status_code == 422

    def test_rejects_both_ids_and_all(self, client):
        response = client.post(
            "/api/sources/bulk-delete", json={"ids": ["source:1"], "all": True}
        )
        assert response.status_code == 422

    def test_rejects_too_many_ids(self, client):
        ids = [f"source:{i}" for i in range(1001)]
        response = client.post("/api/sources/bulk-delete", json={"ids": ids})
        assert response.status_code == 422


class TestBulkDeleteByIds:
    def test_deletes_each_id(self, client):
        sources = {
            "source:1": AsyncMock(spec=Source, id="source:1"),
            "source:2": AsyncMock(spec=Source, id="source:2"),
        }

        async def fake_get(source_id):
            return sources[source_id]

        with patch.object(Source, "get", side_effect=fake_get):
            response = client.post(
                "/api/sources/bulk-delete",
                json={"ids": ["source:1", "source:2"]},
            )

        assert response.status_code == 200
        assert response.json() == {"deleted": 2, "failed": 0, "errors": []}
        sources["source:1"].delete.assert_awaited_once()
        sources["source:2"].delete.assert_awaited_once()

    def test_already_missing_source_counts_as_deleted(self, client):
        """Bulk delete is idempotent: a source removed by something else in
        the meantime (e.g. a concurrent cloud-sync deletion) is not an error."""
        with patch.object(Source, "get", side_effect=NotFoundError("gone")):
            response = client.post(
                "/api/sources/bulk-delete", json={"ids": ["source:gone"]}
            )

        assert response.status_code == 200
        assert response.json() == {"deleted": 1, "failed": 0, "errors": []}

    def test_one_failure_does_not_stop_the_rest(self, client):
        good = AsyncMock(spec=Source, id="source:good")

        async def fake_get(source_id):
            if source_id == "source:bad":
                raise RuntimeError("disk full")
            return good

        with patch.object(Source, "get", side_effect=fake_get):
            response = client.post(
                "/api/sources/bulk-delete",
                json={"ids": ["source:bad", "source:good"]},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["deleted"] == 1 and data["failed"] == 1
        assert "source:bad" in data["errors"][0]
        good.delete.assert_awaited_once()


class TestBulkDeleteAll:
    def test_deletes_every_source_in_the_database(self, client):
        source = AsyncMock(spec=Source, id="source:1")

        with (
            patch(
                "api.routers.sources.repo_query", new_callable=AsyncMock
            ) as mock_query,
            patch.object(Source, "get", new_callable=AsyncMock, return_value=source),
        ):
            mock_query.return_value = ["source:1", "source:2", "source:3"]
            response = client.post("/api/sources/bulk-delete", json={"all": True})

        assert response.status_code == 200
        assert response.json()["deleted"] == 3
        assert source.delete.await_count == 3

    def test_all_true_with_no_sources_is_a_no_op(self, client):
        with patch(
            "api.routers.sources.repo_query", new_callable=AsyncMock
        ) as mock_query:
            mock_query.return_value = []
            response = client.post("/api/sources/bulk-delete", json={"all": True})

        assert response.status_code == 200
        assert response.json() == {"deleted": 0, "failed": 0, "errors": []}
