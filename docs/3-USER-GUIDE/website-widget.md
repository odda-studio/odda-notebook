# Website Widget - Put Your Notebook's Knowledge on a Website

Embed a chat on any website that answers visitors' questions from **one notebook**, using the same retrieval as the notebook chat (focused on the insights by default). It ships as two web components in the [`widget/`](../../widget/README.md) folder:

| Component | What it is |
|---|---|
| `<odda-notebook-chat>` | An inline chat panel you place anywhere in a page |
| `<odda-notebook-chatbot>` | A floating button that opens a chatbot window in a corner of the site |

## 1. Create a widget key

In the notebook header click **Website widget** → **New key**.

- **Name**: a label for you (e.g. "Company website").
- **Allowed origins**: the sites allowed to use the key, one per line (`https://www.example.com`, no path). Leave it empty to accept any origin (the dialog warns you).
- **Messages per minute** (per visitor) and **daily limit** (whole key; 0 = unlimited): they cap what abuse of a public key can cost you.

The full key (`onw_…`) is shown **once**: copy it now. If you lose it, regenerate it (the old key stops working immediately). You can disable, edit or delete a key at any time.

> The key is public by design (it sits in your page's HTML). It can only ask questions of that one notebook: it cannot read notes, titles, files or change anything, and it is **not** the API password, which must never be put on a website.

## 2. Add it to the site

The dialog gives you a ready-to-paste snippet:

```html
<script src="https://YOUR-API/api/widget/embed.js" async></script>

<odda-notebook-chatbot
  api-url="https://YOUR-API"
  notebook-id="notebook:abc123"
  widget-key="onw_…"
  title="Ask us anything"
  search-mode="insights-first"></odda-notebook-chatbot>
```

Use `<odda-notebook-chat height="560px" …>` instead for an inline chat. All attributes, events, methods and theming variables are documented in the [widget README](../../widget/README.md).

**`search-mode`** decides what the assistant searches:

| Value | Searches |
|---|---|
| `insights-first` (default) | Insights ranked first, plus a few passages of the original text as reinforcement |
| `insights` | Insights only: shorter, more predictable answers, but misses what only exists in the original text |
| `full` | Original text and insights, ranked by similarity |

The assistant only answers from the notebook; when the answer isn't there it says so. Your private **notes are never searched**, and source titles and ids are never sent to visitors.

## Requirements and operations

- A **chat model** and an **embedding model** configured (Settings → Models), the sources embedded, and the worker running for processing.
- The widget bundle is served by the API at `/api/widget/embed.js`. From source run `make widget-build` once (Docker images build it for you).
- Behind a reverse proxy, set `OPEN_NOTEBOOK_TRUST_FORWARDED_FOR=true` so the per-visitor rate limit uses the real client IP (`X-Forwarded-For`). Without it every visitor looks like the proxy. Only enable it if the proxy overwrites that header.
- The rate and daily counters live in the API process memory: they reset on restart.
- If the site sets a Content-Security-Policy, allow the API origin in `script-src` and `connect-src`.
- Disable response buffering for `/api/widget/chat` in your proxy (answers stream as Server-Sent Events); the API sends `X-Accel-Buffering: no` for nginx.
