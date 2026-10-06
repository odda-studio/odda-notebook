#!/usr/bin/env node
// Mock Odda Notebook widget backend + static server (no dependencies).
//   node demo/mock-server.mjs [--watch] [--port 8787]
// Keys: "bad" -> 401, "slow" -> 429 (Retry-After: 7), "down" -> 503,
//       "fail" -> error event mid-stream, anything else -> streamed answer.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]) || Number(process.env.PORT) || 8787;

if (args.includes("--watch")) {
  const { watch } = await import("../build.mjs");
  await watch();
  console.log("esbuild watching src/ -> dist/");
}

const ANSWER = `Here is a **canned answer** from the mock server.

- Insights are *ranked first*
- Then a few passages as reinforcement

You can read more at [Odda Notebook](https://example.com) or run \`npm run dev\`.

\`\`\`
const widget = "ok";
\`\`\`

1. First step
2. Second step`;

const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript", ".map": "application/json", ".css": "text/css", ".svg": "image/svg+xml" };
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Widget-Key, Accept",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Retry-After",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...cors, ...extra });
  res.end(JSON.stringify(body));
};

async function chat(req, res) {
  let raw = "";
  for await (const c of req) raw += c;
  const key = req.headers["x-widget-key"];
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(res, 422, { detail: "invalid body" });
  }
  if (!key || key === "bad") return json(res, 401, { detail: "invalid key" });
  if (key === "slow") return json(res, 429, { detail: "rate limit" }, { "Retry-After": "7" });
  if (key === "down") return json(res, 503, { detail: "no model configured" });
  if (typeof body.message !== "string" || !body.message || body.message.length > 2000) return json(res, 422, { detail: "invalid message" });
  console.log(`[chat] mode=${body.search_mode} lang=${body.language} history=${(body.history || []).length} msg=${JSON.stringify(body.message)}`);

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", ...cors });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  let closed = false;
  res.on("close", () => (closed = true));
  await sleep(500);
  const tokens = (`You asked: "${body.message}".\n\n` + ANSWER).match(/\s*\S+/g) ?? [];
  for (let i = 0; i < tokens.length && !closed; i++) {
    if (key === "fail" && i === 8) {
      send({ type: "error", code: "unavailable", message: "The assistant is temporarily unavailable." });
      return res.end();
    }
    send({ type: "token", text: tokens[i] });
    await sleep(35);
  }
  if (!closed) send({ type: "done" });
  res.end();
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (url.pathname === "/api/widget/chat" && req.method === "POST") return chat(req, res);
  let file;
  if (url.pathname === "/api/widget/embed.js") file = join(root, "dist/odda-notebook-widget.js");
  else if (url.pathname.startsWith("/dist/")) file = join(root, normalize(url.pathname));
  else file = join(root, "demo", url.pathname === "/" ? "index.html" : normalize(url.pathname));
  if (!resolve(file).startsWith(root) || !existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain", ...cors });
    return res.end("not found (did you run `npm run build`?)");
  }
  res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache", ...cors });
  res.end(await readFile(file));
}).listen(port, () => console.log(`Mock widget server: http://localhost:${port}/  (API at http://localhost:${port}/api/widget/chat)`));
