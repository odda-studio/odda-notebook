"""Live progress of background jobs (activity view)."""

from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.utils import job_progress as jp


@pytest.mark.asyncio
async def test_no_op_outside_a_job():
    with patch("open_notebook.database.repository.repo_query", AsyncMock()) as query:
        await jp.report_progress("embedding", current=1, total=2)
    query.assert_not_awaited()


@pytest.mark.asyncio
async def test_step_changes_are_logged_and_counters_throttled(monkeypatch):
    clock = iter([0.0, 0.1, 0.2, 0.3, 5.0])
    monkeypatch.setattr(jp, "_clock", lambda: next(clock))
    with patch("open_notebook.database.repository.repo_query", AsyncMock()) as query:
        with jp.bind_job("command:1"):
            await jp.report_progress("chunking")  # new step: logged
            await jp.report_progress("embedding", current=0, total=10)  # new step: logged
            await jp.report_progress("embedding", current=4, total=10)  # throttled
            await jp.report_progress("embedding", current=10, total=10)  # last: written
            await jp.report_progress("embedding", current=10, total=10)  # final again, written

    sqls = [c.args[0] for c in query.await_args_list]
    assert len(sqls) == 4
    assert "progress_log" in sqls[0] and "progress_log" in sqls[1]
    assert "progress_log" not in sqls[2]
    entry = query.await_args_list[2].args[1]["entry"]
    assert (entry["step"], entry["current"], entry["total"]) == ("embedding", 10, 10)


@pytest.mark.asyncio
async def test_db_errors_never_break_the_job():
    with patch(
        "open_notebook.database.repository.repo_query", AsyncMock(side_effect=RuntimeError("db"))
    ):
        with jp.bind_job("command:1"):
            await jp.report_progress("extracting", "a.pdf")
        assert await jp.record_attempt("command:1") == 1


@pytest.mark.asyncio
async def test_long_details_are_cut():
    with patch("open_notebook.database.repository.repo_query", AsyncMock()) as query:
        with jp.bind_job("command:1"):
            await jp.report_progress("extracting", "x" * 1000)
    assert len(query.await_args_list[-1].args[1]["entry"]["detail"]) == jp.MAX_DETAIL_LENGTH
