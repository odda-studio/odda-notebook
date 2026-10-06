import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/index";
import { OddaNotebookChat } from "../src/chat-element";
import { mockFetch, sse, until } from "./helpers";

function make(attrs: Record<string, string> = {}): OddaNotebookChat {
  const e = document.createElement("odda-notebook-chat") as OddaNotebookChat;
  const base = { "api-url": "https://api.test/", "notebook-id": "notebook:1", "widget-key": "onw_key", ...attrs };
  for (const [k, v] of Object.entries(base)) if (v !== "__omit") e.setAttribute(k, v);
  document.body.append(e);
  return e;
}
const q = (e: HTMLElement, s: string) => e.shadowRoot!.querySelector(s) as HTMLElement;
const qa = (e: HTMLElement, s: string) => Array.from(e.shadowRoot!.querySelectorAll(s)) as HTMLElement[];
const texts = (e: HTMLElement, cls: string) => qa(e, `.msg.${cls} .bubble`).map((b) => b.textContent ?? "");

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("odda-notebook-chat", () => {
  it("can be defined twice without throwing", async () => {
    await expect(import("../src/index")).resolves.toBeTruthy();
    vi.resetModules();
    await expect(import("../src/index")).resolves.toBeTruthy();
  });

  it("renders a config error and logs once when attributes are missing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = make({ "widget-key": "__omit" });
    expect(q(e, ".config-error").hidden).toBe(false);
    expect(q(e, ".config-error").textContent).toContain("widget-key");
    e.setAttribute("title", "x");
    e.setAttribute("lang", "it");
    expect(spy).toHaveBeenCalledTimes(1);
    e.setAttribute("widget-key", "k");
    expect(q(e, ".config-error").hidden).toBe(true);
  });

  it("sends the right request and streams tokens", async () => {
    const f = mockFetch({ chunks: sse({ type: "token", text: "Hel" }, { type: "token", text: "lo **w**" }, { type: "done" }) });
    const e = make({ "search-mode": "full", lang: "it" });
    const answers: string[] = [];
    const sent: string[] = [];
    e.addEventListener("onw-answer", (ev) => answers.push((ev as CustomEvent).detail.text));
    e.addEventListener("onw-message", (ev) => sent.push((ev as CustomEvent).detail.text));
    await e.ask("  ciao  ");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/widget/chat");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Widget-Key"]).toBe("onw_key");
    expect(JSON.parse(init.body as string)).toEqual({
      notebook_id: "notebook:1", message: "ciao", history: [], search_mode: "full", language: "it",
    });
    expect(texts(e, "user")).toEqual(["Tu: ciao"]);
    expect(q(e, ".msg.assistant .bubble strong").textContent).toBe("w");
    expect(answers).toEqual(["Hello **w**"]);
    expect(sent).toEqual(["ciao"]);
  });

  it("defaults search_mode and language", async () => {
    const f = mockFetch({ chunks: sse({ type: "done" }) });
    const e = make();
    await e.ask("x");
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.search_mode).toBe("insights-first");
    expect(body.language).toBe("en");
  });

  it("sends the last max-history turns only (cap 10), excluding errors and the new message", async () => {
    const f = mockFetch({ chunks: sse({ type: "token", text: "A" }, { type: "done" }) });
    const e = make({ "max-history": "4" });
    for (let i = 0; i < 4; i++) await e.ask(`q${i}`);
    await e.ask("last");
    const body = JSON.parse((f.mock.calls[4] as unknown as [string, RequestInit])[1].body as string);
    expect(body.history.map((h: { content: string }) => h.content)).toEqual(["q2", "A", "q3", "A"]);
    expect(body.history.every((h: { role: string }) => h.role === "user" || h.role === "assistant")).toBe(true);

    const e2 = make({ "max-history": "99" });
    for (let i = 0; i < 8; i++) await e2.ask(`q${i}`);
    const body2 = JSON.parse((f.mock.calls[f.mock.calls.length - 1] as unknown as [string, RequestInit])[1].body as string);
    expect(body2.history.length).toBe(10);
  });

  it.each([
    [401, {}, "not available"],
    [403, {}, "not available"],
    [503, {}, "Something went wrong"],
  ])("maps HTTP %i", async (status, headers, expected) => {
    mockFetch({ status, headers, json: { detail: "secret detail" } });
    const e = make();
    const errs: any[] = [];
    e.addEventListener("onw-error", (ev) => errs.push((ev as CustomEvent).detail));
    await e.ask("x");
    expect(q(e, ".msg.error").textContent).toContain(expected);
    expect(q(e, ".msg.error").textContent).not.toContain("secret");
    expect(errs[0].status).toBe(status);
    expect(q(e, ".retry")).toBeTruthy();
  });

  it("shows Retry-After on 429", async () => {
    mockFetch({ status: 429, headers: { "Retry-After": "17" }, json: { detail: "rate" } });
    const e = make();
    await e.ask("x");
    expect(q(e, ".msg.error").textContent).toContain("17 seconds");
  });

  it("maps network failure and stream error events", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const e = make();
    await e.ask("x");
    expect(q(e, ".msg.error").textContent).toContain("Something went wrong");

    mockFetch({ chunks: sse({ type: "token", text: "par" }, { type: "error", code: "unavailable", message: "Model busy" }) });
    const e2 = make();
    await e2.ask("y");
    expect(q(e2, ".msg.error").textContent).toContain("Model busy");
    expect(texts(e2, "assistant")).toEqual(["Assistant: par"]);
  });

  it("retry resends the last message without duplicating it and excludes the failed turn", async () => {
    let n = 0;
    const f = mockFetch(() => (n++ === 0 ? { status: 503 } : { chunks: sse({ type: "token", text: "ok" }, { type: "done" }) }));
    const e = make();
    await e.ask("hello");
    q(e, ".retry").click();
    await until(() => texts(e, "assistant").length === 1);
    expect(texts(e, "user")).toEqual(["You: hello"]);
    expect(qa(e, ".msg.error").length).toBe(0);
    const body = JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(body.history).toEqual([]);
    expect(body.message).toBe("hello");
  });

  it("disables input while streaming and Stop keeps the partial text", async () => {
    mockFetch({ chunks: sse({ type: "token", text: "partial text" }), hang: true });
    const e = make();
    const answers: string[] = [];
    e.addEventListener("onw-answer", (ev) => answers.push((ev as CustomEvent).detail.text));
    const p = e.ask("go");
    await until(() => texts(e, "assistant")[0]?.includes("partial text") ?? false);
    expect((q(e, ".input") as HTMLTextAreaElement).disabled).toBe(true);
    expect(q(e, ".stop").hidden).toBe(false);
    q(e, ".stop").click();
    await p;
    expect(texts(e, "assistant")).toEqual(["Assistant: partial text"]);
    expect(qa(e, ".msg.error").length).toBe(0);
    expect((q(e, ".input") as HTMLTextAreaElement).disabled).toBe(false);
    expect(answers).toEqual([]);
  });

  it("shows typing indicator before the first token", async () => {
    mockFetch({ chunks: [], hang: true });
    const e = make();
    const p = e.ask("x");
    await until(() => !!q(e, ".dots"));
    e.reset();
    await p;
    expect(qa(e, ".msg").length).toBe(0);
  });

  it("persists to sessionStorage and restores", async () => {
    mockFetch({ chunks: sse({ type: "token", text: "A1" }, { type: "done" }) });
    const e = make();
    await e.ask("Q1");
    expect(JSON.parse(sessionStorage.getItem("odda-notebook-widget:notebook:1")!)).toEqual([
      { role: "user", content: "Q1" }, { role: "assistant", content: "A1" },
    ]);
    const e2 = make();
    expect(texts(e2, "user")).toEqual(["You: Q1"]);
    expect(texts(e2, "assistant")).toEqual(["Assistant: A1"]);
    e2.reset();
    expect(sessionStorage.getItem("odda-notebook-widget:notebook:1")).toBeNull();
  });

  it("persist=none does not touch storage", async () => {
    mockFetch({ chunks: sse({ type: "token", text: "A" }, { type: "done" }) });
    const e = make({ persist: "none" });
    await e.ask("Q");
    expect(sessionStorage.length).toBe(0);
  });

  it("escapes model output (no injected elements)", async () => {
    mockFetch({ chunks: sse({ type: "token", text: '<img src=x onerror=alert(1)> [a](javascript:alert(1))' }, { type: "done" }) });
    const e = make();
    await e.ask("x");
    expect(qa(e, ".bubble img").length).toBe(0);
    expect(qa(e, ".bubble a").length).toBe(0);
  });

  it("shows welcome message and suggestions until the first message", async () => {
    mockFetch({ chunks: sse({ type: "done" }) });
    const e = make({ "welcome-message": "Hi **there**", suggestions: '["One","Two"]' });
    expect(q(e, ".welcome .bubble strong").textContent).toBe("there");
    expect(qa(e, ".chip").map((c) => c.textContent)).toEqual(["One", "Two"]);
    e.setAttribute("suggestions", "A | B | C");
    expect(qa(e, ".chip").map((c) => c.textContent)).toEqual(["A", "B", "C"]);
    qa(e, ".chip")[1]!.click();
    await until(() => texts(e, "user").length === 1);
    expect(texts(e, "user")).toEqual(["You: B"]);
    expect(qa(e, ".chip").length).toBe(0);
  });

  it("Enter sends, Shift+Enter and IME composition do not", async () => {
    const f = mockFetch({ chunks: sse({ type: "done" }) });
    const e = make();
    const input = q(e, ".input") as HTMLTextAreaElement;
    input.value = "hi";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
    expect(f).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await until(() => f.mock.calls.length === 1);
    expect(input.value).toBe("");
  });

  it("reacts to attribute changes and exposes a11y roles", () => {
    const e = make({ title: "Help", placeholder: "Type", theme: "dark", "show-reset": "false", "primary-color": "#ff0000" });
    expect(q(e, ".title").textContent).toBe("Help");
    expect((q(e, ".input") as HTMLTextAreaElement).placeholder).toBe("Type");
    expect(q(e, ".root").dataset.theme).toBe("dark");
    expect(q(e, ".icon-btn").hidden).toBe(true);
    expect(q(e, ".root").style.getPropertyValue("--onw-primary")).toBe("#ff0000");
    expect(q(e, ".log").getAttribute("role")).toBe("log");
    expect(q(e, ".log").getAttribute("aria-live")).toBe("polite");
    e.setAttribute("title", "Aiuto");
    expect(q(e, ".title").textContent).toBe("Aiuto");
    e.setAttribute("primary-color", "red;}body{display:none");
    expect(q(e, ".root").getAttribute("style") ?? "").not.toContain("display");
  });

  it("multiple instances do not interfere", async () => {
    mockFetch({ chunks: sse({ type: "token", text: "A" }, { type: "done" }) });
    const a = make({ "notebook-id": "n:a" });
    const b = make({ "notebook-id": "n:b" });
    await a.ask("only a");
    expect(texts(b, "user")).toEqual([]);
  });
});
