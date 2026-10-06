export type Lang = "it" | "en";

const en = {
  defaultTitle: "Assistant",
  placeholder: "Ask a question…",
  send: "Send message",
  stop: "Stop generating",
  reset: "Start a new conversation",
  retry: "Retry",
  typing: "The assistant is typing",
  conversation: "Conversation",
  messageLabel: "Your message",
  suggestionsLabel: "Suggested questions",
  you: "You",
  assistant: "Assistant",
  openChat: "Open chat",
  closeChat: "Close chat",
  errUnavailable: "This assistant is not available right now.",
  errRate: "Too many requests. Please try again in {s} seconds.",
  errRateNoTime: "Too many requests. Please try again in a moment.",
  errGeneric: "Something went wrong. Please try again.",
  errConfig: "Chat widget is not configured. Missing: {missing}.",
};

const it: typeof en = {
  defaultTitle: "Assistente",
  placeholder: "Fai una domanda…",
  send: "Invia messaggio",
  stop: "Interrompi la risposta",
  reset: "Inizia una nuova conversazione",
  retry: "Riprova",
  typing: "L'assistente sta scrivendo",
  conversation: "Conversazione",
  messageLabel: "Il tuo messaggio",
  suggestionsLabel: "Domande suggerite",
  you: "Tu",
  assistant: "Assistente",
  openChat: "Apri la chat",
  closeChat: "Chiudi la chat",
  errUnavailable: "Questo assistente non è al momento disponibile.",
  errRate: "Troppe richieste. Riprova tra {s} secondi.",
  errRateNoTime: "Troppe richieste. Riprova tra poco.",
  errGeneric: "Qualcosa è andato storto. Riprova.",
  errConfig: "Widget di chat non configurato. Mancano: {missing}.",
};

export type StringKey = keyof typeof en;
const dict: Record<Lang, typeof en> = { en, it };

export function resolveLang(attr: string | null | undefined): Lang {
  const raw = (attr || (typeof document !== "undefined" ? document.documentElement.lang : "") || "en").toLowerCase();
  return raw.startsWith("it") ? "it" : "en";
}

export function t(lang: Lang, key: StringKey, vars: Record<string, string | number> = {}): string {
  return dict[lang][key].replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
}
