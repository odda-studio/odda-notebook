# Odda Notebook widget

Embeddable chat for any website that queries the RAG of **one** Odda Notebook notebook.
Two vanilla-TypeScript web components in a single zero-dependency bundle (Shadow DOM, ~10 KB gzipped):

- `<odda-notebook-chat>`: inline chat panel (messages, input, send/stop, suggestions, reset).
- `<odda-notebook-chatbot>`: floating launcher button that opens a chat window (full-screen under 480px wide).

## Embed

```html
<script src="https://YOUR-API/api/widget/embed.js" async></script>
<odda-notebook-chatbot api-url="https://YOUR-API" notebook-id="notebook:abc" widget-key="onw_..."></odda-notebook-chatbot>
```

Create the widget key from the notebook's **Widget** dialog. Use `<odda-notebook-chat>` instead for an inline panel.

## Attributes

All attributes are kebab-case, observed (changing them updates the UI).

| Attribute | Applies to | Default | Description |
|---|---|---|---|
| `api-url` | both | required | API origin, e.g. `https://notebooks.example.com` (trailing slash ignored) |
| `notebook-id` | both | required | Notebook to query |
| `widget-key` | both | required | Public widget key (`onw_...`) |
| `title` | both | `Assistant` | Header title / dialog label |
| `placeholder` | both | localised | Input placeholder |
| `welcome-message` | both | none | First assistant bubble (light Markdown); never sent as history |
| `suggestions` | both | none | JSON array string or `a\|b\|c`; clickable chips until the first message |
| `search-mode` | both | `insights-first` | `insights`, `insights-first` or `full` (sent to the API) |
| `lang` | both | `<html lang>` else `en` | `it` or `en`: UI strings; also sent as `language` |
| `theme` | both | `auto` | `light`, `dark`, `auto` (prefers-color-scheme) |
| `primary-color` | both | `#2000FF` | Any CSS colour |
| `persist` | both | `session` | `session` keeps the conversation in `sessionStorage` (key `odda-notebook-widget:<notebook-id>`); `none` disables |
| `show-reset` | both | `true` | Show the "new conversation" button |
| `max-history` | both | `10` | Completed messages sent as history (max 10) |
| `debug` | both | absent | Boolean: log request, each streamed token and the final answer to the browser console |
| `height` | chat | `100%` of host | CSS length. Host is `display:block`, default `height:520px; min-height:360px` (override with CSS on the element) |
| `open` | chatbot | absent | Boolean, reflected |
| `position` | chatbot | `bottom-right` | `bottom-right` or `bottom-left` |
| `button-label` | chatbot | `Open chat` | Accessible label / tooltip of the launcher |
| `offset` | chatbot | `20` | Pixels from the corner |
| `z-index` | chatbot | `2147483000` | Stacking order |

Note: `title` is a standard HTML attribute; the widget suppresses the native tooltip inside itself.

## Search mode

- `insights-first` (default): insights ranked first, with a few text passages as reinforcement.
- `insights`: insights only.
- `full`: full text passages plus insights.

## Methods

| Method | On | Description |
|---|---|---|
| `ask(text)` | both | Send a message programmatically (chatbot opens first); returns a Promise resolved when the answer ends |
| `reset()` | both | Abort any stream, clear conversation and stored history |
| `open()` / `close()` / `toggle()` | chatbot | Control the window (reflected in the `open` attribute; `isOpen` getter) |

## Events

`CustomEvent`, `bubbles: true, composed: true`.

| Event | `detail` | When |
|---|---|---|
| `onw-message` | `{ text }` | The visitor sends a message |
| `onw-answer` | `{ text }` | An answer completes (not when stopped) |
| `onw-error` | `{ status?, code?, message }` | Request or stream failure |
| `onw-open` / `onw-close` | none | Chatbot window opened / closed |

## Theming (CSS custom properties)

Set them on the element (or any ancestor); they cascade into the shadow root.

| Variable | Default (light) | Purpose |
|---|---|---|
| `--onw-primary` | `#2000FF` | Brand colour (also set by `primary-color`) |
| `--onw-on-primary` | `#fff` | Text on primary |
| `--onw-bg` | `#fff` (dark `#14141c`) | Panel background |
| `--onw-text` | `#14141f` (dark `#ececf3`) | Text |
| `--onw-muted` | `#5b5b6e` | Secondary text, placeholder |
| `--onw-border` | `#dcdce6` | Borders |
| `--onw-radius` | `14px` | Corner radius |
| `--onw-font` | `inherit` | Font family |
| `--onw-font-size` | `15px` | Base font size |
| `--onw-user-bubble` / `--onw-user-text` | primary / white | Visitor bubble |
| `--onw-assistant-bubble` / `--onw-assistant-text` | `#f0f0f6` / text | Assistant bubble |
| `--onw-link`, `--onw-focus` | primary (dark `#b3adff`) | Links, focus ring |
| `--onw-error`, `--onw-error-bg` | `#b00020`, `#fdecef` | Error bubble |
| `--onw-accent` | `#CBFD00` | Small accent dots |

```css
odda-notebook-chatbot { --onw-primary: #0a7; --onw-radius: 8px; --onw-font: "Inter", sans-serif; }
```

## Security notes

- The widget key is **public by design** (it is visible in your page). Restrict **allowed origins** for the key, set **rate limits** (per-minute and daily), and rotate or revoke it from the notebook's Widget dialog.
- Never use the API password in a website; the widget does not support it.
- Model and visitor text is HTML-escaped before the small built-in Markdown renderer emits a fixed set of tags; links are only `http(s)`/`mailto` with `rel="noopener noreferrer nofollow"`.
- The server never sends source titles, ids or notes to visitors.

## CORS / CSP

- The API must answer CORS preflights (header `X-Widget-Key`); the origin is checked per key.
- With a Content-Security-Policy, add the API origin to `script-src` (embed.js) and `connect-src` (chat requests). The widget loads no fonts or other remote resources. Styles are injected as `<style>` inside the shadow root: if you use a strict `style-src` without `'unsafe-inline'`, constructable stylesheets are not used, so allow inline styles for it.

## Frameworks

They are plain custom elements, so use them as-is.

React: `<odda-notebook-chat api-url="..." notebook-id="..." widget-key="..." />` (React 19 supports custom elements natively; for earlier versions pass only string attributes, and use a ref for events and methods).
Vue: add `isCustomElement: (tag) => tag.startsWith("odda-notebook-")` to the compiler options, then use the tag directly and `@onw-answer` for events.

## Development

```bash
cd widget
npm install
npm run typecheck
npm test            # vitest + jsdom
npm run build       # dist/odda-notebook-widget.js (minified IIFE + sourcemap) and dist/odda-notebook-widget.esm.js
npm run dev         # build + watch, mock server and demo at http://localhost:8787
```

The mock server (`demo/mock-server.mjs`, no dependencies) implements `POST /api/widget/chat` with SSE and serves `dist/` and `demo/`. Widget keys select the scenario: `bad` returns 401, `slow` 429 with `Retry-After: 7`, `down` 503, `fail` an `error` event mid-stream, anything else a streamed Markdown answer.

`dist/` is not committed; it is built by `make widget-build` and served by the API at `/api/widget/embed.js`.

```
widget/
  src/       api.ts (client + SSE parser), markdown.ts, i18n.ts, styles.ts, chat-element.ts, chatbot-element.ts, index.ts
  tests/     vitest suites
  demo/      index.html, mock-server.mjs
  dist/      build output (gitignored)
```
