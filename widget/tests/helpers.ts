import { vi } from "vitest";

export interface FakeOpts {
  status?: number;
  headers?: Record<string, string>;
  chunks?: string[];
  json?: unknown;
  /** if set, the stream stays open until the signal aborts after the chunks */
  hang?: boolean;
}

export function fakeResponse(o: FakeOpts, signal?: AbortSignal): Response {
  const status = o.status ?? 200;
  const enc = new TextEncoder();
  const chunks = [...(o.chunks ?? [])];
  const reader = {
    read: () => {
      const c = chunks.shift();
      if (c !== undefined) return Promise.resolve({ done: false, value: enc.encode(c) });
      if (o.hang) {
        return new Promise((_res, rej) => {
          const err = new DOMException("aborted", "AbortError");
          if (signal?.aborted) rej(err);
          signal?.addEventListener("abort", () => rej(err));
        });
      }
      return Promise.resolve({ done: true, value: undefined });
    },
    cancel: () => Promise.resolve(),
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => o.headers?.[k] ?? o.headers?.[k.toLowerCase()] ?? null },
    json: () => Promise.resolve(o.json ?? {}),
    text: () => Promise.resolve((o.chunks ?? []).join("")),
    body: { getReader: () => reader },
  } as unknown as Response;
}

export function sse(...events: unknown[]): string[] {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
}

export function mockFetch(o: FakeOpts | ((init: RequestInit) => FakeOpts)) {
  const f = vi.fn((_url: unknown, init?: RequestInit) => {
    const opts = typeof o === "function" ? o(init ?? {}) : o;
    return Promise.resolve(fakeResponse(opts, init?.signal ?? undefined));
  });
  vi.stubGlobal("fetch", f);
  return f;
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
export async function until(cond: () => boolean, ms = 1000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick(5);
  }
}
