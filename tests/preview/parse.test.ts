import { describe, expect, it } from "vitest";
import { parsePreview, previewBytes } from "../../web/preview/parse.js";
import { validateModel, type PreviewModel } from "../../web/preview/model.js";
import { PREVIEW_CONTRACT } from "../../web/preview/protocol.js";

const enc = (s: string) => new TextEncoder().encode(s);
const body = (s: string) => parsePreview(s).body;
const p = (...c: unknown[]) => [{ k: "p", c }];
const t = (v: string) => ({ k: "text", v });
const notices = (s: string) => parsePreview(s).notices;

describe("S8-02 standard Markdown", () => {
  it("headings keep literal U+3000 (5 ideographic spaces)", () => {
    const heading = "　　　　　第一夜";
    expect([...heading].filter((c) => c === "\u3000")).toHaveLength(5);
    expect(body(`### ${heading}`)).toEqual([
      { k: "h", level: 3, c: [t(heading)] },
    ]);
    for (let level = 1; level <= 6; level++)
      expect(body(`${"#".repeat(level)} 見出し`)).toEqual([
        { k: "h", level, c: [t("見出し")] },
      ]);
    expect(body("####### 七")).toEqual(p(t("####### 七")));
    expect(body("見出し\n===")).toEqual([
      { k: "h", level: 1, c: [t("見出し")] },
    ]);
  });
  it("paragraph line breaks are kept as text newlines", () => {
    expect(body("一行目\n二行目")).toEqual(p(t("一行目\n二行目")));
    expect(body("行末  \n次")).toEqual(p(t("行末\n次")));
    expect(body("一\n\n二")).toEqual([...p(t("一")), ...p(t("二"))]);
    expect(body("　字下げの段落")).toEqual(p(t("　字下げの段落")));
  });
  it("strong/em, including CJK neighbours; ASCII rules unchanged", () => {
    expect(body("**太字**と*斜体*")).toEqual(
      p({ k: "strong", c: [t("太字")] }, t("と"), { k: "em", c: [t("斜体")] }),
    );
    expect(body("第**｟IIII｠**章")).toEqual(
      p(t("第"), { k: "strong", c: [{ k: "tcy", v: "IIII" }] }, t("章")),
    );
    expect(body("「***強調***」")).toEqual(
      p(t("「"), { k: "em", c: [{ k: "strong", c: [t("強調")] }] }, t("」")),
    );
    expect(body("2 * 3 * 4")).toEqual(p(t("2 * 3 * 4")));
    expect(body("a**b**c")).toEqual(
      p(t("a"), { k: "strong", c: [t("b")] }, t("c")),
    );
    expect(body("__x__")).toEqual(p({ k: "strong", c: [t("x")] }));
  });
  it("blockquote, lists, rule, code", () => {
    expect(body("> 引用\n> 二行")).toEqual([
      { k: "quote", c: p(t("引用\n二行")) },
    ]);
    expect(body("- a\n- b")).toEqual([
      {
        k: "ul",
        c: [
          { k: "li", c: p(t("a")) },
          { k: "li", c: p(t("b")) },
        ],
      },
    ]);
    expect(body("3. a\n4. b")).toMatchObject([{ k: "ol", start: 3 }]);
    expect(body("本文\n\n***")).toEqual([...p(t("本文")), { k: "hr" }]);
    expect(body("`||x|| ｜a《b》 <u>c</u> ｟AB｠`")).toEqual(
      p({ k: "code", v: "||x|| ｜a《b》 <u>c</u> ｟AB｠" }),
    );
    expect(body("```js\n<u>x</u> ｟AB｠ **b**\n```")).toEqual([
      { k: "pre", info: "js", v: "<u>x</u> ｟AB｠ **b**\n" },
    ]);
    expect(body("    インデントコード")).toEqual([
      { k: "pre", info: "", v: "インデントコード\n" },
    ]);
  });
});

describe("S8-02 Aozora / Nyoze syntax", () => {
  it("explicit and kanji ruby; bouten marks are ruby text", () => {
    expect(body("｜青空《あおぞら》文庫")).toEqual(
      p({ k: "ruby", base: "青空", rt: "あおぞら" }, t("文庫")),
    );
    expect(body("漢字《かんじ》ひらがな《よみ》")).toEqual(
      p({ k: "ruby", base: "漢字", rt: "かんじ" }, t("ひらがな《よみ》")),
    );
    expect(body("｜字《﹅》｜点《﹅》")).toEqual(
      p(
        { k: "ruby", base: "字", rt: "﹅" },
        { k: "ruby", base: "点", rt: "﹅" },
      ),
    );
    expect(body("｜a《》")).toEqual(p(t("｜a《》")));
    expect(body("《よみ》だけ")).toEqual(p(t("《よみ》だけ")));
  });
  it("`||` underline, lenient flanking, odd pipes stay literal", () => {
    expect(body("||下線||")).toEqual(p({ k: "u", c: [t("下線")] }));
    expect(body("a||b||c")).toEqual(p(t("a"), { k: "u", c: [t("b")] }, t("c")));
    expect(body("|| a ||")).toEqual(p(t("|| a ||")));
    expect(body("||x|||")).toEqual(p({ k: "u", c: [t("x")] }, t("|")));
    expect(body("||**x**||")).toEqual(
      p({ k: "u", c: [{ k: "strong", c: [t("x")] }] }),
    );
    expect(body("|a|b|")).toEqual(p(t("|a|b|")));
  });
  it("only exact attribute-free <u>…</u>", () => {
    expect(body("<u>下線</u>")).toEqual(p({ k: "u", c: [t("下線")] }));
    expect(body("<U>a</U><u class=x>b</u>")).toEqual(
      p(t("<U>a</U><u class=x>b</u>")),
    );
    expect(body("<u>開きだけ")).toEqual(p(t("<u>開きだけ")));
    expect(body("*a<u>b*</u>")).toEqual(
      p({ k: "em", c: [t("a<u>b")] }, t("</u>")),
    );
  });
  it("TCY is the S7 body contract, with a horizontal-display notice", () => {
    expect(body("｟12｠月")).toEqual(p({ k: "tcy", v: "12" }, t("月")));
    expect(body("｟A1!?｠")).toEqual(p({ k: "tcy", v: "A1!?" }));
    expect(body("｟ABCDE｠｟あ｠｟｠")).toEqual(p(t("｟ABCDE｠｟あ｠｟｠")));
    expect(notices("｟AB｠")).toEqual(["tcy-horizontal"]);
    expect(notices("｟ABCDE｠")).toEqual([]);
  });
  it("closed flat directives; everything else literal", () => {
    for (let level = 1; level <= 6; level++)
      expect(body(`:::indent-${level}\n本文\n:::`)).toEqual([
        { k: "indent", level, c: p(t("本文")) },
      ]);
    expect(body(":::align-end\n署名\n:::")).toEqual([
      { k: "align-end", c: p(t("署名")) },
    ]);
    expect(body(":::page-break\n:::")).toEqual([{ k: "page-break" }]);
    expect(body(":::blank-page\n:::")).toEqual([{ k: "blank-page" }]);
    expect(body(":::indent-7\nx\n:::")).toEqual(p(t(":::indent-7\nx\n:::")));
    expect(body(":::indent-1\n本文")).toEqual(p(t(":::indent-1\n本文")));
    expect(body(":::page-break\n本文\n:::")).toEqual(
      p(t(":::page-break\n本文\n:::")),
    );
    expect(body(":::indent-1\n:::indent-2\nx\n:::\n:::")).toEqual([
      { k: "indent", level: 1, c: p(t(":::indent-2\nx")) },
      ...p(t(":::")),
    ]);
    expect(body(":::note\nx\n:::")).toEqual(p(t(":::note\nx\n:::")));
    expect(body("前の行\n:::indent-2\n本文\n:::\n後の行")).toEqual([
      ...p(t("前の行")),
      { k: "indent", level: 2, c: p(t("本文")) },
      ...p(t("後の行")),
    ]);
    expect(body("> :::indent-1\n> 引用\n> :::")).toEqual([
      { k: "quote", c: p(t(":::indent-1\n引用\n:::")) },
    ]);
    expect(body("- :::page-break\n  :::")).toEqual([
      { k: "ul", c: [{ k: "li", c: p(t(":::page-break\n:::")) }] },
    ]);
    expect(body(":::indent-1\n> :::\n:::")).toEqual([
      { k: "indent", level: 1, c: [{ k: "quote", c: p(t(":::")) }] },
    ]);
  });
  it("S8-F01: a `:::` inside a code fence never closes a directive", () => {
    expect(body(":::indent-1\n```txt\n:::\n```\n本文\n:::")).toEqual([
      {
        k: "indent",
        level: 1,
        c: [{ k: "pre", info: "txt", v: ":::\n" }, ...p(t("本文"))],
      },
    ]);
    expect(body(":::align-end\n~~~~\n:::\n~~~\n~~~~\n署名\n:::")).toEqual([
      {
        k: "align-end",
        c: [{ k: "pre", info: "", v: ":::\n~~~\n" }, ...p(t("署名"))],
      },
    ]);
    expect(body("```\n:::\n```\n:::indent-2\nx\n:::")).toEqual([
      { k: "pre", info: "", v: ":::\n" },
      { k: "indent", level: 2, c: p(t("x")) },
    ]);
    // Not fences: a backtick in a backtick info string, 4+ columns of indent.
    expect(body(":::indent-1\n```a`b\n:::")).toEqual([
      { k: "indent", level: 1, c: p(t("```a`b")) },
    ]);
    expect(body(":::indent-1\n本文\n    ```\n:::")).toEqual([
      { k: "indent", level: 1, c: p(t("本文\n```")) },
    ]);
    // An unclosed fence runs to the end, so the opener stays literal.
    expect(body(":::indent-1\n```\n:::\n本文\n:::")).toEqual([
      ...p(t(":::indent-1")),
      { k: "pre", info: "", v: ":::\n本文\n:::" },
    ]);
    // Fences inside list items and quotes follow the container.
    expect(body("- ```\n  :::\n  ```\n:::indent-1\nx\n:::")).toEqual([
      { k: "ul", c: [{ k: "li", c: [{ k: "pre", info: "", v: ":::\n" }] }] },
      { k: "indent", level: 1, c: p(t("x")) },
    ]);
    expect(body(":::indent-1\n- ```\n  :::\n  ```\n本文\n:::")).toEqual([
      {
        k: "indent",
        level: 1,
        c: [
          {
            k: "ul",
            c: [{ k: "li", c: [{ k: "pre", info: "", v: ":::\n" }] }],
          },
          ...p(t("本文")),
        ],
      },
    ]);
    expect(body(":::align-end\n> ```\n> :::\n> ```\n署名\n:::")).toEqual([
      {
        k: "align-end",
        c: [
          { k: "quote", c: [{ k: "pre", info: "", v: ":::\n" }] },
          ...p(t("署名")),
        ],
      },
    ]);
    // An unprefixed line ends the quote, and with it the quoted fence.
    expect(body(":::indent-1\n> ```\n:::")).toEqual([
      {
        k: "indent",
        level: 1,
        c: [{ k: "quote", c: [{ k: "pre", info: "", v: "" }] }],
      },
    ]);
  });
  it("S8-F03: a `:::` inside a multi-line code span never closes or opens", () => {
    const code = (v: string) => ({ k: "code", v });
    expect(body(":::indent-1\n`code\n:::\nend`\n本文\n:::")).toEqual([
      { k: "indent", level: 1, c: p(code("code ::: end"), t("\n本文")) },
    ]);
    expect(body(":::align-end\n``a\n:::\n`b``\n署名\n:::")).toEqual([
      { k: "align-end", c: p(code("a ::: `b"), t("\n署名")) },
    ]);
    // An opener inside a code span stays literal as well.
    expect(body("`a\n:::indent-1\nb`\n:::")).toEqual(
      p(code("a :::indent-1 b"), t("\n:::")),
    );
    // Code spans inside link labels, image alts and lazy quote lines.
    expect(body(":::indent-1\n[`a\n:::\nb`](u)\n:::")).toEqual([
      {
        k: "indent",
        level: 1,
        c: p({ k: "link", c: [code("a ::: b")], url: "u", title: "" }),
      },
    ]);
    expect(body(":::indent-1\n![`a\n:::\nb`](u)\n:::")).toEqual([
      {
        k: "indent",
        level: 1,
        c: p({ k: "image", alt: "a ::: b", url: "u", title: "" }),
      },
    ]);
    expect(body(":::indent-1\n> `a\n:::\nb`\n:::")).toEqual([
      { k: "indent", level: 1, c: [{ k: "quote", c: p(code("a ::: b")) }] },
    ]);
    // Real closes outside code: closed or unmatched backticks, an escaped
    // backtick, and a backtick inside an autolink.
    expect(body(":::indent-1\n`x` `y\n:::")).toEqual([
      { k: "indent", level: 1, c: p(code("x"), t(" `y")) },
    ]);
    expect(body(":::indent-1\n\\`a\n:::\nb`")).toEqual([
      { k: "indent", level: 1, c: p(t("`a")) },
      ...p(t("b`")),
    ]);
    expect(body(":::indent-1\n<http://a`b>\n:::\n`c")).toEqual([
      {
        k: "indent",
        level: 1,
        c: p({
          k: "link",
          c: [t("http://a`b")],
          url: "http://a`b",
          title: "",
        }),
      },
      ...p(t("`c")),
    ]);
  });
  it("S8-F01: fence-aware close search stays linear", () => {
    const wide = { nodes: 1e7, depth: 64, textUnits: 1e8 };
    const blocks = ":::indent-1\n```\n:::\n```\n本文\n:::\n".repeat(20000);
    const started = performance.now();
    const parsed = parsePreview(blocks, wide).body;
    expect(performance.now() - started).toBeLessThan(5000);
    expect(parsed).toHaveLength(20000);
    expect(parsed[19999]).toEqual({
      k: "indent",
      level: 1,
      c: [{ k: "pre", info: "", v: ":::\n" }, ...p(t("本文"))],
    });
    const unclosed = ":::indent-1\n```\n:::\n".repeat(20000);
    const again = performance.now();
    parsePreview(unclosed, wide);
    expect(performance.now() - again).toBeLessThan(5000);
    const spans = ":::indent-1\n`a\n:::\nb`\n本文\n:::\n\n".repeat(20000);
    const third = performance.now();
    const spanned = parsePreview(spans, wide).body;
    expect(performance.now() - third).toBeLessThan(5000);
    expect(spanned).toHaveLength(20000);
    expect(spanned[19999]).toEqual({
      k: "indent",
      level: 1,
      c: p({ k: "code", v: "a ::: b" }, t("\n本文")),
    });
  });
  it("unsupported syntax stays visible: tables, strike, refs, HTML, notes", () => {
    const table = "|a|b|\n|-|-|\n|1|2|";
    expect(body(table)).toEqual(p(t(table)));
    expect(body("~~x~~")).toEqual(p(t("~~x~~")));
    expect(body("[a]: https://x")).toEqual(p(t("[a]: https://x")));
    expect(body('<div onclick="x">a</div>')).toEqual(
      p(t('<div onclick="x">a</div>')),
    );
    expect(body("［＃ここから２字下げ］")).toEqual(
      p(t("［＃ここから２字下げ］")),
    );
    expect(body("※［＃「口＋世」、第3水準1-15-8］")).toEqual(
      p(t("※［＃「口＋世」、第3水準1-15-8］")),
    );
    expect(body("https://example.com")).toEqual(p(t("https://example.com")));
    expect(body('"quotes" -- ...')).toEqual(p(t('"quotes" -- ...')));
  });
});

describe("S8-02 frontmatter", () => {
  it("valid frontmatter becomes fields; raw stays available", () => {
    const m = parsePreview("---\ntitle: 題\nauthor: 著\n---\n本文");
    expect(m.frontmatter).toEqual({
      status: "valid",
      fields: [
        ["title", "題"],
        ["author", "著"],
      ],
      raw: "---\ntitle: 題\nauthor: 著\n---",
    });
    expect(m.body).toEqual(p(t("本文")));
    expect(m.notices).toEqual([]);
    expect(
      parsePreview("---\nauthors:\n  - 甲\n  - 乙\n---\n").frontmatter,
    ).toMatchObject({
      fields: [
        ["authors", "甲"],
        ["authors", "乙"],
      ],
    });
  });
  it("invalid/unsafe YAML is shown raw with a notice", () => {
    for (const yaml of [
      'title: !!js/function "x"',
      "a: &x 1\nb: *x",
      "title: [",
    ]) {
      const m = parsePreview(`---\n${yaml}\n---\n本文`);
      expect(m.frontmatter).toEqual({
        status: "invalid",
        raw: `---\n${yaml}\n---`,
      });
      expect(m.body).toEqual(p(t("本文")));
      expect(m.notices).toEqual(["frontmatter-invalid"]);
    }
  });
  it("unclosed frontmatter shows the whole text raw", () => {
    const text = "---\ntitle: x\n本文";
    expect(parsePreview(text)).toEqual({
      contract: PREVIEW_CONTRACT,
      frontmatter: { status: "unclosed", raw: text },
      body: [],
      notices: ["frontmatter-unclosed"],
    });
  });
  it("prototype-like keys never reach the model or Object.prototype", () => {
    const m = parsePreview(
      "---\n__proto__: x\nconstructor: y\ntitle: t\n---\n`__proto__` constructor",
    );
    expect(m.frontmatter).toMatchObject({ fields: [["title", "t"]] });
    expect(m.body).toEqual(p({ k: "code", v: "__proto__" }, t(" constructor")));
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("S8-03 links, images, entities", () => {
  it("links become a label plus a displayed URL; unsafe schemes stay literal", () => {
    expect(body('[**太**](https://e.com "t")')).toEqual(
      p({
        k: "link",
        c: [{ k: "strong", c: [t("太")] }],
        url: "https://e.com",
        title: "t",
      }),
    );
    for (const src of [
      "[x](javascript:alert(1))",
      "[x](JAVASCRIPT:alert(1))",
      "[x](vbscript:x)",
      "[x](file:///etc/passwd)",
      "[x](data:text/html,<script>)",
      "<javascript:alert(1)>",
    ])
      expect(body(src)).toEqual(p(t(src)));
    expect(body("[x](jav&#x61;script:alert(1))")).toEqual(
      p(t("[x](javascript:alert(1))")),
    );
    expect(body("[x](//evil.example/a)")).toEqual(
      p({ k: "link", c: [t("x")], url: "//evil.example/a", title: "" }),
    );
    expect(body("[x](%6Aavascript:alert(1))")).toEqual(
      p({ k: "link", c: [t("x")], url: "javascript:alert(1)", title: "" }),
    );
    expect(notices("[x](https://e.com)")).toEqual(["link-not-opened"]);
  });
  it("images are alt text plus a not-loaded URL", () => {
    expect(body("![代替](https://example.com/a.png)")).toEqual(
      p({
        k: "image",
        alt: "代替",
        url: "https://example.com/a.png",
        title: "",
      }),
    );
    expect(body("![a](data:image/png;base64,AAAA)")).toMatchObject(
      p({ k: "image", url: "data:image/png;base64,AAAA" }),
    );
    expect(notices("![a](b.png)")).toEqual(["image-not-loaded"]);
  });
  it("entities decode to plain text; script-like text is only text", () => {
    expect(body("&lt;script&gt;&amp;&quot;")).toEqual(p(t('<script>&"')));
    expect(body("</script><script>alert(1)</script>")).toEqual(
      p(t("</script><script>alert(1)</script>")),
    );
    expect(body("<img src=x onerror=alert(1)>")).toEqual(
      p(t("<img src=x onerror=alert(1)>")),
    );
    expect(body("<svg><math><iframe srcdoc=x>")).toEqual(
      p(t("<svg><math><iframe srcdoc=x>")),
    );
  });
  it("every parsed model re-validates on the main-thread checker", () => {
    const text = [
      "---\ntitle: 題\n---",
      "### 　　　見出し",
      "｜青空《あおぞら》||下線||<u>u</u>｟AB｠[l](https://e.com)![i](x.png)`c`",
      ":::indent-2\n> 引用\n:::",
      ":::page-break\n:::",
      "1. a\n2. b",
    ].join("\n\n");
    const model = parsePreview(text);
    expect(validateModel(JSON.parse(JSON.stringify(model)))).toMatchObject({
      ok: true,
    });
  });
});

describe("S8-04 Worker body limits", () => {
  it("input bytes, UTF-8, depth, nodes and text budgets", () => {
    expect(previewBytes(enc("abcde"), { ...limits(), inputBytes: 4 })).toEqual({
      status: "limit",
      reason: "input-bytes",
    });
    expect(previewBytes(new Uint8Array([0xff]))).toEqual({
      status: "failed",
      reason: "invalid-utf8",
    });
    expect(previewBytes(enc(">".repeat(70) + " x"))).toEqual({
      status: "limit",
      reason: "depth",
    });
    expect(
      previewBytes(
        enc(
          Array.from({ length: 40 }, (_, i) => "  ".repeat(i) + "- x").join(
            "\n",
          ),
        ),
      ),
    ).toEqual({ status: "limit", reason: "depth" });
    expect(previewBytes(enc("a\n\nb\n\nc"), { ...limits(), nodes: 5 })).toEqual(
      { status: "limit", reason: "nodes" },
    );
    expect(previewBytes(enc("abcdef"), { ...limits(), textUnits: 5 })).toEqual({
      status: "limit",
      reason: "text",
    });
    const ok = previewBytes(enc("本文"));
    expect(ok.status).toBe("ok");
    expect((ok as { model: PreviewModel }).model.body).toEqual(p(t("本文")));
  });
  it("empty and whitespace-only input produce an empty body", () => {
    expect(previewBytes(new Uint8Array())).toEqual({
      status: "ok",
      model: {
        contract: PREVIEW_CONTRACT,
        frontmatter: null,
        body: [],
        notices: [],
      },
    });
    expect(parsePreview("\n\n  \n").body).toEqual([]);
  });
  it("depth just below the limit still parses", () => {
    expect(previewBytes(enc(">".repeat(20) + " x")).status).toBe("ok");
  });
});

function limits() {
  return {
    inputBytes: 4 * 1048576,
    nodes: 20000,
    depth: 64,
    textUnits: 2 * 1048576,
    timeoutMs: 5000,
    sourceWindowBytes: 128 * 1024,
  };
}
