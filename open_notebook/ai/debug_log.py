"""
Verbose logging of every LLM call (development aid).

Enabled with ``OPEN_NOTEBOOK_AI_DEBUG=true``. A LangChain callback handler is
registered as a global configure hook, so it sees every LangChain/LangGraph
run in the process - our graphs, the widget, and third-party graphs such as
podcast-creator - without touching call sites.

Logged per call: model, full prompt messages, every streamed token, the final
output, token usage, duration and errors. Prompts and answers contain user
data: never enable this in production.
"""

import os
import time
from contextvars import ContextVar
from typing import Any, Dict, List, Optional
from uuid import UUID

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.tracers.context import register_configure_hook
from loguru import logger

ENV_VAR = "OPEN_NOTEBOOK_AI_DEBUG"


def ai_debug_enabled() -> bool:
    return os.environ.get(ENV_VAR, "").strip().lower() in ("1", "true", "yes", "on")


def _model_name(serialized: Optional[Dict[str, Any]], kwargs: Dict[str, Any]) -> str:
    params = kwargs.get("invocation_params") or {}
    name = params.get("model") or params.get("model_name")
    if not name and serialized:
        sk = serialized.get("kwargs") or {}
        name = sk.get("model") or sk.get("model_name")
    cls = (serialized or {}).get("id", ["?"])[-1] if serialized else "?"
    return f"{cls}/{name}" if name else str(cls)


def _format_message(m: Any) -> str:
    role = getattr(m, "type", type(m).__name__)
    content = getattr(m, "content", m)
    extra = ""
    tool_calls = getattr(m, "tool_calls", None)
    if tool_calls:
        extra = f" tool_calls={tool_calls}"
    return f"[{role}]{extra}\n{content}"


class _Run:
    __slots__ = ("model", "start", "first_token", "tokens", "tag")

    def __init__(self, model: str, tag: str):
        self.model = model
        self.tag = tag
        self.start = time.monotonic()
        self.first_token: Optional[float] = None
        self.tokens = 0


class AIDebugLogHandler(AsyncCallbackHandler):
    """Logs LLM calls with loguru. Never raises."""

    raise_error = False

    def __init__(self) -> None:
        self._runs: Dict[UUID, _Run] = {}

    def _begin(self, run_id: UUID, serialized, kwargs, tags, metadata) -> _Run:
        model = _model_name(serialized, kwargs)
        meta = metadata or {}
        where = meta.get("langgraph_node") or kwargs.get("name") or ""
        tag = f"[AI {str(run_id)[:8]}]"
        run = _Run(model, tag)
        self._runs[run_id] = run
        params = {
            k: v
            for k, v in (kwargs.get("invocation_params") or {}).items()
            if k not in ("api_key", "_type") and "key" not in k.lower()
        }
        logger.info(
            f"{tag} START model={model} node={where or '-'} tags={tags or []} params={params}"
        )
        return run

    async def on_chat_model_start(
        self,
        serialized: Dict[str, Any],
        messages: List[List[Any]],
        *,
        run_id: UUID,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        run = self._begin(run_id, serialized, kwargs, tags, metadata)
        for batch in messages:
            chars = sum(len(str(getattr(m, "content", ""))) for m in batch)
            logger.info(f"{run.tag} PROMPT ({len(batch)} messages, {chars} chars)")
            for i, m in enumerate(batch):
                logger.info(f"{run.tag} PROMPT #{i} {_format_message(m)}")

    async def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        run = self._begin(run_id, serialized, kwargs, tags, metadata)
        for i, p in enumerate(prompts):
            logger.info(f"{run.tag} PROMPT #{i} ({len(p)} chars)\n{p}")

    async def on_llm_new_token(self, token: Any, *, run_id: UUID, **kwargs: Any) -> None:
        run = self._runs.get(run_id)
        if run is None:
            return
        now = time.monotonic()
        if run.first_token is None:
            run.first_token = now
            logger.info(f"{run.tag} first token after {now - run.start:.2f}s")
        run.tokens += 1
        logger.debug(f"{run.tag} TOKEN #{run.tokens} +{now - run.start:.2f}s {token!r}")

    async def on_llm_end(self, response: Any, *, run_id: UUID, **kwargs: Any) -> None:
        run = self._runs.pop(run_id, None)
        tag = run.tag if run else f"[AI {str(run_id)[:8]}]"
        elapsed = f"{time.monotonic() - run.start:.2f}s" if run else "?"
        usage = (getattr(response, "llm_output", None) or {}).get("token_usage")
        for gens in getattr(response, "generations", []) or []:
            for gen in gens:
                msg = getattr(gen, "message", None)
                text = getattr(gen, "text", "") or (getattr(msg, "content", "") if msg else "")
                meta = getattr(msg, "usage_metadata", None) if msg else None
                usage = meta or usage
                finish = (getattr(gen, "generation_info", None) or {}).get("finish_reason")
                if msg is not None and getattr(msg, "tool_calls", None):
                    logger.info(f"{tag} TOOL_CALLS {msg.tool_calls}")
                logger.info(f"{tag} OUTPUT ({len(str(text))} chars, finish={finish})\n{text}")
        logger.info(
            f"{tag} END model={run.model if run else '?'} duration={elapsed} "
            f"streamed_tokens={run.tokens if run else 0} usage={usage}"
        )

    async def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        run = self._runs.pop(run_id, None)
        tag = run.tag if run else f"[AI {str(run_id)[:8]}]"
        elapsed = f"{time.monotonic() - run.start:.2f}s" if run else "?"
        logger.error(f"{tag} ERROR after {elapsed}: {type(error).__name__}: {error}")


_handler: ContextVar[Optional[AIDebugLogHandler]] = ContextVar(
    "ai_debug_log_handler",
    default=AIDebugLogHandler() if ai_debug_enabled() else None,
)
register_configure_hook(_handler, inheritable=True)

if ai_debug_enabled():
    logger.warning(
        f"{ENV_VAR} is on: every LLM prompt and answer is written to the log. "
        "Development only."
    )
