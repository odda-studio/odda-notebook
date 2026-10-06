import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/index";
import { OddaNotebookChatbot } from "../src/chatbot-element";
import { mockFetch, sse, until } from "./helpers";

function make(attrs: Record<string, string> = {}): OddaNotebookChatbot {
  const e = document.createElement("odda-notebook-chatbot") as OddaNotebookChatbot;
  const base = { "api-url": "https://api.test", "notebook-id": "n:1", "widget-key": "k", ...attrs };
  for (const [k, v] of Object.entries(base)) e.setAttribute(k, v);
  document.body.append(e);
  return e;
}
const q = (e: HTMLElement, s: string) => e.shadowRoot!.querySelector(s) as HTMLElement;

afterEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("odda-notebook-chatbot", () => {
  it("starts closed with correct aria", () => {
    const e = make({ title: "Help" });
    const l = q(e, ".launcher");
    expect(l.getAttribute("aria-expanded")).toBe("false");
    expect(l.getAttribute("aria-controls")).toBe(q(e, ".window").id);
    expect(q(e, ".window").hidden).toBe(true);
    expect(q(e, ".window").getAttribute("role")).toBe("dialog");
    expect(q(e, ".window").getAttribute("aria-label")).toBe("Help");
    expect(l.getAttribute("aria-label")).toBe("Open chat");
  });

  it("opens/closes via click, reflects `open`, fires events and manages focus", () => {
    const e = make();
    const events: string[] = [];
    document.addEventListener("onw-open", () => events.push("open"));
    document.addEventListener("onw-close", () => events.push("close"));
    q(e, ".launcher").click();
    expect(e.hasAttribute("open")).toBe(true);
    expect(q(e, ".launcher").getAttribute("aria-expanded")).toBe("true");
    expect(q(e, ".window").hidden).toBe(false);
    const chat = q(e, "odda-notebook-chat");
    expect(chat.shadowRoot!.activeElement).toBe(chat.shadowRoot!.querySelector(".input"));
    e.close();
    expect(e.hasAttribute("open")).toBe(false);
    expect(events).toEqual(["open", "close"]);
    expect(e.shadowRoot!.activeElement).toBe(q(e, ".launcher"));
  });

  it("open/close/toggle methods and attribute changes", () => {
    const e = make();
    e.open();
    expect(e.isOpen).toBe(true);
    e.toggle();
    expect(e.hasAttribute("open")).toBe(false);
    e.setAttribute("open", "");
    expect(q(e, ".window").hidden).toBe(false);
    e.removeAttribute("open");
    expect(q(e, ".window").hidden).toBe(true);
  });

  it("closes on Escape and via the in-chat close button", () => {
    const e = make();
    e.open();
    q(e, "odda-notebook-chat").shadowRoot!.querySelector(".input")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
    expect(e.hasAttribute("open")).toBe(false);
    e.open();
    (q(e, "odda-notebook-chat").shadowRoot!.querySelector(".icon-btn:last-of-type") as HTMLElement).click();
    expect(e.hasAttribute("open")).toBe(false);
  });

  it("forwards shared attributes to the inner chat and keeps them in sync", () => {
    const e = make({ title: "T", "search-mode": "full", lang: "it", theme: "dark" });
    const chat = q(e, "odda-notebook-chat");
    expect(chat.getAttribute("search-mode")).toBe("full");
    expect(chat.getAttribute("widget-key")).toBe("k");
    e.setAttribute("title", "T2");
    e.removeAttribute("theme");
    expect(chat.getAttribute("title")).toBe("T2");
    expect(chat.hasAttribute("theme")).toBe(false);
  });

  it("position, offset, z-index, button-label", () => {
    const e = make({ position: "bottom-left", offset: "32", "z-index": "99", "button-label": "Chat now" });
    const w = q(e, ".wrap");
    expect(w.classList.contains("left")).toBe(true);
    expect(w.style.left).toBe("32px");
    expect(w.style.bottom).toBe("32px");
    expect(w.style.zIndex).toBe("99");
    expect(q(e, ".launcher").getAttribute("aria-label")).toBe("Chat now");
    e.setAttribute("position", "bottom-right");
    expect(w.style.right).toBe("32px");
  });

  it("bubbles composed chat events out of the shadow root and ask() opens the window", async () => {
    mockFetch({ chunks: sse({ type: "token", text: "yo" }, { type: "done" }) });
    const e = make();
    const got: string[] = [];
    document.addEventListener("onw-message", (ev) => got.push("m:" + (ev as CustomEvent).detail.text));
    document.addEventListener("onw-answer", (ev) => got.push("a:" + (ev as CustomEvent).detail.text));
    await e.ask("hi");
    expect(e.hasAttribute("open")).toBe(true);
    await until(() => got.length === 2);
    expect(got).toEqual(["m:hi", "a:yo"]);
  });
});
