import { describe, expect, it } from "vitest";
import { SSEEvent, SSEParser } from "../src/api";

function parse(chunks: string[]): SSEEvent[] {
  const out: SSEEvent[] = [];
  const p = new SSEParser((e) => out.push(e));
  chunks.forEach((c) => p.feed(c));
  p.end();
  return out;
}

describe("SSEParser", () => {
  it("parses multiple events in one chunk", () => {
    expect(parse(['data: {"type":"token","text":"a"}\n\ndata: {"type":"token","text":"b"}\n\ndata: {"type":"done"}\n\n'])).toEqual([
      { type: "token", text: "a" },
      { type: "token", text: "b" },
      { type: "done" },
    ]);
  });
  it("handles chunks split mid-line and mid-JSON", () => {
    expect(parse(['da', 'ta: {"type":"tok', 'en","text":"hel', 'lo"}\n', "\ndata: {", '"type":"done"}\n\n'])).toEqual([
      { type: "token", text: "hello" },
      { type: "done" },
    ]);
  });
  it("handles CRLF, even when split between CR and LF", () => {
    expect(parse(['data: {"type":"token","text":"x"}\r\n\r', '\ndata: {"type":"done"}\r\n\r\n'])).toEqual([
      { type: "token", text: "x" },
      { type: "done" },
    ]);
  });
  it("ignores malformed JSON, unknown types, comments and non-data lines", () => {
    expect(
      parse([': keepalive\n\n', "data: {nope\n\n", 'data: {"type":"weird"}\n\n', "event: x\n\n", 'data: {"type":"token"}\n\n', 'data: {"type":"token","text":"ok"}\n\n']),
    ).toEqual([{ type: "token", text: "ok" }]);
  });
  it("parses error events", () => {
    expect(parse(['data: {"type":"error","code":"unavailable","message":"Down"}\n\n'])).toEqual([
      { type: "error", code: "unavailable", message: "Down" },
    ]);
  });
  it("preserves unicode and escaped newlines in tokens", () => {
    expect(parse(['data: {"type":"token","text":"à\\n\\u00e8 😀"}\n\n'])).toEqual([{ type: "token", text: "à\nè 😀" }]);
  });
  it("flushes a final unterminated event on end()", () => {
    expect(parse(['data: {"type":"done"}'])).toEqual([{ type: "done" }]);
  });
});
