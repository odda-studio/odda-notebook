"""Notebook default transformations: merged into new sources, missing ones
applied to existing sources linked to a notebook."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from open_notebook.utils import notebook_transformations as nt


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


def test_merge_is_ordered_and_deduplicated():
    assert nt.merge_transformation_ids(["t:b", "t:a"], ["t:a", "t:c"], [], None) == [
        "t:b", "t:a", "t:c",
    ]


class TestDefaults:
    @pytest.mark.asyncio
    async def test_union_follows_notebook_order(self):
        rows = [
            {"id": "notebook:2", "default_transformations": ["t:c", "t:a"]},
            {"id": "notebook:1", "default_transformations": ["t:a", "t:b"]},
            {"id": "notebook:3", "default_transformations": None},
        ]
        with patch.object(nt, "repo_query", AsyncMock(return_value=rows)):
            result = await nt.notebook_default_transformations(
                ["notebook:1", "notebook:2", "notebook:3"]
            )
        assert result == ["t:a", "t:b", "t:c"]

    @pytest.mark.asyncio
    async def test_no_notebooks_no_query(self):
        with patch.object(nt, "repo_query", AsyncMock()) as query:
            assert await nt.notebook_default_transformations([]) == []
        query.assert_not_awaited()


class TestApplied:
    @pytest.mark.asyncio
    async def test_matches_by_reference_and_legacy_title(self):
        insights = [
            {"transformation": "t:a", "insight_type": "Skills"},
            {"transformation": None, "insight_type": "Summary"},  # pre-migration insight
        ]
        titles = [{"id": "t:b", "title": "Summary"}, {"id": "t:c", "title": "Extra"}]
        with patch.object(nt, "repo_query", AsyncMock(side_effect=[insights, titles])):
            applied = await nt.applied_transformation_ids("source:1", ["t:a", "t:b", "t:c"])
        assert applied == {"t:a", "t:b"}


class TestApplyMissing:
    @pytest.mark.asyncio
    async def test_queues_only_missing(self):
        with (
            patch.object(nt, "missing_notebook_defaults", AsyncMock(return_value=["t:b"])),
            patch.object(nt, "repo_query", AsyncMock(return_value=[{"has_text": True}])),
            patch("surreal_commands.submit_command", return_value="command:1") as submit,
        ):
            queued = await nt.apply_missing_notebook_defaults("source:1", ["notebook:1"])
        assert queued == ["t:b"]
        assert submit.call_args.args[1:] == (
            "run_transformation", {"source_id": "source:1", "transformation_id": "t:b"},
        )

    @pytest.mark.asyncio
    async def test_source_without_text_is_skipped(self):
        with (
            patch.object(nt, "missing_notebook_defaults", AsyncMock(return_value=["t:b"])),
            patch.object(nt, "repo_query", AsyncMock(return_value=[{"has_text": False}])),
            patch("surreal_commands.submit_command") as submit,
        ):
            assert await nt.apply_missing_notebook_defaults("source:1", ["notebook:1"]) == []
        submit.assert_not_called()


class TestCreateSource:
    def _post(self, client, **body):
        submitted = []

        async def fake_submit(module, name, args, context=None):
            submitted.append(args)
            return "command:1"

        with (
            patch("api.routers.sources.Notebook.get", AsyncMock(return_value=MagicMock())),
            patch("api.routers.sources.Transformation.get", AsyncMock(return_value=MagicMock())),
            patch("api.routers.sources.notebook_default_transformations",
                  AsyncMock(return_value=["t:default", "t:explicit"])),
            patch("api.routers.sources.Source.save", AsyncMock()),
            patch("api.routers.sources.Source.add_to_notebook", AsyncMock()),
            patch("api.routers.sources.CommandService.submit_command_job", side_effect=fake_submit),
        ):
            response = client.post("/api/sources/json", json={
                "type": "text", "content": "hello", "notebooks": ["notebook:1"],
                "async_processing": True, **body,
            })
        assert response.status_code == 200, response.text
        return submitted[-1]["transformations"]

    def test_defaults_are_merged(self, client):
        assert self._post(client, transformations=["t:explicit"]) == ["t:explicit", "t:default"]

    def test_opt_out(self, client):
        assert self._post(
            client, transformations=["t:explicit"], apply_notebook_defaults=False
        ) == ["t:explicit"]


class TestAddExistingSource:
    def test_new_link_applies_missing_defaults(self, client):
        queries = []

        async def fake_query(sql, params=None):
            queries.append(sql)
            return []  # no existing reference

        with (
            patch("api.routers.notebooks.Notebook.get", AsyncMock()),
            patch("api.routers.notebooks.Source.get", AsyncMock()),
            patch("api.routers.notebooks.repo_query", side_effect=fake_query),
            patch("api.routers.notebooks.apply_missing_notebook_defaults",
                  AsyncMock(return_value=["t:b"])) as apply,
        ):
            response = client.post("/api/notebooks/notebook:1/sources/source:1")

        assert response.json()["applied_transformations"] == ["t:b"]
        apply.assert_awaited_once_with("source:1", ["notebook:1"])
        # regression: the edge is source->reference->notebook (in = source)
        assert "in = $source_id AND out = $notebook_id" in queries[0]

    def test_existing_link_does_nothing(self, client):
        with (
            patch("api.routers.notebooks.Notebook.get", AsyncMock()),
            patch("api.routers.notebooks.Source.get", AsyncMock()),
            patch("api.routers.notebooks.repo_query", AsyncMock(return_value=[{"id": "reference:1"}])),
            patch("api.routers.notebooks.apply_missing_notebook_defaults", AsyncMock()) as apply,
        ):
            response = client.post("/api/notebooks/notebook:1/sources/source:1")
        assert response.json()["applied_transformations"] == []
        apply.assert_not_awaited()
