import { OddaNotebookChat } from "./chat-element";
import { OddaNotebookChatbot } from "./chatbot-element";

if (typeof customElements !== "undefined") {
  if (!customElements.get("odda-notebook-chat")) customElements.define("odda-notebook-chat", OddaNotebookChat);
  if (!customElements.get("odda-notebook-chatbot")) customElements.define("odda-notebook-chatbot", OddaNotebookChatbot);
}

export { OddaNotebookChat, OddaNotebookChatbot };
