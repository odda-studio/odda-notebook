"""Tests for transformation groups (one-level folders for transformations)."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.models import TransformationGroupWrite
from open_notebook.domain.transformation import Transformation, TransformationGroup


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


def group(id="transformation_group:1", name="CV"):
    return TransformationGroup(id=id, name=name, created="2026-01-01T00:00:00", updated="2026-01-01T00:00:00")


def transformation(id, group_id=None):
    return Transformation(
        id=id, name=id, title=id, description="", prompt="p", apply_default=False,
        group_id=group_id, created="2026-01-01T00:00:00", updated="2026-01-01T00:00:00",
    )


class TestGroupName:
    def test_is_stripped(self):
        assert TransformationGroupWrite(name="  CV  ").name == "CV"

    def test_blank_is_rejected(self):
        with pytest.raises(ValidationError):
            TransformationGroupWrite(name="   ")

    def test_duplicate_is_rejected(self, client):
        with patch.object(TransformationGroup, "find_by_name", AsyncMock(return_value=group())):
            response = client.post("/api/transformation-groups", json={"name": "cv"})
        assert response.status_code == 400

    def test_renaming_to_its_own_name_is_allowed(self, client):
        g = group()
        with (
            patch.object(TransformationGroup, "get", AsyncMock(return_value=g)),
            patch.object(TransformationGroup, "find_by_name", AsyncMock(return_value=g)),
            patch.object(TransformationGroup, "save", AsyncMock()),
            patch("api.routers.transformation_groups.repo_query", AsyncMock(return_value=[])),
        ):
            response = client.put(f"/api/transformation-groups/{g.id}", json={"name": "Cv"})
        assert response.status_code == 200 and response.json()["name"] == "Cv"


class TestListGroups:
    def test_sorted_case_insensitively_with_counts(self, client):
        groups = [group("transformation_group:1", "CV"), group("transformation_group:2", "Contratti")]
        with (
            patch.object(TransformationGroup, "get_all", AsyncMock(return_value=groups)),
            patch(
                "api.routers.transformation_groups.repo_query",
                AsyncMock(return_value=[{"group_id": "transformation_group:1", "n": 3}]),
            ),
        ):
            data = client.get("/api/transformation-groups").json()
        assert [g["name"] for g in data] == ["Contratti", "CV"]
        assert [g["transformation_count"] for g in data] == [0, 3]


class TestDeleteGroup:
    def _patches(self, members, fail_on=None):
        g = group()
        g_delete = AsyncMock()

        async def delete_member(self_t):
            if self_t.id == fail_on:
                raise RuntimeError("boom")

        return g, g_delete, [
            patch.object(TransformationGroup, "get", AsyncMock(return_value=g)),
            patch.object(TransformationGroup, "get_transformations", AsyncMock(return_value=members)),
            patch.object(TransformationGroup, "delete", g_delete),
            patch.object(Transformation, "delete", autospec=True, side_effect=delete_member),
        ]

    def test_default_keeps_transformations_as_ungrouped(self, client):
        members = [transformation("transformation:a"), transformation("transformation:b")]
        g, g_delete, patches = self._patches(members)
        with patches[0], patches[1], patches[2], patches[3] as t_delete:
            response = client.delete(f"/api/transformation-groups/{g.id}")
        assert response.json() == {
            "message": "Group deleted", "deleted_transformations": 0, "ungrouped_transformations": 2,
        }
        t_delete.assert_not_called()
        g_delete.assert_awaited_once()

    def test_can_delete_transformations_too(self, client):
        members = [transformation("transformation:a"), transformation("transformation:b")]
        g, g_delete, patches = self._patches(members)
        with patches[0], patches[1], patches[2], patches[3] as t_delete:
            response = client.delete(
                f"/api/transformation-groups/{g.id}?delete_transformations=true"
            )
        assert response.json()["deleted_transformations"] == 2
        assert t_delete.call_count == 2
        g_delete.assert_awaited_once()

    def test_partial_failure_keeps_the_group(self, client):
        members = [transformation("transformation:a"), transformation("transformation:b")]
        g, g_delete, patches = self._patches(members, fail_on="transformation:b")
        with patches[0], patches[1], patches[2], patches[3]:
            response = client.delete(
                f"/api/transformation-groups/{g.id}?delete_transformations=true"
            )
        assert response.status_code == 500
        g_delete.assert_not_awaited()


class TestTransformationGroupField:
    def test_update_semantics(self, client):
        """Omitted group_id keeps the group; explicit null ungroups."""
        t = transformation("transformation:a", group_id="transformation_group:1")
        with (
            patch.object(Transformation, "get", AsyncMock(return_value=t)),
            patch.object(Transformation, "save", AsyncMock()),
        ):
            kept = client.put("/api/transformations/transformation:a", json={"title": "New"})
            assert kept.json()["group_id"] == "transformation_group:1"
            cleared = client.put("/api/transformations/transformation:a", json={"group_id": None})
            assert cleared.json()["group_id"] is None

    def test_record_id_is_stored_as_record(self):
        data = transformation("transformation:a", group_id="transformation_group:cv")._prepare_save_data()
        assert str(data["group_id"]) == "transformation_group:cv"
        assert type(data["group_id"]).__name__ == "RecordID"

    def test_unknown_group_is_404(self, client):
        from open_notebook.exceptions import NotFoundError

        with patch.object(TransformationGroup, "get", AsyncMock(side_effect=NotFoundError("x"))):
            response = client.post("/api/transformations", json={
                "name": "n", "title": "t", "description": "d", "prompt": "p",
                "group_id": "transformation_group:missing",
            })
        assert response.status_code == 404

