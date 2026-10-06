import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown";

describe("markdown", () => {
  it("renders basics", () => {
    expect(renderMarkdown("Hello **bold** and *it* and `c<d>`")).toBe(
      "<p>Hello <strong>bold</strong> and <em>it</em> and <code>c&lt;d&gt;</code></p>",
    );
  });
  it("renders lists and paragraphs", () => {
    expect(renderMarkdown("- a\n- b\n\npara\n\n1. x\n2. y")).toBe(
      "<ul><li>a</li><li>b</li></ul><p>para</p><ol><li>x</li><li>y</li></ol>",
    );
  });
  it("renders code blocks without formatting inside", () => {
    expect(renderMarkdown("```js\nconst a = **x** <b>;\n```")).toBe("<pre><code>const a = **x** &lt;b&gt;;</code></pre>");
  });
  it("renders unclosed code fence (streaming)", () => {
    expect(renderMarkdown("```\nabc")).toBe("<pre><code>abc</code></pre>");
  });
  it("renders safe links with hardened attributes", () => {
    const h = renderMarkdown("[x](https://a.com/p?q=1&r=2) [m](mailto:a@b.it)");
    expect(h).toContain('href="https://a.com/p?q=1&amp;r=2" target="_blank" rel="noopener noreferrer nofollow"');
    expect(h).toContain('href="mailto:a@b.it"');
  });
  it("blocks javascript:, data: and vbscript: links", () => {
    for (const u of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html;base64,AAA", "vbscript:x", " javascript:alert(1)"]) {
      const h = renderMarkdown(`[click](${u})`);
      expect(h).not.toContain("<a");
      expect(h).not.toContain("href");
    }
  });
  it("escapes raw HTML", () => {
    const h = renderMarkdown('<img src=x onerror="alert(1)"><script>alert(1)</script>');
    expect(h).not.toContain("<img");
    expect(h).not.toContain("<script");
    expect(h).toContain("&lt;img");
  });
  it("cannot break out of href attribute", () => {
    const h = renderMarkdown('[a](https://x.com/"onmouseover="alert(1))');
    expect(h).not.toMatch(/<a[^>]*\sonmouseover/);
    const h2 = renderMarkdown('[a](https://x.com/%22onmouseover=alert(1))');
    expect(h2).not.toMatch(/<a[^>]*\sonmouseover/);
  });
  it("handles nested and unclosed markup safely", () => {
    for (const s of ["**bold *it", "*a **b* c**", "[a](https://x.com", "`open", "[[x](javascript:1)](http://a.b)", "<b><i>**x**</b>", "__a_", "\u0000 0 \u0000"]) {
      const h = renderMarkdown(s);
      expect(h).not.toMatch(/<(?!\/?(p|strong|em|code|pre|ul|ol|li|a|br)[\s>])/);
      expect(h).not.toContain("\u0000");
      expect(h).not.toMatch(/\son\w+=/i);
    }
  });
  it("link text with HTML is escaped", () => {
    const h = renderMarkdown("[<img src=x onerror=alert(1)>](https://a.com)");
    expect(h).not.toContain("<img");
  });
  it("autolinks bare urls only for http(s)", () => {
    expect(renderMarkdown("see https://a.com/x.")).toContain('<a href="https://a.com/x"');
    expect(renderMarkdown("javascript:alert(1)")).not.toContain("<a");
  });
});
