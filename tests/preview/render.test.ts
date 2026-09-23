import { describe, expect, it } from "vitest";
import {
  renderPreview,
  type PreviewDom,
  type PreviewTag,
} from "../../web/preview/render.js";
import { parsePreview } from "../../web/preview/parse.js";
import { validateModel, type PreviewModel } from "../../web/preview/model.js";

interface FakeEl {
  tag: PreviewTag;
  cls: string;
  attrs: Record<string, string>;
  children: (FakeEl | FakeText)[];
}
interface FakeText {
  text: string;
}
const ALLOWED = new Set<string>([
  "div",
  "section",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "hr",
  "pre",
  "code",
  "strong",
  "em",
  "u",
  "ruby",
  "rt",
  "rp",
  "span",
  "dl",
  "dt",
  "dd",
  "details",
  "summary",
]);
function fakeDom() {
  const log = { elements: 0, texts: 0 };
  const dom: PreviewDom<FakeEl, FakeText> = {
    createElement(tag) {
      log.elements++;
      return { tag, cls: "", attrs: {}, children: [] };
    },
    createTextNode(text) {
      log.texts++;
      return { text };
    },
    append(parent, child) {
      parent.children.push(child);
    },
    setClass(el, cls) {
      el.cls = cls;
    },
    setAttribute(el, name, value) {
      el.attrs[name] = value;
    },
  };
  return { dom, log };
}
const textOf = (n: FakeEl | FakeText): string =>
  "text" in n ? n.text : n.children.map(textOf).join("");
function walk(n: FakeEl, visit: (e: FakeEl) => void) {
  visit(n);
  for (const c of n.children) if (!("text" in c)) walk(c, visit);
}
function find(n: FakeEl, pred: (e: FakeEl) => boolean): FakeEl[] {
  const out: FakeEl[] = [];
  walk(n, (e) => pred(e) && out.push(e));
  return out;
}
const now = () => Promise.resolve();
async function render(model: PreviewModel) {
  const { dom, log } = fakeDom();
  const r = await renderPreview(model, dom, {
    cancelled: () => false,
    yieldControl: now,
  });
  if (r.status !== "done") throw Error(r.status);
  return { root: r.root, nodes: r.nodes, log };
}

describe("S8-01/03 source → model → DOM", () => {
  it("heading keeps five U+3000 in DOM text; structure uses allowlisted tags", async () => {
    const heading = "　　　　　第一夜";
    const { root } = await render(parsePreview(`### ${heading}\n\n本文`));
    const [h3] = find(root, (e) => e.tag === "h3");
    expect(textOf(h3)).toBe(heading);
    expect([...textOf(h3)].filter((c) => c === "\u3000")).toHaveLength(5);
    walk(root, (e) => {
      expect(ALLOWED.has(e.tag)).toBe(true);
      for (const name of Object.keys(e.attrs))
        expect(["start", "role", "aria-label"]).toContain(name);
    });
  });
  it("ruby, TCY, underline, code and directives", async () => {
    const { root } = await render(
      parsePreview(
        "｜青空《あおぞら》||下線||<u>u</u>｟AB｠`c`\n\n:::indent-3\n字下げ\n:::\n\n:::align-end\n署名\n:::\n\n:::page-break\n:::\n\n:::blank-page\n:::",
      ),
    );
    const [ruby] = find(root, (e) => e.tag === "ruby");
    expect(ruby.children.map((c) => ("text" in c ? "#" : c.tag))).toEqual([
      "#",
      "rp",
      "rt",
      "rp",
    ]);
    expect(textOf(ruby)).toBe("青空《あおぞら》");
    expect(find(root, (e) => e.tag === "u").map(textOf)).toEqual(["下線", "u"]);
    expect(find(root, (e) => e.cls === "preview-tcy").map(textOf)).toEqual([
      "AB",
    ]);
    expect(find(root, (e) => e.tag === "code").map(textOf)).toEqual(["c"]);
    expect(
      find(root, (e) => e.cls === "preview-indent preview-indent-3").map(
        textOf,
      ),
    ).toEqual(["字下げ"]);
    expect(
      find(root, (e) => e.cls === "preview-align-end").map(textOf),
    ).toEqual(["署名"]);
    const marks = find(root, (e) => e.attrs.role === "separator");
    expect(marks.map((e) => [e.cls, e.attrs["aria-label"]])).toEqual([
      ["preview-page-break", "改ページ"],
      ["preview-blank-page", "空白ページ"],
    ]);
  });
  it("links and images never become navigable/loadable elements", async () => {
    const { root } = await render(
      parsePreview(
        '[表示](https://example.com/?q=<x> "題") ![代替](https://example.com/a.png) [x](javascript:alert(1))',
      ),
    );
    expect(textOf(root)).toBe(
      "表示〈リンク先: https://example.com/?q=<x> “題”〉 ［画像: 代替］〈画像は読み込みません: https://example.com/a.png〉 [x](javascript:alert(1))",
    );
    walk(root, (e) => {
      expect(["a", "img", "iframe", "script", "style"]).not.toContain(e.tag);
      expect(e.attrs).not.toHaveProperty("href");
      expect(e.attrs).not.toHaveProperty("src");
    });
  });
  it("frontmatter: valid fields, raw details, invalid/unclosed raw", async () => {
    const valid = await render(
      parsePreview("---\ntitle: 題\nauthor: 著\n---\n本文"),
    );
    expect(find(valid.root, (e) => e.tag === "dt").map(textOf)).toEqual([
      "題名（title）",
      "著者（author）",
    ]);
    expect(find(valid.root, (e) => e.tag === "dd").map(textOf)).toEqual([
      "題",
      "著",
    ]);
    expect(find(valid.root, (e) => e.tag === "pre").map(textOf)).toEqual([
      "---\ntitle: 題\nauthor: 著\n---",
    ]);
    const unclosed = await render(parsePreview("---\ntitle: x\n本文"));
    expect(find(unclosed.root, (e) => e.tag === "pre").map(textOf)).toEqual([
      "---\ntitle: x\n本文",
    ]);
  });
  it("hostile text stays text nodes", async () => {
    const src =
      "<script>alert(1)</script><img src=x onerror=alert(1)>\"'&lt;/script&gt;";
    const { root } = await render(parsePreview(src));
    expect(textOf(root)).toBe(
      "<script>alert(1)</script><img src=x onerror=alert(1)>\"'</script>",
    );
    expect(find(root, (e) => e.tag === "p")).toHaveLength(1);
  });
  it("ordered list start attribute only when not 1", async () => {
    const { root } = await render(parsePreview("3. a\n\n---\n\n1. b"));
    const lists = find(root, (e) => e.tag === "ol");
    expect(lists.map((e) => e.attrs)).toEqual([{ start: "3" }, {}]);
  });
});

describe("S8-04 batched rendering", () => {
  const many: PreviewModel = {
    contract: "aozora-preview-v1",
    frontmatter: null,
    body: Array.from({ length: 3000 }, (_, i) => ({
      k: "p" as const,
      c: [{ k: "text" as const, v: String(i) }],
    })),
    notices: [],
  };
  it("yields between batches and stops when cancelled", async () => {
    const { dom } = fakeDom();
    let yields = 0,
      cancel = false;
    const r = await renderPreview(many, dom, {
      cancelled: () => cancel,
      yieldControl: async () => {
        yields++;
        if (yields === 2) cancel = true;
      },
    });
    expect(r).toEqual({ status: "cancelled" });
    expect(yields).toBe(2);
  });
  it("finishes with batches and reports model nodes", async () => {
    const { dom } = fakeDom();
    let yields = 0;
    const r = await renderPreview(many, dom, {
      cancelled: () => false,
      yieldControl: async () => {
        yields++;
      },
    });
    expect(r).toMatchObject({ status: "done", nodes: 6000 });
    // 3,000 <p> + 3,000 text nodes + root/body, yielding every 400 created nodes.
    expect(yields).toBe(Math.floor(6002 / 400));
  });
  it("a cancelled result after the last batch is not returned as done", async () => {
    const { dom } = fakeDom();
    const r = await renderPreview(parsePreview("a"), dom, {
      cancelled: () => true,
      yieldControl: now,
    });
    expect(r).toEqual({ status: "cancelled" });
  });
  describe("S8-F02: frontmatter goes through the same batches", () => {
    const yaml = (n: number) =>
      "---\nauthors:\n" +
      Array.from({ length: n }, (_, i) => `  - 著者${i}`).join("\n") +
      "\n---\n";
    const validated = (source: string) => {
      const checked = validateModel(parsePreview(source));
      if (!checked.ok) throw Error("model rejected");
      return checked;
    };
    it("a large real-YAML frontmatter yields and can be cancelled mid-way", async () => {
      const checked = validated(yaml(5000));
      expect(checked.nodes).toBe(5000);
      const { dom, log } = fakeDom();
      let yields = 0,
        cancel = false;
      const r = await renderPreview(checked.model, dom, {
        batchSize: 400,
        cancelled: () => cancel,
        yieldControl: async () => {
          yields++;
          cancel = true;
        },
      });
      expect(r).toEqual({ status: "cancelled" });
      expect(yields).toBe(1);
      expect(log.elements + log.texts).toBeLessThan(500);
    });
    it("frontmatter only and frontmatter with body finish in several batches", async () => {
      for (const [source, dd, paragraphs] of [
        [yaml(3000), 3000, 0],
        [yaml(3000) + "本文\n\n続き", 3000, 2],
      ] as const) {
        const checked = validated(source);
        const { dom, log } = fakeDom();
        let yields = 0;
        const r = await renderPreview(checked.model, dom, {
          batchSize: 400,
          cancelled: () => false,
          yieldControl: async () => {
            yields++;
          },
        });
        if (r.status !== "done") throw Error(r.status);
        expect(find(r.root, (e) => e.tag === "dd")).toHaveLength(dd);
        expect(find(r.root, (e) => e.tag === "p" && !e.cls)).toHaveLength(
          paragraphs,
        );
        expect(yields).toBeGreaterThanOrEqual(
          Math.floor((log.elements + log.texts) / 400) - 1,
        );
        expect(yields).toBeGreaterThan(1);
      }
    });
    it("long invalid/unclosed raw text is one text node and still renders", async () => {
      const long = "x".repeat(200000);
      for (const source of [
        `---\ntitle: [\n${long}\n---\n本文`,
        `---\ntitle: x\n${long}`,
      ]) {
        const { root } = await render(validated(source).model);
        const [raw] = find(root, (e) => e.cls === "preview-literal");
        expect(textOf(raw)).toContain(long);
        expect(raw.children).toHaveLength(1);
      }
    });
    it("the node ceiling inside frontmatter returns limit, not a partial root", async () => {
      const { dom } = fakeDom();
      const r = await renderPreview(validated(yaml(500)).model, dom, {
        cancelled: () => false,
        yieldControl: now,
        maxNodes: 100,
      });
      expect(r).toEqual({ status: "limit", reason: "nodes" });
    });
  });
  it("node ceiling returns limit without a partial root", async () => {
    const { dom } = fakeDom();
    const r = await renderPreview(many, dom, {
      cancelled: () => false,
      yieldControl: now,
      maxNodes: 100,
    });
    expect(r).toEqual({ status: "limit", reason: "nodes" });
  });
});
