import { CHAT_ATTRS, OddaNotebookChat } from "./chat-element";
import { resolveLang, t } from "./i18n";
import { chatbotCSS, safeCssValue } from "./styles";

const CHAT_ICON = '<svg class="i-chat" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.6A8 8 0 1 1 21 12z"/></svg>';
const CLOSE_ICON = '<svg class="i-close" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

let uid = 0;

export class OddaNotebookChatbot extends HTMLElement {
  static get observedAttributes(): string[] {
    return [...CHAT_ATTRS, "open", "position", "button-label", "offset", "z-index"];
  }

  private wrap = document.createElement("div");
  private launcher = document.createElement("button");
  private win = document.createElement("div");
  private chat: OddaNotebookChat;
  private opened = false;
  private initialised = false;

  constructor() {
    super();
    const sr = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = chatbotCSS;
    const id = `onw-win-${++uid}`;
    this.wrap.className = "wrap";
    this.launcher.type = "button";
    this.launcher.className = "launcher";
    this.launcher.innerHTML = CHAT_ICON + CLOSE_ICON;
    this.launcher.setAttribute("aria-haspopup", "dialog");
    this.launcher.setAttribute("aria-expanded", "false");
    this.launcher.setAttribute("aria-controls", id);
    this.win.id = id;
    this.win.className = "window";
    this.win.setAttribute("role", "dialog");
    this.win.hidden = true;
    this.chat = document.createElement("odda-notebook-chat") as OddaNotebookChat;
    this.chat.setAttribute("embedded", "");
    this.win.append(this.chat);
    this.wrap.append(this.win, this.launcher);
    sr.append(style, this.wrap);

    this.launcher.addEventListener("click", () => this.toggle());
    this.wrap.addEventListener("onw-close-request", () => this.close());
    this.wrap.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape" && this.opened) {
        e.stopPropagation();
        this.close();
      }
    });
    this.sync();
  }

  /** Whether the chatbot window is open (reflects the `open` attribute). */
  get isOpen(): boolean {
    return this.hasAttribute("open");
  }

  open(): void {
    this.toggleAttribute("open", true);
  }
  close(): void {
    this.toggleAttribute("open", false);
  }
  toggle(): void {
    this.toggleAttribute("open");
  }

  async ask(text: string): Promise<void> {
    this.open();
    await this.chat.ask(text);
  }
  reset(): void {
    this.chat.reset();
  }

  connectedCallback(): void {
    this.sync();
    this.initialised = true;
  }

  attributeChangedCallback(name: string, oldV: string | null, newV: string | null): void {
    if (oldV === newV) return;
    this.sync();
  }

  private sync(): void {
    // forward shared attributes to the inner chat
    for (const a of CHAT_ATTRS) {
      const v = this.getAttribute(a);
      if (v === null) this.chat.removeAttribute(a);
      else if (this.chat.getAttribute(a) !== v) this.chat.setAttribute(a, v);
    }
    const lang = resolveLang(this.getAttribute("lang"));
    const title = this.getAttribute("title") || t(lang, "defaultTitle");
    this.win.setAttribute("aria-label", title);
    this.win.title = "";
    this.launcher.setAttribute("aria-label", this.getAttribute("button-label") || t(lang, "openChat"));
    this.launcher.title = this.getAttribute("button-label") || t(lang, "openChat");

    this.wrap.classList.toggle("left", this.getAttribute("position") === "bottom-left");
    const off = parseInt(this.getAttribute("offset") ?? "", 10);
    const o = Number.isFinite(off) && off >= 0 ? off : 20;
    this.wrap.style.bottom = `${o}px`;
    this.wrap.style.right = this.getAttribute("position") === "bottom-left" ? "auto" : `${o}px`;
    this.wrap.style.left = this.getAttribute("position") === "bottom-left" ? `${o}px` : "auto";
    const z = safeCssValue(this.getAttribute("z-index"));
    this.wrap.style.zIndex = z && /^-?\d+$/.test(z) ? z : "2147483000";
    const color = safeCssValue(this.getAttribute("primary-color"));
    if (color) this.wrap.style.setProperty("--onw-primary", color);
    else this.wrap.style.removeProperty("--onw-primary");

    const want = this.hasAttribute("open");
    if (want !== this.opened) {
      const hadFocusInside = !!this.shadowRoot?.activeElement;
      this.opened = want;
      this.win.hidden = !want;
      this.wrap.classList.toggle("is-open", want);
      this.launcher.setAttribute("aria-expanded", String(want));
      if (this.initialised) {
        this.dispatchEvent(new CustomEvent(want ? "onw-open" : "onw-close", { bubbles: true, composed: true }));
        if (want) this.chat.focus();
        else if (hadFocusInside) this.launcher.focus();
      }
    }
  }
}
