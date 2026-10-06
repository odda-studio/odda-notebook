"""
Cooperative cancellation for background jobs (surreal-commands has none).

The API marks a job with ``cancel_requested`` (migration 30). Every command is
wrapped with :func:`cancellable`, which runs inside the worker:

- a job that was still queued stops as soon as it starts;
- a running job is watched: when the flag appears, its asyncio task is
  cancelled (aborting the in-flight HTTP/LLM await) and the job ends with
  :class:`JobCanceled`, a ``ValueError`` so the retry policies never re-run it.

Work already handed to a thread (``asyncio.to_thread``) or to a follow-up job
can't be interrupted - cancelling is best effort, and the activity view shows
the job as canceled regardless of what surreal-commands records as final status.
"""

import asyncio
import contextlib
import functools
from typing import Any, Awaitable, Callable, Optional, TypeVar

from loguru import logger

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.utils.job_progress import bind_job, record_attempt, report_progress

POLL_SECONDS = 2.0
CANCEL_MESSAGE = "Canceled by user"

F = TypeVar("F", bound=Callable[..., Awaitable[Any]])


class JobCanceled(ValueError):
    """The job was canceled by the user (ValueError: never retried)."""

    def __init__(self, message: str = CANCEL_MESSAGE):
        super().__init__(message)


async def is_cancel_requested(command_id: str) -> bool:
    rows = await repo_query(
        "SELECT VALUE cancel_requested FROM $id", {"id": ensure_record_id(command_id)}
    )
    return bool(rows and rows[0])


async def request_cancel(command_id: str) -> Optional[str]:
    """Flag a queued/running job for cancellation. Returns its status, or None
    if it doesn't exist or already finished."""
    rows = await repo_query(
        "UPDATE $id SET cancel_requested = true, cancel_requested_at = time::now() "
        "WHERE status IN ['new', 'running'] RETURN AFTER",
        {"id": ensure_record_id(command_id)},
    )
    if not rows:
        return None
    status = rows[0].get("status")
    if status == "new":
        # Not picked up yet: a worker restart must not start it either
        await repo_query(
            "UPDATE $id SET status = 'canceled', error_message = $message WHERE status = 'new'",
            {"id": ensure_record_id(command_id), "message": CANCEL_MESSAGE},
        )
    return status


def _command_id(input_data: Any) -> Optional[str]:
    context = getattr(input_data, "execution_context", None)
    command_id = getattr(context, "command_id", None)
    return str(command_id) if command_id else None


async def _wait_for_cancel(command_id: str) -> bool:
    while True:
        await asyncio.sleep(POLL_SECONDS)
        try:
            if await is_cancel_requested(command_id):
                return True
        except Exception as e:  # a DB hiccup must not kill the job
            logger.debug(f"Cancel check failed for {command_id}: {e}")


def cancellable(func: F) -> F:
    """Make a surreal-commands command stoppable from the activity view.

    Apply it *below* ``@command(...)`` so the registered runnable is the
    wrapper; ``functools.wraps`` keeps the type hints surreal-commands reads.
    """

    @functools.wraps(func)
    async def wrapper(input_data: Any) -> Any:
        command_id = _command_id(input_data)
        if not command_id:
            return await func(input_data)
        if await is_cancel_requested(command_id):
            logger.info(f"Job {command_id} was canceled before it started")
            raise JobCanceled()

        with bind_job(command_id):
            attempt = await record_attempt(command_id)
            await report_progress("retrying" if attempt > 1 else "started", str(attempt))
            # the job task copies the context, so it reports under this id too
            job = asyncio.ensure_future(func(input_data))
            watcher = asyncio.ensure_future(_wait_for_cancel(command_id))
            try:
                done, _ = await asyncio.wait({job, watcher}, return_when=asyncio.FIRST_COMPLETED)
            except asyncio.CancelledError:
                job.cancel()
                watcher.cancel()
                raise
            if job in done:
                watcher.cancel()
                return job.result()

            logger.info(f"Canceling job {command_id} on user request")
            await report_progress("stopping")
            job.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await job
            raise JobCanceled()

    return wrapper  # type: ignore[return-value]
