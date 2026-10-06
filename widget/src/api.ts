export type SearchMode = "insights" | "insights-first" | "full";

export interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  notebook_id: string;
  message: string;
  history?: HistoryItem[];
  search_mode?: SearchMode;
  language?: string;
}

export type SSEEvent =
  | { type: "token"; text: string }
  | { type: "done" }
  | { type: "error"; code?: string; message?: string };

export type ErrorKind = "auth" | "rate" | "unavailable" | "network" | "stream" | "http";

export class WidgetApiError extends Error {
  kind: ErrorKind;
  status?: number;
  code?: string;
  retryAfter?: number;
  constructor(kind: ErrorKind, message: string, extra: { status?: number; code?: string; retryAfter?: number } = {}) {
    super(message);
    this.name = "WidgetApiError";
    this.kind = kind;
    this.status = extra.status;
    this.code = extra.code;
    this.retryAfter = extra.retryAfter;
  }
}

/** Parse one raw SSE block (lines between blank lines) into a typed event, or null. */
function parseBlock(block: string): SSEEvent | null {
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (!data.length) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(data.join("\n"));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o.type === "token" && typeof o.text === "string") return { type: "token", text: o.text };
  if (o.type === "done") return { type: "done" };
  if (o.type === "error") {
    return {
      type: "error",
      code: typeof o.code === "string" ? o.code : undefined,
      message: typeof o.message === "string" ? o.message : undefined,
    };
  }
  return null; // unknown event types are ignored
}

/**
 * Incremental SSE parser. Feed arbitrary text chunks (they may split lines or
 * JSON anywhere); complete events are emitted in order.
 */
export class SSEParser {
  private buf = "";
  constructor(private onEvent: (e: SSEEvent) => void) {}

  feed(chunk: string): void {
    this.buf += chunk;
    // Normalise CRLF; a trailing lone CR may be the first half of a CRLF, keep it.
    this.buf = this.buf.replace(/\r\n/g, "\n").replace(/\r(?!$)/g, "\n");
    let idx: number;
    while ((idx = this.buf.indexOf("\n\n")) !== -1) {
      const block = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      const ev = parseBlock(block);
      if (ev) this.onEvent(ev);
    }
  }

  /** Flush a trailing event that was not terminated by a blank line. */
  end(): void {
    const rest = this.buf.replace(/\r/g, "\n").trim();
    this.buf = "";
    if (rest) {
      const ev = parseBlock(rest);
      if (ev) this.onEvent(ev);
    }
  }
}

export interface StreamOptions {
  apiUrl: string;
  widgetKey: string;
  body: ChatRequestBody;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onToken: (text: string) => void;
}

export function chatUrl(apiUrl: string): string {
  return apiUrl.trim().replace(/\/+$/, "") + "/api/widget/chat";
}

async function readDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { detail?: unknown };
    if (typeof j?.detail === "string") return j.detail;
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status}`;
}

/**
 * POST the question and stream the answer. Resolves when the stream completes
 * (a `done` event or a clean end of stream with some text). Rejects with
 * WidgetApiError, or with the AbortError when aborted.
 */
export async function streamChat(opts: StreamOptions): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(chatUrl(opts.apiUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-Widget-Key": opts.widgetKey,
      },
      body: JSON.stringify(opts.body),
      credentials: "omit",
      signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new WidgetApiError("network", e instanceof Error ? e.message : "Network error");
  }

  if (!res.ok) {
    const status = res.status;
    const detail = await readDetail(res);
    if (status === 401 || status === 403) throw new WidgetApiError("auth", detail, { status });
    if (status === 429) {
      const ra = parseInt(res.headers.get("Retry-After") ?? "", 10);
      throw new WidgetApiError("rate", detail, { status, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined });
    }
    throw new WidgetApiError(status === 503 ? "unavailable" : "http", detail, { status });
  }

  let finished = false;
  let gotText = false;
  let streamError: WidgetApiError | null = null;
  const parser = new SSEParser((ev) => {
    if (finished || streamError) return;
    if (ev.type === "token") {
      if (ev.text) gotText = true;
      opts.onToken(ev.text);
    } else if (ev.type === "done") finished = true;
    else if (ev.type === "error") {
      streamError = new WidgetApiError("stream", ev.message || "", { code: ev.code });
    }
  });

  if (!res.body) {
    parser.feed(await res.text());
    parser.end();
  } else {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
        if (finished || streamError) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
      }
      parser.feed(decoder.decode());
      parser.end();
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      throw new WidgetApiError("network", e instanceof Error ? e.message : "Network error");
    }
  }

  if (streamError) throw streamError;
  if (!finished && !gotText) throw new WidgetApiError("network", "Stream ended unexpectedly");
}
