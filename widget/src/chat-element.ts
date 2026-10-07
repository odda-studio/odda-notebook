import {
  HistoryItem,
  SearchMode,
  WidgetApiError,
  streamChat,
} from "./api";
import { Lang, StringKey, resolveLang, t } from "./i18n";
import { renderMarkdown } from "./markdown";
import { chatCSS, safeCssValue } from "./styles";

type Role = "user" | "assistant";
interface Msg {
  role: Role | "error";
  content: string;
  el?: HTMLElement;
  bubble?: HTMLElement;
}

const raf: (cb: () => void) => number =
  typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 16) as unknown as number;
const caf = (id: number) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id));

const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6l.01 6.5L15 12 3.41 13.9z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const RESET_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

export const CHAT_ATTRS = [
  "api-url", "notebook-id", "widget-key", "title", "placeholder", "welcome-message", "suggestions",
  "search-mode", "lang", "theme", "primary-color", "persist", "show-reset", "max-history",
  "debug",
] as const;

export function parseSuggestions(raw: string | null): string[] {
  if (!raw || !raw.trim()) return [];
  const s = raw.trim();
  let list: unknown[] = [];
  if (s.startsWith("[")) {
    try {
      const j: unknown = JSON.parse(s);
      if (Array.isArray(j)) list = j;
    } catch {
      list = s.split("|");
    }
  } else list = s.split("|");
  return list
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html; // only used with static trusted strings
  return e;
}

export class OddaNotebookChat extends HTMLElement {
  static get observedAttributes(): string[] {
    return [...CHAT_ATTRS, "height", "embedded"];
  }

  private root = el("div", "root");
  private dyn = document.createElement("style");
  private header = el("div", "header");
  private titleEl = el("h2", "title");
  private resetBtn = el("button", "icon-btn", RESET_ICON);
  private closeBtn = el("button", "icon-btn", CLOSE_ICON);
  private log = el("div", "log");
  private welcomeEl = el("div", "welcome");
  private suggestionsEl = el("div", "suggestions");
  private form = el("form", "form");
  private input = el("textarea", "input");
  private sendBtn = el("button", "send", SEND_ICON);
  private stopBtn = el("button", "stop", STOP_ICON);
  private configErr = el("div", "config-error");

  private messages: Msg[] = [];
  private streaming = false;
  private stopped = false;
  private controller: AbortController | null = null;
  private flushId = 0;
  private flushTarget: Msg | null = null;
  private loggedConfig = false;
  private configOk = false;
  private restoredFor: string | null = null;
  private composing = false;

  constructor() {
    super();
    const sr = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = chatCSS;
    sr.append(style, this.dyn, this.root);

    this.root.title = ""; // stop the host `title` attribute tooltip covering the widget
    this.titleEl.id = "t";
    this.header.append(this.titleEl, this.resetBtn, this.closeBtn);
    this.resetBtn.type = this.closeBtn.type = this.sendBtn.type = "button";
    this.stopBtn.type = "button";
    this.closeBtn.hidden = true;
    this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-live", "polite");
    this.log.setAttribute("aria-relevant", "additions text");
    this.log.tabIndex = 0;
    this.welcomeEl.append(el("div", "bubble"));
    this.input.rows = 1;
    this.input.maxLength = 2000;
    this.input.autocomplete = "off";
    this.stopBtn.hidden = true;
    this.form.append(this.input, this.sendBtn, this.stopBtn);
    this.root.append(this.header, this.log, this.suggestionsEl, this.form, this.configErr);
    this.configErr.hidden = true;
    this.configErr.setAttribute("role", "alert");

    this.resetBtn.addEventListener("click", () => this.reset());
    this.closeBtn.addEventListener("click", () =>
      this.dispatchEvent(new CustomEvent("onw-close-request", { bubbles: true })));
    this.stopBtn.addEventListener("click", () => this.stop());
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitInput();
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !this.composing && e.keyCode !== 229) {
        e.preventDefault();
        this.submitInput();
      }
    });
    this.input.addEventListener("compositionstart", () => (this.composing = true));
    this.input.addEventListener("compositionend", () => (this.composing = false));
    this.input.addEventListener("input", () => {
      this.autoGrow();
      this.syncControls();
    });
    this.suggestionsEl.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button.chip");
      if (b) void this.ask(b.textContent ?? "");
    });
    this.applyAll();
  }

  // ---------- attribute helpers ----------
  private get uiLang(): Lang {
    return resolveLang(this.getAttribute("lang"));
  }
  private tr(key: StringKey, vars?: Record<string, string | number>): string {
    return t(this.uiLang, key, vars);
  }
  private get maxHistory(): number {
    const n = parseInt(this.getAttribute("max-history") ?? "", 10);
    return Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 10;
  }
  private get searchMode(): SearchMode {
    const v = this.getAttribute("search-mode");
    return v === "insights" || v === "full" || v === "insights-first" ? v : "insights-first";
  }
  private get debugOn(): boolean {
    const v = this.getAttribute("debug");
    return v !== null && v !== "false";
  }
  private get persistOn(): boolean {
    return (this.getAttribute("persist") ?? "session") !== "none";
  }
  private get storageKey(): string {
    return `odda-notebook-widget:${this.getAttribute("notebook-id") ?? ""}`;
  }

  connectedCallback(): void {
    this.applyAll();
  }
  disconnectedCallback(): void {
    this.abortStream();
  }
  attributeChangedCallback(name: string, oldV: string | null, newV: string | null): void {
    if (oldV === newV) return;
    if (name === "notebook-id") this.restoredFor = null;
    this.applyAll();
  }

  // ---------- rendering of static parts ----------
  private applyAll(): void {
    const lang = this.uiLang;
    this.root.lang = lang;
    this.titleEl.textContent = this.getAttribute("title") || t(lang, "defaultTitle");
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-labelledby", "t");
    this.input.placeholder = this.getAttribute("placeholder") || t(lang, "placeholder");
    this.input.setAttribute("aria-label", t(lang, "messageLabel"));
    this.log.setAttribute("aria-label", t(lang, "conversation"));
    this.sendBtn.setAttribute("aria-label", t(lang, "send"));
    this.sendBtn.title = t(lang, "send");
    this.stopBtn.setAttribute("aria-label", t(lang, "stop"));
    this.stopBtn.title = t(lang, "stop");
    this.resetBtn.setAttribute("aria-label", t(lang, "reset"));
    this.resetBtn.title = t(lang, "reset");
    this.closeBtn.setAttribute("aria-label", t(lang, "closeChat"));
    this.closeBtn.title = t(lang, "closeChat");
    this.resetBtn.hidden = (this.getAttribute("show-reset") ?? "true") === "false";
    this.closeBtn.hidden = !this.hasAttribute("embedded");
    this.suggestionsEl.setAttribute("aria-label", t(lang, "suggestionsLabel"));

    const theme = this.getAttribute("theme");
    this.root.dataset.theme = theme === "light" || theme === "dark" ? theme : "auto";
    const color = safeCssValue(this.getAttribute("primary-color"));
    if (color) this.root.style.setProperty("--onw-primary", color);
    else this.root.style.removeProperty("--onw-primary");
    const h = safeCssValue(this.getAttribute("height"));
    this.dyn.textContent = h ? `:host{height:${h}}` : "";

    // welcome message (static, not part of history)
    const welcome = this.getAttribute("welcome-message");
    const wb = this.welcomeEl.firstElementChild as HTMLElement;
    wb.innerHTML = welcome ? renderMarkdown(welcome) : "";
    this.welcomeEl.hidden = !welcome;
    if (this.welcomeEl.parentNode !== this.log) this.log.prepend(this.welcomeEl);

    this.checkConfig();
    if (this.configOk && this.restoredFor !== this.getAttribute("notebook-id")) this.restore();
    this.renderSuggestions();
    this.syncControls();
  }

  private checkConfig(): void {
    const missing = ["api-url", "notebook-id", "widget-key"].filter((a) => !(this.getAttribute(a) || "").trim());
    this.configOk = missing.length === 0;
    this.configErr.hidden = this.configOk;
    this.log.hidden = this.form.hidden = !this.configOk;
    if (!this.configOk) {
      this.suggestionsEl.hidden = true;
      this.configErr.textContent = this.tr("errConfig", { missing: missing.join(", ") });
      if (!this.loggedConfig && this.isConnected) {
        this.loggedConfig = true;
        console.error(`[odda-notebook-widget] Missing required attribute(s): ${missing.join(", ")}`);
      }
    }
  }

  private renderSuggestions(): void {
    this.suggestionsEl.textContent = "";
    const list = this.messages.length || !this.configOk ? [] : parseSuggestions(this.getAttribute("suggestions"));
    for (const s of list) {
      const b = el("button", "chip");
      b.type = "button";
      b.textContent = s;
      b.disabled = this.streaming;
      this.suggestionsEl.append(b);
    }
    this.suggestionsEl.hidden = !list.length;
  }

  private syncControls(): void {
    this.input.disabled = this.streaming;
    this.sendBtn.hidden = this.streaming;
    this.stopBtn.hidden = !this.streaming;
    this.sendBtn.disabled = !this.input.value.trim();
    this.log.setAttribute("aria-busy", String(this.streaming));
  }

  private autoGrow(): void {
    const i = this.input;
    i.style.height = "auto";
    const max = parseFloat(getComputedStyle(i).lineHeight) * 5 + 20;
    const h = Math.min(i.scrollHeight, Number.isFinite(max) && max > 40 ? max : 120);
    if (h > 0) i.style.height = `${h}px`;
  }

  // ---------- messages ----------
  private addMsgEl(m: Msg): void {
    const wrap = el("div", `msg ${m.role}`);
    const bubble = el("div", "bubble");
    if (m.role === "user") {
      const who = el("span", "sr");
      who.textContent = `${this.tr("you")}: `;
      bubble.append(who, document.createTextNode(m.content));
    } else if (m.role === "assistant") {
      this.paintAssistant(m, bubble);
    }
    wrap.append(bubble);
    m.el = wrap;
    m.bubble = bubble;
    this.log.append(wrap);
    this.scrollToEnd();
  }

  private paintAssistant(m: Msg, bubble = m.bubble): void {
    if (!bubble) return;
    if (!m.content) {
      bubble.innerHTML = `<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="sr"></span>`;
      (bubble.lastElementChild as HTMLElement).textContent = this.tr("typing");
    } else {
      bubble.innerHTML = renderMarkdown(m.content);
      const who = el("span", "sr");
      who.textContent = `${this.tr("assistant")}: `;
      bubble.prepend(who);
    }
  }

  private scrollToEnd(): void {
    const l = this.log;
    l.scrollTop = l.scrollHeight;
  }

  private removeMsg(m: Msg): void {
    m.el?.remove();
    const i = this.messages.indexOf(m);
    if (i >= 0) this.messages.splice(i, 1);
  }

  private scheduleFlush(m: Msg): void {
    this.flushTarget = m;
    if (this.flushId) return;
    this.flushId = raf(() => {
      this.flushId = 0;
      this.flushNow();
    });
  }
  private flushNow(): void {
    if (this.flushId) {
      caf(this.flushId);
      this.flushId = 0;
    }
    const m = this.flushTarget;
    if (!m) return;
    const l = this.log;
    const nearBottom = l.scrollHeight - l.scrollTop - l.clientHeight < 80;
    this.paintAssistant(m);
    if (nearBottom) this.scrollToEnd();
  }

  private showError(message: string, retryable = true): void {
    const m: Msg = { role: "error", content: message };
    const wrap = el("div", "msg error");
    wrap.setAttribute("role", "alert");
    const bubble = el("div", "bubble");
    const span = el("span");
    span.textContent = message;
    bubble.append(span);
    if (retryable) {
      const b = el("button", "retry");
      b.type = "button";
      b.textContent = this.tr("retry");
      b.addEventListener("click", () => void this.retry());
      bubble.append(b);
    }
    wrap.append(bubble);
    m.el = wrap;
    this.messages.push(m);
    this.log.append(wrap);
    this.scrollToEnd();
  }

  // ---------- persistence ----------
  private save(): void {
    if (!this.persistOn) return;
    try {
      const data = this.messages
        .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
        .map((m) => ({ role: m.role, content: m.content }));
      sessionStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      /* storage unavailable */
    }
  }

  private restore(): void {
    this.restoredFor = this.getAttribute("notebook-id");
    this.clearMessages();
    if (!this.persistOn) return;
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      const data: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(data)) {
        for (const d of data.slice(-100)) {
          if (d && (d.role === "user" || d.role === "assistant") && typeof d.content === "string") {
            const m: Msg = { role: d.role, content: d.content };
            this.messages.push(m);
            this.addMsgEl(m);
          }
        }
      }
    } catch {
      /* ignore corrupted storage */
    }
  }

  private clearMessages(): void {
    for (const m of this.messages) m.el?.remove();
    this.messages = [];
  }

  // ---------- public API ----------
  /** Send a message programmatically. Resolves when the answer completes (or fails/stops). */
  async ask(text: string): Promise<void> {
    if (!this.configOk || this.streaming) return;
    const message = (text ?? "").trim().slice(0, 2000);
    if (!message) return;
    const history = this.buildHistory();
    const u: Msg = { role: "user", content: message };
    this.messages.push(u);
    this.addMsgEl(u);
    this.renderSuggestions();
    this.dispatchEvent(new CustomEvent("onw-message", { detail: { text: message }, bubbles: true, composed: true }));
    await this.answer(message, history);
  }

  reset(): void {
    this.abortStream();
    this.clearMessages();
    if (this.persistOn) {
      try {
        sessionStorage.removeItem(this.storageKey);
      } catch {
        /* ignore */
      }
    }
    this.streaming = false;
    this.renderSuggestions();
    this.syncControls();
  }

  stop(): void {
    if (!this.streaming) return;
    this.stopped = true;
    this.controller?.abort();
  }

  override focus(): void {
    if (this.configOk) this.input.focus();
    else super.focus();
  }

  // ---------- internals ----------
  private submitInput(): void {
    const v = this.input.value;
    if (!v.trim() || this.streaming) return;
    this.input.value = "";
    this.autoGrow();
    void this.ask(v);
  }

  private buildHistory(): HistoryItem[] {
    const out: HistoryItem[] = [];
    this.messages.forEach((m, i) => {
      if ((m.role !== "user" && m.role !== "assistant") || !m.content) return;
      // a user message whose answer failed is not a completed turn
      if (m.role === "user" && this.messages[i + 1]?.role === "error") return;
      out.push({ role: m.role, content: m.content.slice(0, 4000) });
    });
    const n = this.maxHistory;
    return n ? out.slice(-n) : [];
  }

  private async retry(): Promise<void> {
    if (this.streaming) return;
    let i = this.messages.length - 1;
    while (i >= 0 && this.messages[i]?.role !== "user") i--;
    if (i < 0) return;
    const text = this.messages[i]!.content;
    for (const m of this.messages.splice(i)) m.el?.remove();
    await this.ask(text);
  }

  private abortStream(): void {
    this.stopped = true;
    this.controller?.abort();
    this.controller = null;
  }

  private errorText(err: WidgetApiError): string {
    switch (err.kind) {
      case "auth":
        return this.tr("errUnavailable");
      case "rate":
        return err.retryAfter ? this.tr("errRate", { s: err.retryAfter }) : this.tr("errRateNoTime");
      case "stream":
        return err.message || this.tr("errGeneric");
      default:
        return this.tr("errGeneric");
    }
  }

  private async answer(message: string, history: HistoryItem[]): Promise<void> {
    const a: Msg = { role: "assistant", content: "" };
    this.messages.push(a);
    this.addMsgEl(a);
    const controller = new AbortController();
    this.controller = controller;
    this.stopped = false;
    this.streaming = true;
    this.renderSuggestions();
    this.syncControls();
    const hadFocus = !!this.shadowRoot?.activeElement;
    let failure: WidgetApiError | null = null;
    const debug = this.debugOn;
    const t0 = performance.now();
    let tokens = 0;
    const body = {
      notebook_id: this.getAttribute("notebook-id") ?? "",
      message,
      history,
      search_mode: this.searchMode,
      language: this.uiLang,
    };
    if (debug) console.log("[odda-notebook-widget] request", body);
    try {
      await streamChat({
        apiUrl: this.getAttribute("api-url") ?? "",
        widgetKey: this.getAttribute("widget-key") ?? "",
        signal: controller.signal,
        fetchImpl: (...args) => fetch(...args),
        body,
        onToken: (text) => {
          if (debug) {
            tokens++;
            console.log(`[odda-notebook-widget] token #${tokens} +${Math.round(performance.now() - t0)}ms`, JSON.stringify(text));
          }
          a.content += text;
          this.scheduleFlush(a);
        },
      });
    } catch (e) {
      if (!(controller.signal.aborted && this.stopped)) {
        failure = e instanceof WidgetApiError ? e : new WidgetApiError("network", e instanceof Error ? e.message : String(e));
      }
    }
    if (debug) {
      const status = failure ? `error (${failure.kind}: ${failure.message})` : this.stopped ? "stopped" : "done";
      console.log(
        `[odda-notebook-widget] stream ${status}: ${tokens} tokens, ${a.content.length} chars, ${Math.round(performance.now() - t0)}ms`,
      );
      console.log("[odda-notebook-widget] answer\n" + a.content);
    }
    this.flushTarget = a;
    this.flushNow();
    this.flushTarget = null;
    if (this.controller === controller) this.controller = null;
    this.streaming = false;
    if (!a.content) this.removeMsg(a);
    else this.paintAssistant(a);

    if (failure) {
      const text = this.errorText(failure);
      this.showError(text);
      this.dispatchEvent(
        new CustomEvent("onw-error", {
          detail: { status: failure.status, code: failure.code, message: failure.message || text },
          bubbles: true,
          composed: true,
        }),
      );
    } else if (a.content && !this.stopped) {
      this.dispatchEvent(new CustomEvent("onw-answer", { detail: { text: a.content }, bubbles: true, composed: true }));
    }
    this.save();
    this.renderSuggestions();
    this.syncControls();
    if (hadFocus) this.input.focus();
    this.scrollToEnd();
  }
}
