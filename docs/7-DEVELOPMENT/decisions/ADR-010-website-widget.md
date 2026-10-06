# ADR-010: Website widget uses per-notebook widget keys on dedicated public endpoints

- **Status**: Accepted
- **Date**: 2026-10
- **Related**: [ADR-004](ADR-004-background-workers.md), [VISION.md](../../../VISION.md) (API-first, privacy), [Website Widget](../../3-USER-GUIDE/website-widget.md)

## Context

Customers want to embed a chat on public websites that queries the RAG of one notebook. The whole API is protected by a single shared password (CORS open by default, no rate limiting): putting that password in a web page would hand every visitor full read/write/delete access, and the existing chat endpoints need sessions, the whole context from the client and the password.

## Decision

- **A narrow public surface**: `POST /api/widget/chat` and `GET /api/widget/embed.js` are the only paths excluded from the password check. Everything else (including key management) stays behind it.
- **Per-notebook widget keys** (`widget_key`, migration 31): a bearer key (`onw_…`) bound to ONE notebook, stored as a SHA-256 hash, shown once, rotatable and revocable, with an optional exact-origin allowlist, a per-visitor per-minute limit and a daily cap. Authority is read-only questions on that notebook; notes are never searched and titles/ids/scores never leave the server.
- **Stateless, streamed answers**: the client sends the last turns, the server runs vector retrieval (insights boosted by default, `search-mode` per embed) and streams the model's tokens as SSE. No sessions or checkpoints are stored for visitors.
- **Dedicated CORS** for `/api/widget/*` (`WidgetCORSMiddleware`): the app-wide policy is meant for the app's own origins; here any origin may call, and access control is the per-key allowlist enforced by the endpoint.
- **Separate `widget/` package** (vanilla web components, Shadow DOM, zero runtime dependencies, esbuild) built into `widget/dist` and served by the API, so a site needs one `<script>` and one element.

## Alternatives considered

- **Sharing the API password with the widget** - rejected: full access for anyone who views the page source.
- **Customer-side proxy** - kept possible (the endpoint works server-to-server with keys that have no origin allowlist), but not required.
- **Reusing `/api/chat/execute`** - rejected: needs a session, trusts a client-built context and has no per-key limits.
- **Publishing a notebook with a public URL (NotebookLM-style share page)** - out of scope; the widget embeds into the customer's own site.

## Consequences

- A leaked key can only cost model usage within its limits; rotate or disable it from the notebook.
- Origin allowlists are enforced from the `Origin` header: they stop other websites in browsers, not a determined non-browser client that forges it, so the rate/daily limits are the real backstop.
- Counters are per API process and in memory (reset on restart; not shared between several API workers). Move them to SurrealDB if the API is scaled out.
- One extra build artifact (`make widget-build`, a Docker stage) must be present for `/api/widget/embed.js` to work.
