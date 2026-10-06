/**
 * Tiny, safe Markdown renderer. All input is HTML-escaped FIRST; only a fixed
 * set of tags is ever emitted (p, strong, em, code, pre, ul, ol, li, a, br).
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function emphasis(s: string): string {
  s = s.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w])__(?=\S)([^\n]*?\S)__(?!\w)/g, "$1<strong>$2</strong>");
  s = s.replace(/\*(?=[^\s*])([^\n*]*?[^\s*])\*/g, "<em>$1</em>");
  s = s.replace(/(^|[^\w])_(?=[^\s_])([^\n_]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>");
  return s;
}

/** Inline formatting on RAW text; returns safe HTML. */
export function renderInline(raw: string): string {
  const stash: string[] = [];
  const put = (html: string) => `\u0000${stash.push(html) - 1}\u0000`;
  let s = escapeHtml(raw.replace(/\u0000/g, ""));
  // code spans
  s = s.replace(/`([^`\n]+)`/g, (_m, c: string) => put(`<code>${c}</code>`));
  // links [text](url)
  s = s.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (m, text: string, url: string) => {
    // url is already escaped (no raw quotes/angle brackets possible)
    if (!SAFE_URL.test(url)) return m;
    return put(`<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${emphasis(text)}</a>`);
  });
  // bare URLs
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, (_m, pre: string, url: string) =>
    `${pre}${put(`<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`)}`);
  s = emphasis(s);
  // restore placeholders (links may contain code placeholders; loop until stable)
  for (let i = 0; i < 3 && s.includes("\u0000"); i++) {
    s = s.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => stash[Number(n)] ?? "");
  }
  return s.replace(/\u0000/g, "");
}

const UL = /^\s{0,3}[-*+]\s+(.*)$/;
const OL = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(renderInline).join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${renderInline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };

  for (const line of lines) {
    if (code) {
      if (/^\s{0,3}```/.test(line)) {
        out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      } else code.push(line);
      continue;
    }
    if (/^\s{0,3}```/.test(line)) {
      flushPara();
      flushList();
      code = [];
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      flushPara();
      const tag = ul ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((ul ?? ol)![1] ?? "");
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  // unclosed code fence: still render as code (streaming)
  if (code) out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flushPara();
  flushList();
  return out.join("");
}
