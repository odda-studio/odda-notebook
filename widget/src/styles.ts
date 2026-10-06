/** Accept only conservative CSS values (no declaration/rule injection). */
export function safeCssValue(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  return s && s.length < 120 && /^[#\w%(),.\s/+*-]+$/.test(s) ? s : null;
}

/*
 * Theming: every colour/size is a CSS custom property that the host page can
 * override on the element (custom properties inherit into the shadow root).
 * Brand: Odda blue #2000FF, lime accent #CBFD00 (used sparingly).
 */
export const chatCSS = `
:host{display:block;height:520px;min-height:360px;box-sizing:border-box;font-family:var(--onw-font,inherit)}
:host([hidden]){display:none}
*,*::before,*::after{box-sizing:border-box}
.root{
  --p:var(--onw-primary,#2000FF);
  --on-p:var(--onw-on-primary,#fff);
  --bg:var(--onw-bg,#fff);
  --text:var(--onw-text,#14141f);
  --muted:var(--onw-muted,#5b5b6e);
  --border:var(--onw-border,#dcdce6);
  --ubub:var(--onw-user-bubble,var(--p));
  --utext:var(--onw-user-text,var(--on-p));
  --abub:var(--onw-assistant-bubble,#f0f0f6);
  --atext:var(--onw-assistant-text,var(--text));
  --link:var(--onw-link,var(--p));
  --focus:var(--onw-focus,var(--p));
  --err:var(--onw-error,#b00020);
  --errbg:var(--onw-error-bg,#fdecef);
  --accent:var(--onw-accent,#CBFD00);
  --r:var(--onw-radius,14px);
  display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;
  background:var(--bg);color:var(--text);font-family:var(--onw-font,inherit);font-size:var(--onw-font-size,15px);line-height:1.45;
  border:1px solid var(--border);border-radius:var(--r);
}
.root[data-theme=dark]{
  --p:var(--onw-primary,#2000FF);
  --bg:var(--onw-bg,#14141c);--text:var(--onw-text,#ececf3);--muted:var(--onw-muted,#a3a3b8);--border:var(--onw-border,#34344a);
  --abub:var(--onw-assistant-bubble,#242433);
  --link:var(--onw-link,#b3adff);--focus:var(--onw-focus,#b3adff);
  --err:var(--onw-error,#ff9aa8);--errbg:var(--onw-error-bg,#3a1a22);
}
@media (prefers-color-scheme:dark){
  .root[data-theme=auto]{
    --bg:var(--onw-bg,#14141c);--text:var(--onw-text,#ececf3);--muted:var(--onw-muted,#a3a3b8);--border:var(--onw-border,#34344a);
    --abub:var(--onw-assistant-bubble,#242433);
    --link:var(--onw-link,#b3adff);--focus:var(--onw-focus,#b3adff);
    --err:var(--onw-error,#ff9aa8);--errbg:var(--onw-error-bg,#3a1a22);
  }
}
button,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
[hidden]{display:none!important}

.header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border);border-top:3px solid var(--p);flex:none}
.title{flex:1;min-width:0;margin:0;font-size:1em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.title::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 1px var(--p);margin-right:8px;vertical-align:middle}
.icon-btn{appearance:none;border:0;background:transparent;cursor:pointer;width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:var(--muted)}
.icon-btn:hover{background:var(--abub);color:var(--text)}
.icon-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

.log{flex:1;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
.msg{display:flex;max-width:100%}
.msg.user{justify-content:flex-end}
.bubble{max-width:85%;padding:9px 13px;border-radius:var(--r);overflow-wrap:anywhere;word-break:break-word}
.user .bubble{background:var(--ubub);color:var(--utext);border-bottom-right-radius:4px;white-space:pre-wrap}
.welcome{display:flex}
.welcome .bubble,.assistant .bubble{background:var(--abub);color:var(--atext);border-bottom-left-radius:4px}
.welcome .bubble:empty{display:none}
.bubble p{margin:0 0 .6em}.bubble p:last-child,.bubble ul:last-child,.bubble ol:last-child,.bubble pre:last-child{margin-bottom:0}
.bubble ul,.bubble ol{margin:0 0 .6em;padding-left:1.4em}
.bubble li{margin:.15em 0}
.bubble a{color:var(--link);text-decoration:underline}
.bubble code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:rgba(127,127,150,.2);padding:.1em .35em;border-radius:4px}
.bubble pre{margin:0 0 .6em;padding:10px 12px;background:rgba(127,127,150,.18);border-radius:8px;overflow-x:auto}
.bubble pre code{background:none;padding:0}
.msg.error .bubble{background:var(--errbg);color:var(--err);border:1px solid var(--err);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.retry{appearance:none;cursor:pointer;border:1px solid currentColor;background:transparent;color:inherit;border-radius:999px;padding:3px 12px;font-weight:600}
.retry:hover{background:rgba(127,127,150,.2)}
.dots{display:inline-flex;gap:4px;align-items:center;height:1.2em}
.dots i{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:onw-bounce 1.2s infinite ease-in-out}
.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
@keyframes onw-bounce{0%,60%,100%{opacity:.35;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}

.suggestions{display:flex;flex-wrap:wrap;gap:8px;padding:0 14px 10px;flex:none}
.chip{appearance:none;cursor:pointer;background:transparent;color:var(--link);border:1px solid var(--p);border-radius:999px;padding:6px 12px;text-align:left}
.root[data-theme=dark] .chip{border-color:var(--focus)}
.chip:hover{background:var(--abub)}

.form{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--border);flex:none}
.input{flex:1;min-width:0;resize:none;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:calc(var(--r) - 2px);padding:9px 12px;line-height:1.4;max-height:7.5em;overflow-y:auto;font-size:inherit}
.input::placeholder{color:var(--muted);opacity:1}
.input:disabled{opacity:.6}
.send,.stop{appearance:none;border:0;cursor:pointer;width:40px;height:40px;border-radius:50%;background:var(--p);color:var(--on-p);display:inline-flex;align-items:center;justify-content:center;flex:none}
.send:disabled{opacity:.45;cursor:not-allowed}
.send svg,.stop svg{width:18px;height:18px;fill:currentColor}
.stop{background:var(--text);color:var(--bg)}

.config-error{padding:16px;margin:auto;text-align:center;color:var(--err);background:var(--errbg);border-radius:var(--r)}
@media (prefers-reduced-motion:reduce){.log{scroll-behavior:auto}.dots i{animation:none;opacity:.7}}
`;

export const chatbotCSS = `
:host{display:contents;font-family:var(--onw-font,inherit)}
*,*::before,*::after{box-sizing:border-box}
.wrap{
  --p:var(--onw-primary,#2000FF);--on-p:var(--onw-on-primary,#fff);--accent:var(--onw-accent,#CBFD00);
  --r:var(--onw-radius,14px);
  position:fixed;bottom:20px;right:20px;z-index:2147483000;font-family:var(--onw-font,inherit);
}
.wrap.left{right:auto;left:20px}
.launcher{appearance:none;border:0;cursor:pointer;width:58px;height:58px;border-radius:50%;background:var(--p);color:var(--on-p);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.28);position:relative;transition:transform .15s}
.launcher:hover{transform:scale(1.06)}
.launcher::after{content:"";position:absolute;top:2px;right:2px;width:12px;height:12px;border-radius:50%;background:var(--accent);border:2px solid var(--p)}
.launcher svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.launcher .i-close{display:none}
.wrap.is-open .launcher .i-chat{display:none}
.wrap.is-open .launcher .i-close{display:block}
.wrap.is-open .launcher::after{display:none}
:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 5px var(--p)}
.window{
  position:absolute;bottom:calc(58px + 12px);right:0;width:380px;max-width:calc(100vw - 24px);
  height:600px;max-height:calc(100vh - 110px);display:flex;flex-direction:column;
  border-radius:var(--r);box-shadow:0 12px 40px rgba(0,0,0,.28);background:var(--onw-bg,transparent);
}
.wrap.left .window{right:auto;left:0}
.window[hidden]{display:none}
odda-notebook-chat{display:block;flex:1;min-height:0;height:100%}
@media (max-width:479px){
  .window{position:fixed;inset:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0}
  .window odda-notebook-chat{border-radius:0}
  .wrap.is-open .launcher{display:none}
}
@media (prefers-reduced-motion:reduce){.launcher{transition:none}.launcher:hover{transform:none}}
`;
