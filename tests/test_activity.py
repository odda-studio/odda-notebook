"""Activity view: background jobs resolved to the source/note/link they act on."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api import activity_service


def command(id, name, status, args, **extra):
    return {"id": id, "name": name, "status": status, "args": args,
            "error_message": extra.pop("error", ""), "created": "2026-09-29T10:00:00Z",
            "started_at": extra.pop("started_at", None), "finished_at": extra.pop("finished_at", None),
            "cancel_requested": extra.pop("cancel_requested", None)}


def fake_db(active=(), recent=(), sources=(), transformations=(), insights=(), links=()):
    async def query(sql, params=None):
        if "FROM command" in sql and "ORDER BY created" in sql:
            return list(active)
        if "FROM command" in sql and "ORDER BY finished_at" in sql:
            return list(recent)
        if "count() AS n FROM command WHERE status IN" in sql and "GROUP BY status" in sql:
            by: dict[str, int] = {}
            for row in active:
                by[row["status"]] = by.get(row["status"], 0) + 1
            return [{"status": s, "n": n} for s, n in by.items()]
        if "count() AS n FROM command WHERE status = 'failed'" in sql:
            n = sum(1 for r in recent if r["status"] == "failed")
            return [{"n": n}] if n else []
        if "FROM source_insight" in sql:
            return list(insights)
        if "FROM source " in sql:
            return list(sources)
        if "FROM transformation " in sql:
            return list(transformations)
        if "FROM sync_link " in sql:
            return list(links)
        if "FROM note " in sql:
            return []
        raise AssertionError(sql)

    return query


@pytest.mark.asyncio
async def test_jobs_are_resolved_to_their_targets():
    db = fake_db(
        active=[
            command("command:1", "process_source", "running",
                    {"source_id": "source:a", "transformations": ["t:1", "t:2"]}),
            command("command:2", "run_transformation", "new",
                    {"source_id": "source:a", "transformation_id": "t:1"}),
            command("command:3", "embed_insight", "new", {"insight_id": "source_insight:i"}),
            command("command:4", "sync_link", "running", {"link_id": "sync_link:l"}),
            command("command:5", "generate_podcast", "new", {"episode_name": "Ep 1"}),
        ],
        sources=[{"id": "source:a", "label": "CV.pdf"}],
        transformations=[{"id": "t:1", "label": "Skills"}],
        insights=[{"id": "source_insight:i", "source": "source:a"}],
        links=[{"id": "sync_link:l", "label": "Drive CVs"}],
    )
    with patch.object(activity_service, "repo_query", side_effect=db):
        result = await activity_service.get_activity()

    jobs = {j.id: j for j in result.active}
    assert (jobs["command:1"].stage, jobs["command:1"].target_title, jobs["command:1"].detail) == (
        "extraction", "CV.pdf", "2",
    )
    assert jobs["command:2"].detail == "Skills" and jobs["command:2"].stage == "transformation"
    assert jobs["command:3"].target_id == "source:a"  # through the insight
    assert (jobs["command:4"].target_type, jobs["command:4"].target_title) == ("link", "Drive CVs")
    assert (jobs["command:5"].target_type, jobs["command:5"].target_title) == ("podcast", "Ep 1")
    assert result.counts.model_dump() == {"active": 5, "queued": 3, "running": 2, "failed_recent": 0}


@pytest.mark.asyncio
async def test_failures_retry_and_deleted_targets():
    db = fake_db(
        recent=[
            command("command:1", "process_source", "failed", {"source_id": "source:a"},
                    error="x" * 1000, finished_at="2026-09-29T10:01:00Z"),
            command("command:2", "process_source", "failed", {"source_id": "source:gone"},
                    error="boom", finished_at="2026-09-29T10:02:00Z"),
            command("command:3", "run_transformation", "failed",
                    {"source_id": "source:a", "transformation_id": "t:1"}, error="llm"),
            command("command:4", "embed_source", "completed", {"source_id": "source:a"},
                    error="ignored for completed"),
        ],
        sources=[{"id": "source:a", "label": "CV.pdf"}],
    )
    with patch.object(activity_service, "repo_query", side_effect=db):
        result = await activity_service.get_activity()

    jobs = {j.id: j for j in result.recent}
    assert jobs["command:1"].retryable and len(jobs["command:1"].error or "") == 300
    assert not jobs["command:2"].retryable and jobs["command:2"].target_exists is False
    assert not jobs["command:3"].retryable  # only source extraction can be retried
    assert jobs["command:4"].error is None
    assert result.counts.failed_recent == 3


def test_endpoints():
    from api.main import app

    client = TestClient(app)
    with patch.object(activity_service, "repo_query", side_effect=fake_db()):
        assert client.get("/api/activity").json()["active"] == []
        assert client.get("/api/activity/summary").json()["active"] == 0
    assert client.get("/api/activity?hours=500").status_code == 422


@pytest.mark.asyncio
async def test_canceled_jobs_are_shown_as_canceled_not_failed():
    db = fake_db(recent=[
        command("command:1", "process_source", "failed", {"source_id": "source:a"},
                error="Canceled by user", finished_at="2026-09-29T10:01:00Z", cancel_requested=True),
    ], sources=[{"id": "source:a", "label": "CV.pdf"}])
    with patch.object(activity_service, "repo_query", side_effect=db):
        job = (await activity_service.get_activity()).recent[0]
    assert job.status == "canceled" and job.error is None and not job.retryable


@pytest.mark.asyncio
async def test_cancel_target_flags_every_active_job_and_deletes_the_source():
    rows = [
        command("command:1", "process_source", "running", {"source_id": "source:a"}),
        command("command:2", "embed_source", "new", {"source_id": "source:a"}),
        command("command:3", "embed_source", "new", {"source_id": "source:other"}),
    ]

    async def query(sql, params=None):
        if "FROM command" in sql:
            return rows
        if "FROM source " in sql:
            return [{"id": "source:a", "label": "CV"}, {"id": "source:other", "label": "X"}]
        return []

    source = AsyncMock()
    with (
        patch.object(activity_service, "repo_query", side_effect=query),
        patch.object(activity_service, "request_cancel",
                     AsyncMock(side_effect=lambda cid: {"command:1": "running"}.get(cid, "new"))) as cancel,
        patch.object(activity_service.Source, "get", AsyncMock(return_value=source)),
    ):
        result = await activity_service.cancel_target("source", "source:a", delete_target=True)

    assert sorted(c.args[0] for c in cancel.await_args_list) == ["command:1", "command:2"]
    assert result.model_dump() == {"canceled": 2, "stopping": 1, "deleted_target": True}
    source.delete.assert_awaited_once()


def test_cancel_finished_job_is_rejected():
    from api.main import app

    with patch.object(activity_service, "request_cancel", AsyncMock(return_value=None)):
        response = TestClient(app).post("/api/activity/jobs/command:1/cancel")
    assert response.status_code == 400


def test_dismiss_only_finished_jobs():
    from api.main import app

    client = TestClient(app)
    with patch.object(activity_service, "repo_query", AsyncMock(return_value=[])):
        assert client.post("/api/activity/jobs/command:1/dismiss").status_code == 400
    with patch.object(activity_service, "repo_query", AsyncMock(return_value=[{"id": "command:1"}])):
        assert client.post("/api/activity/jobs/command:1/dismiss").json() == {"dismissed": 1}
