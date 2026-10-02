"""Cooperative cancellation wrapper for background commands."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.utils import job_cancellation as jc


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
