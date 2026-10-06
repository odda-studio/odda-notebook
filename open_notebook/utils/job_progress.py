"""
Live progress of background jobs, shown by the activity view (migration 32).

The worker-side wrapper (:func:`open_notebook.utils.job_cancellation.cancellable`)
binds the running command id to a context variable, so any code running inside
a job - commands, graphs, helpers like ``generate_embeddings`` - can call
:func:`report_progress` without threading the id through. Outside a job the
call is a no-op.

Each report overwrites ``command.progress`` (what the job is doing right now)
and, when the step changes, appends to ``command.progress_log`` (the job's
timeline, last ``LOG_LIMIT`` entries). Counter-only updates of the same step
are throttled to one write per ``MIN_INTERVAL_SECONDS``.

Step codes are stable identifiers translated by the frontend
(``activity.steps.<step>``); ``detail`` is free text (file name, model, ...).
"""

import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, Optional, Tuple

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.tracers.context import register_configure_hook
from loguru import logger

LOG_LIMIT = 50
MIN_INTERVAL_SECONDS = 1.0
MAX_DETAIL_LENGTH = 200

_clock = time.monotonic
_current_job: ContextVar[Optional[str]] = ContextVar("current_job", default=None)
# command id -> (last step, monotonic time of the last write)
_last_write: Dict[str, Tuple[str, float]] = {}


def current_job_id() -> Optional[str]:
    return _current_job.get()


@contextmanager
def bind_job(command_id: str) -> Iterator[None]:
    """Attribute progress reported in this context to ``command_id``."""
    token = _current_job.set(command_id)
    try:
        yield
    finally:
        _current_job.reset(token)
        _last_write.pop(command_id, None)


async def record_attempt(command_id: str) -> int:
    """Count one more execution attempt (retries re-enter the wrapper)."""
    from open_notebook.database.repository import ensure_record_id, repo_query

    try:
        rows = await repo_query(
            "UPDATE $id SET attempts = (attempts OR 0) + 1 RETURN attempts",
            {"id": ensure_record_id(command_id)},
        )
        return int(rows[0].get("attempts") or 1) if rows else 1
    except Exception as e:  # progress is best effort, never fail the job
        logger.debug(f"Could not record attempt for {command_id}: {e}")
        return 1


async def report_progress(
    step: str,
    detail: Optional[str] = None,
    current: Optional[int] = None,
    total: Optional[int] = None,
) -> None:
    """Record what the current job is doing. Best effort: never raises."""
    command_id = _current_job.get()
    if not command_id:
        return

    now = _clock()
    previous = _last_write.get(command_id)
    step_changed = previous is None or previous[0] != step
    last_of_counter = current is not None and total is not None and current >= total
    if not step_changed and not last_of_counter and now - previous[1] < MIN_INTERVAL_SECONDS:  # type: ignore[index]
        return
    _last_write[command_id] = (step, now)

    # lazy: the repository imports open_notebook.utils, which imports this module
    from open_notebook.database.repository import ensure_record_id, repo_query

    entry = {
        "step": step,
        "detail": detail[:MAX_DETAIL_LENGTH] if detail else None,
        "current": current,
        "total": total,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        if step_changed:
            await repo_query(
                "UPDATE $id SET progress = $entry, "
                "progress_log = array::slice(array::push(progress_log OR [], $entry), $keep)",
                {"id": ensure_record_id(command_id), "entry": entry, "keep": -LOG_LIMIT},
            )
        else:
            await repo_query(
                "UPDATE $id SET progress = $entry",
                {"id": ensure_record_id(command_id), "entry": entry},
            )
    except Exception as e:
        logger.debug(f"Could not report progress for {command_id}: {e}")


# =============================================================================
# LangGraph node progress (for third-party graphs we can't instrument)
# =============================================================================


class _NodeProgressHandler(AsyncCallbackHandler):
    """Reports a step when a LangGraph node listed in ``steps`` starts."""

    def __init__(self, steps: Dict[str, str]):
        self.steps = steps

    async def on_chain_start(self, serialized, inputs, *, metadata=None, **kwargs) -> None:
        node = (metadata or {}).get("langgraph_node") or kwargs.get("name")
        step = self.steps.get(node) if node else None
        # nested runs inside the node carry the same langgraph_node: report once
        if step and kwargs.get("name") == node:
            await report_progress(step)


_node_progress: ContextVar[Optional[_NodeProgressHandler]] = ContextVar(
    "job_node_progress", default=None
)
register_configure_hook(_node_progress, inheritable=True)


@contextmanager
def graph_node_steps(steps: Dict[str, str]) -> Iterator[None]:
    """Report ``steps[node]`` whenever that LangGraph node starts, for any graph
    run in this context (e.g. podcast-creator's outline/transcript/audio)."""
    token = _node_progress.set(_NodeProgressHandler(steps))
    try:
        yield
    finally:
        _node_progress.reset(token)


async def record_llm_usage(usage: Dict[str, Any]) -> None:
    """Append one LLM call's token usage to the current job (``llm_usage``).
    No-op outside a job; best effort."""
    command_id = _current_job.get()
    if not command_id:
        return
    from open_notebook.database.repository import ensure_record_id, repo_query

    try:
        await repo_query(
            "UPDATE $id SET llm_usage = array::slice(array::push(llm_usage OR [], $usage), $keep)",
            {"id": ensure_record_id(command_id), "usage": usage, "keep": -LOG_LIMIT},
        )
    except Exception as e:
        logger.debug(f"Could not record LLM usage for {command_id}: {e}")
