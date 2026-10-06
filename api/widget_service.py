"""
Website widget: authentication by widget key, abuse limits and the streamed
RAG answer behind ``POST /api/widget/chat``.

The widget runs on public websites, so everything here assumes a hostile
caller: the key only reaches ONE notebook, notes are never searched, source
titles/ids never leave the server, request sizes are bounded, and
rate/daily limits cap what a leaked key can cost.
"""

import json
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import AsyncIterator, Callable, Deque, Dict, List, Optional, Tuple

from ai_prompter import Prompter
from fastapi import HTTPException
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from loguru import logger

from api.models import WidgetChatRequest
from open_notebook.ai.models import model_manager
from open_notebook.ai.provision import provision_langchain_model
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.widget import WidgetKey
from open_notebook.exceptions import ConfigurationError
from open_notebook.utils.context_builder import build_retrieval_context
from open_notebook.utils.text_utils import extract_text_content

MAX_PASSAGE_CHARS = 3000
MAX_ANSWER_TOKENS = 1500
INSIGHT_BOOST = 0.15
INSIGHTS_FIRST_CHUNK_LIMIT = 3
LAST_USED_THROTTLE_SECONDS = 60
ANON_LIMIT_PER_MINUTE = 30
TRUST_FORWARDED_ENV = "OPEN_NOTEBOOK_TRUST_FORWARDED_FOR"

# (full-text sources, insights-only sources, max passages, boost, chunk cap)
SEARCH_MODES = ("insights", "insights-first", "full")


# =============================================================================
# Abuse limits (in memory: per API process; fine for the single-process default)
# =============================================================================


class SlidingWindowLimiter:
    def __init__(self, now: Callable[[], float] = time.monotonic):
        self._now = now
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)

    def hit(self, bucket: str, limit: int, window: float = 60.0) -> Optional[int]:
        """Record a hit; returns None if allowed, else seconds to wait."""
        now = self._now()
        hits = self._hits[bucket]
        while hits and hits[0] <= now - window:
            hits.popleft()
        if len(hits) >= limit:
            return max(1, int(hits[0] + window - now) + 1)
        hits.append(now)
        if len(self._hits) > 20_000:  # bound memory under a flood of IPs
            self._purge(now, window)
        return None

    def _purge(self, now: float, window: float) -> None:
        for bucket in [b for b, h in self._hits.items() if not h or h[-1] <= now - window]:
            del self._hits[bucket]


class DailyCounter:
    def __init__(self, today: Callable[[], str] = lambda: datetime.now(timezone.utc).date().isoformat()):
        self._today = today
        self._counts: Dict[Tuple[str, str], int] = {}

    def hit(self, key_id: str, limit: int) -> bool:
        """Count a message; False when the daily limit is already reached."""
        if limit <= 0:
            return True
        today = self._today()
        for stale in [k for k in self._counts if k[1] != today]:
            del self._counts[stale]
        used = self._counts.get((key_id, today), 0)
        if used >= limit:
            return False
        self._counts[(key_id, today)] = used + 1
        return True


_rate_limiter = SlidingWindowLimiter()
_anon_limiter = SlidingWindowLimiter()
_daily = DailyCounter()
_last_used: Dict[str, float] = {}


def client_ip(headers: Dict[str, str], peer: Optional[str]) -> str:
    """Visitor IP. ``X-Forwarded-For`` is honoured only when explicitly
    trusted (behind your reverse proxy); otherwise any caller could spoof it
    to dodge the rate limit."""
    if os.environ.get(TRUST_FORWARDED_ENV, "").strip().lower() in ("1", "true", "yes"):
        forwarded = headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return peer or "unknown"


def _cors(origin: Optional[str]) -> Dict[str, str]:
    return {"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if origin else {}


# =============================================================================
# Authentication
# =============================================================================


async def authenticate(
    key: Optional[str],
    notebook_id: str,
    origin: Optional[str],
    ip: str,
) -> WidgetKey:
    headers = _cors(origin)
    wait = _anon_limiter.hit(f"anon:{ip}", ANON_LIMIT_PER_MINUTE)
    if wait:
        raise HTTPException(429, "Too many requests", {**headers, "Retry-After": str(wait)})

    widget_key = await WidgetKey.find_by_key(key) if key else None
    if widget_key is None or not widget_key.enabled:
        raise HTTPException(401, "Invalid or disabled widget key", headers)
    if str(widget_key.notebook) != notebook_id:
        raise HTTPException(403, "This key does not belong to that notebook", headers)
    if not widget_key.origin_allowed(origin):
        raise HTTPException(403, "Origin not allowed for this widget key", headers)

    key_id = str(widget_key.id)
    wait = _rate_limiter.hit(f"{key_id}:{ip}", widget_key.rate_limit_per_minute)
    if wait:
        raise HTTPException(
            429, "Rate limit reached, please slow down", {**headers, "Retry-After": str(wait)}
        )
    if not _daily.hit(key_id, widget_key.daily_limit):
        raise HTTPException(
            429, "Daily message limit reached for this widget", {**headers, "Retry-After": "3600"}
        )

    await _touch(widget_key)
    return widget_key


async def _touch(widget_key: WidgetKey) -> None:
    key_id = str(widget_key.id)
    now = time.monotonic()
    if now - _last_used.get(key_id, -1e9) < LAST_USED_THROTTLE_SECONDS:
        return
    _last_used[key_id] = now
    try:
        await repo_query(
            "UPDATE $id SET last_used_at = time::now()", {"id": ensure_record_id(key_id)}
        )
    except Exception as e:  # bookkeeping must never fail a visitor's request
        logger.debug(f"Could not update last_used_at for {key_id}: {e}")


# =============================================================================
# Answer
# =============================================================================


class ThinkStripper:
    """Drops ``<think>...</think>`` spans from a token stream, even when the
    tags are split across chunks."""

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self) -> None:
        self._buf = ""
        self._inside = False
        self._started = False

    @staticmethod
    def _partial_suffix(text: str, tag: str) -> int:
        for size in range(min(len(tag) - 1, len(text)), 0, -1):
            if tag.startswith(text[-size:]):
                return size
        return 0

    def feed(self, text: str) -> str:
        self._buf += text
        out: List[str] = []
        while True:
            if not self._inside:
                idx = self._buf.find(self.OPEN)
                if idx >= 0:
                    out.append(self._buf[:idx])
                    self._buf = self._buf[idx + len(self.OPEN):]
                    self._inside = True
                    continue
                keep = self._partial_suffix(self._buf, self.OPEN)
                out.append(self._buf[: len(self._buf) - keep])
                self._buf = self._buf[len(self._buf) - keep:]
                break
            idx = self._buf.find(self.CLOSE)
            if idx >= 0:
                self._buf = self._buf[idx + len(self.CLOSE):]
                self._inside = False
                continue
            keep = self._partial_suffix(self._buf, self.CLOSE)
            self._buf = self._buf[len(self._buf) - keep:]
            break
        return self._emit("".join(out))

    def flush(self) -> str:
        rest = "" if self._inside else self._buf
        self._buf = ""
        return self._emit(rest)

    def _emit(self, text: str) -> str:
        if not self._started:
            text = text.lstrip()
            self._started = bool(text)
        return text


def _retrieval_query(history: List[Dict[str, str]], message: str) -> str:
    """Follow-ups ("and its price?") only make sense with the previous question."""
    previous = [h["content"] for h in history if h["role"] == "user"]
    return f"{previous[-1]}\n{message}" if previous else message


def render_context(context: Dict) -> str:
    """Retrieved passages as plain text: no titles, ids or scores."""
    passages: List[str] = []
    for entry in [*context.get("sources", []), *context.get("notes", [])]:
        for passage in entry.get("passages", []):
            text = str(passage).strip()
            if text:
                passages.append(f"- {text[:MAX_PASSAGE_CHARS]}")
    return "\n\n".join(passages) if passages else "(no relevant information was found)"


@dataclass
class PreparedAnswer:
    messages: List[BaseMessage]
    model: object
    passages: int


async def _notebook_source_ids(notebook_id: str) -> List[str]:
    rows = await repo_query(
        "SELECT VALUE in FROM reference WHERE out = $nb", {"nb": ensure_record_id(notebook_id)}
    )
    return [str(r) for r in rows]


async def prepare_answer(widget_key: WidgetKey, body: WidgetChatRequest, origin: Optional[str]) -> PreparedAnswer:
    """Retrieval + model provisioning. Runs BEFORE streaming so setup failures
    still return a proper HTTP status."""
    headers = _cors(origin)
    if not await model_manager.get_embedding_model():
        raise HTTPException(503, "The assistant is not available right now", headers)

    source_ids = await _notebook_source_ids(str(widget_key.notebook))
    history = [{"role": h.role, "content": h.content} for h in body.history]
    query = _retrieval_query(history, body.message)

    mode = body.search_mode
    options: Dict = {"max_passages": 8}
    if mode == "insights":
        options.update(full_source_ids=[], insight_source_ids=source_ids)
    elif mode == "insights-first":
        options.update(
            full_source_ids=source_ids,
            insight_boost=INSIGHT_BOOST,
            chunk_limit=INSIGHTS_FIRST_CHUNK_LIMIT,
        )
    else:
        options.update(full_source_ids=source_ids, max_passages=10)

    context, passages = await build_retrieval_context(
        str(widget_key.notebook),
        query,
        note_ids=[],  # research notes are private: never exposed to visitors
        **options,
    )

    system_prompt = Prompter(prompt_template="widget/system").render(
        data={"context": render_context(context), "language": body.language}
    )
    messages: List[BaseMessage] = [SystemMessage(content=system_prompt)]
    for turn in history:
        messages.append(
            HumanMessage(content=turn["content"])
            if turn["role"] == "user"
            else AIMessage(content=turn["content"])
        )
    messages.append(HumanMessage(content=body.message))

    try:
        model = await provision_langchain_model(
            str(messages), None, "chat", max_tokens=MAX_ANSWER_TOKENS
        )
    except ConfigurationError:
        logger.warning("Widget chat: no chat model configured")
        raise HTTPException(503, "The assistant is not available right now", headers)
    return PreparedAnswer(messages=messages, model=model, passages=passages)


def _sse(payload: Dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def stream_answer(prepared: PreparedAnswer) -> AsyncIterator[str]:
    stripper = ThinkStripper()
    try:
        async for chunk in prepared.model.astream(prepared.messages):  # type: ignore[attr-defined]
            text = stripper.feed(extract_text_content(chunk.content))
            if text:
                yield _sse({"type": "token", "text": text})
        tail = stripper.flush()
        if tail:
            yield _sse({"type": "token", "text": tail})
        yield _sse({"type": "done"})
    except Exception as e:
        # Details stay in the server log; the visitor gets a safe message
        logger.error(f"Widget chat stream failed: {type(e).__name__}: {e}")
        yield _sse({"type": "error", "code": "unavailable",
                    "message": "The assistant is temporarily unavailable. Please try again."})
