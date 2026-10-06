"""Website widget: keys, abuse limits, CORS, think-tag stripping, rendering."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from api import widget_service
from api.widget_cors import WidgetCORSMiddleware
from open_notebook.domain import widget as widget_domain
from open_notebook.exceptions import InvalidInputError


class TestOrigins:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("https://WWW.Example.com/", "https://www.example.com"),
            ("http://localhost:3000", "http://localhost:3000"),
            ("  https://a.io  ", "https://a.io"),
        ],
    )
    def test_normalized(self, raw, expected):
        assert widget_domain.normalize_origin(raw) == expected

    @pytest.mark.parametrize(
        "bad",
        ["example.com", "ftp://x.com", "https://x.com/path", "https://*.x.com", "https://u:p@x.com", "https://x.com?q=1", ""],
    )
    def test_rejected(self, bad):
        with pytest.raises(InvalidInputError):
            widget_domain.normalize_origin(bad)

    def test_list_is_deduplicated_and_blank_lines_ignored(self):
        assert widget_domain.normalize_origins(
            ["https://a.io", "https://A.io/", "", "  "]
        ) == ["https://a.io"]

    def test_allowlist_semantics(self):
        key = widget_domain.WidgetKey(
            notebook="notebook:1", name="k", key_hash="h", key_prefix="onw_x",
            allowed_origins=["https://a.io"],
        )
        assert key.origin_allowed("https://a.io") and key.origin_allowed("https://A.io/")
        assert not key.origin_allowed("https://b.io") and not key.origin_allowed(None)
        key.allowed_origins = []
        assert key.origin_allowed("https://anything.org") and key.origin_allowed(None)


def test_key_format_and_hash():
    key = widget_domain.generate_key()
    assert key.startswith("onw_") and len(key) >= 32
    assert widget_domain.generate_key() != key
    assert widget_domain.hash_key(key) == widget_domain.hash_key(key) != key


class TestLimits:
    def test_sliding_window(self):
        t = [0.0]
        limiter = widget_service.SlidingWindowLimiter(now=lambda: t[0])
        assert [limiter.hit("a", 2) for _ in range(2)] == [None, None]
        wait = limiter.hit("a", 2)
        assert wait is not None and 1 <= wait <= 61
        assert limiter.hit("b", 2) is None  # other visitors unaffected
        t[0] = 61.0
        assert limiter.hit("a", 2) is None  # window slid

    def test_daily_counter_resets_each_day(self):
        day = ["2026-10-02"]
        counter = widget_service.DailyCounter(today=lambda: day[0])
        assert counter.hit("k", 2) and counter.hit("k", 2) and not counter.hit("k", 2)
        day[0] = "2026-10-03"
        assert counter.hit("k", 2)
        assert all(counter.hit("unlimited", 0) for _ in range(5))

    def test_forwarded_for_only_when_trusted(self, monkeypatch):
        headers = {"x-forwarded-for": "9.9.9.9, 10.0.0.1"}
        monkeypatch.delenv(widget_service.TRUST_FORWARDED_ENV, raising=False)
        assert widget_service.client_ip(headers, "1.2.3.4") == "1.2.3.4"
        monkeypatch.setenv(widget_service.TRUST_FORWARDED_ENV, "true")
        assert widget_service.client_ip(headers, "1.2.3.4") == "9.9.9.9"
        assert widget_service.client_ip({}, None) == "unknown"


class TestThinkStripper:
    def run(self, chunks):
        stripper = widget_service.ThinkStripper()
        return "".join(stripper.feed(c) for c in chunks) + stripper.flush()

    def test_plain_text_passes_through(self):
        assert self.run(["Hello ", "world"]) == "Hello world"

    def test_tags_split_across_chunks(self):
        assert self.run(["<thi", "nk>secret", " more</th", "ink>Answer"]) == "Answer"

    def test_text_before_and_after(self):
        assert self.run(["A<think>x</think>B"]) == "AB"

    def test_lone_angle_bracket_is_kept(self):
        assert self.run(["1 < 2 and 3 <", " 4"]) == "1 < 2 and 3 < 4"

    def test_unterminated_think_is_dropped(self):
        assert self.run(["ok<think>never closed"]) == "ok"

    def test_leading_whitespace_after_think_is_trimmed(self):
        assert self.run(["<think>t</think>\n\n Hi"]) == "Hi"


def test_render_context_hides_titles_and_ids():
    context = {
        "sources": [{"id": "source:a", "title": "secret-cv.pdf", "similarity": 0.9, "passages": ["First", "  Second  "]}],
        "notes": [{"id": "note:n", "title": "private", "passages": ["Note text"]}],
    }
    text = widget_service.render_context(context)
    assert text == "- First\n\n- Second\n\n- Note text"
    assert "secret" not in text and "source:" not in text
    assert widget_service.render_context({"sources": [], "notes": []}) == "(no relevant information was found)"
    long = widget_service.render_context({"sources": [{"passages": ["x" * 10_000]}], "notes": []})
    assert len(long) <= widget_service.MAX_PASSAGE_CHARS + 2


def test_retrieval_query_uses_previous_user_question():
    history = [{"role": "user", "content": "Who is Mario?"}, {"role": "assistant", "content": "A dev."}]
    assert widget_service._retrieval_query(history, "Where does he live?") == "Who is Mario?\nWhere does he live?"
    assert widget_service._retrieval_query([], "Hi") == "Hi"


class TestCorsMiddleware:
    def client(self):
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]})
            await send({"type": "http.response.body", "body": b"ok"})

        wrapped = WidgetCORSMiddleware(app)

        async def call(method, path, headers):
            sent = []
            scope = {"type": "http", "method": method, "path": path,
                     "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]}

            async def receive():
                return {"type": "http.request", "body": b"", "more_body": False}

            async def send(message):
                sent.append(message)

            await wrapped(scope, receive, send)
            start = sent[0]
            return start["status"], {k.decode().lower(): v.decode() for k, v in start["headers"]}

        return lambda *a: asyncio.run(call(*a))

    def test_preflight_for_widget_paths(self):
        status, headers = self.client()("OPTIONS", "/api/widget/chat", {
            "Origin": "https://site.org", "Access-Control-Request-Method": "POST"})
        assert status == 204 and headers["access-control-allow-origin"] == "https://site.org"
        assert "x-widget-key" in headers["access-control-allow-headers"].lower()

    def test_real_response_gets_the_origin(self):
        status, headers = self.client()("POST", "/api/widget/chat", {"Origin": "https://site.org"})
        assert headers["access-control-allow-origin"] == "https://site.org"
        assert "retry-after" in headers["access-control-expose-headers"].lower()

    def test_other_paths_untouched(self):
        _, headers = self.client()("POST", "/api/notebooks", {"Origin": "https://site.org"})
        assert "access-control-allow-origin" not in headers

    def test_no_origin_no_headers(self):
        _, headers = self.client()("POST", "/api/widget/chat", {})
        assert "access-control-allow-origin" not in headers


def test_public_paths_skip_the_password_but_not_the_rest(monkeypatch):
    from api.auth import PasswordAuthMiddleware
    from api.main import app

    middleware = next(m for m in app.user_middleware if m.cls is PasswordAuthMiddleware)
    paths: list[str] = middleware.kwargs["excluded_paths"]  # type: ignore[assignment]
    assert "/api/widget/chat" in paths and "/api/widget/embed.js" in paths
    assert not [p for p in paths if p.startswith("/api/widget") and p not in ("/api/widget/chat", "/api/widget/embed.js")]
    assert "/api/widget-keys" not in paths and "/api/notebooks" not in paths


def test_embed_bundle_404_with_hint_when_not_built(monkeypatch, tmp_path):
    from api.main import app
    from api.routers import widget as widget_router

    monkeypatch.setattr(widget_router, "WIDGET_BUNDLE", tmp_path / "missing.js")
    response = TestClient(app).get("/api/widget/embed.js")
    assert response.status_code == 404 and "widget-build" in response.json()["detail"]

    bundle = tmp_path / "bundle.js"
    bundle.write_text("console.log(1)")
    monkeypatch.setattr(widget_router, "WIDGET_BUNDLE", bundle)
    ok = TestClient(app).get("/api/widget/embed.js")
    assert ok.status_code == 200 and "javascript" in ok.headers["content-type"]
