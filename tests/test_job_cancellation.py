"""Cooperative cancellation wrapper for background commands."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.utils import job_cancellation as jc


@pytest.fixture(autouse=True)
def progress(monkeypatch):
    """The wrapper records attempts/progress in the DB: keep tests offline."""
    report = AsyncMock()
    monkeypatch.setattr(jc, "record_attempt", AsyncMock(return_value=1))
    monkeypatch.setattr(jc, "report_progress", report)
    return report


def job_input(command_id="command:1"):
    return SimpleNamespace(execution_context=SimpleNamespace(command_id=command_id))


@pytest.mark.asyncio
async def test_returns_result_when_not_canceled():
    @jc.cancellable
    async def work(input_data):
        return "done"

    with patch.object(jc, "is_cancel_requested", AsyncMock(return_value=False)):
        assert await work(job_input()) == "done"


@pytest.mark.asyncio
async def test_canceled_before_start_never_runs():
    ran = []

    @jc.cancellable
    async def work(input_data):
        ran.append(True)

    with patch.object(jc, "is_cancel_requested", AsyncMock(return_value=True)):
        with pytest.raises(jc.JobCanceled):
            await work(job_input())
    assert ran == []


@pytest.mark.asyncio
async def test_running_job_is_interrupted(monkeypatch):
    monkeypatch.setattr(jc, "POLL_SECONDS", 0.01)
    reached_end = []

    @jc.cancellable
    async def work(input_data):
        await asyncio.sleep(10)  # an in-flight LLM/HTTP call
        reached_end.append(True)

    # not canceled at start, canceled at the first poll
    with patch.object(jc, "is_cancel_requested", AsyncMock(side_effect=[False, True])):
        with pytest.raises(jc.JobCanceled):
            await asyncio.wait_for(work(job_input()), timeout=2)
    assert reached_end == []


@pytest.mark.asyncio
async def test_errors_propagate_unchanged():
    @jc.cancellable
    async def work(input_data):
        raise RuntimeError("transient")

    with patch.object(jc, "is_cancel_requested", AsyncMock(return_value=False)):
        with pytest.raises(RuntimeError, match="transient"):
            await work(job_input())


def test_cancellation_is_never_retried():
    assert issubclass(jc.JobCanceled, ValueError)  # every command stops retrying on ValueError


@pytest.mark.asyncio
async def test_without_execution_context_runs_directly():
    @jc.cancellable
    async def work(input_data):
        return 1

    with patch.object(jc, "is_cancel_requested", AsyncMock()) as check:
        assert await work(SimpleNamespace(execution_context=None)) == 1
    check.assert_not_awaited()


@pytest.mark.asyncio
async def test_job_reports_under_its_command_id(progress):
    from open_notebook.utils.job_progress import current_job_id

    seen = []

    @jc.cancellable
    async def work(input_data):
        seen.append(current_job_id())

    with patch.object(jc, "is_cancel_requested", AsyncMock(return_value=False)):
        await work(job_input("command:42"))
    assert seen == ["command:42"]
    assert current_job_id() is None  # unbound after the job
    progress.assert_awaited_with("started", "1")


@pytest.mark.asyncio
async def test_retry_is_reported(monkeypatch, progress):
    monkeypatch.setattr(jc, "record_attempt", AsyncMock(return_value=3))

    @jc.cancellable
    async def work(input_data):
        return None

    with patch.object(jc, "is_cancel_requested", AsyncMock(return_value=False)):
        await work(job_input())
    progress.assert_awaited_with("retrying", "3")

