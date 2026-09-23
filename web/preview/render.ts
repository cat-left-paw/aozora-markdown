import type {
  FrontmatterKey,
  PreviewBlock,
  PreviewInline,
  PreviewListItem,
  PreviewModel,
} from "./model.js";
import { PREVIEW_LIMITS } from "./protocol.js";

/** Every element the preview can create. Nothing here loads a resource. */
export type PreviewTag =
  | "div"
  | "section"
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "blockquote"
  | "ul"
  | "ol"
  | "li"
  | "hr"
  | "pre"
  | "code"
  | "strong"
  | "em"
  | "u"
  | "ruby"
  | "rt"
  | "rp"
  | "span"
  | "dl"
  | "dt"
  | "dd"
  | "details"
  | "summary";
export type PreviewAttribute = "start" | "role" | "aria-label";
/** Narrow DOM seam: tag names and classes come from this module only. */
export interface PreviewDom<E, T> {
  createElement(tag: PreviewTag): E;
  createTextNode(text: string): T;
  append(parent: E, child: E | T): void;
  setClass(element: E, className: string): void;
  setAttribute(element: E, name: PreviewAttribute, value: string): void;
}
export type RenderResult<E> =
  | { status: "done"; root: E; nodes: number }
  | { status: "cancelled" }
  | { status: "limit"; reason: "nodes" };
export interface RenderOptions {
  cancelled: () => boolean;
  yieldControl?: () => Promise<void>;
  batchSize?: number;
  maxNodes?: number;
}

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
const INDENTS = [
  "preview-indent preview-indent-1",
  "preview-indent preview-indent-2",
  "preview-indent preview-indent-3",
  "preview-indent preview-indent-4",
  "preview-indent preview-indent-5",
  "preview-indent preview-indent-6",
] as const;
export const FRONTMATTER_LABELS: Record<FrontmatterKey, string> = {
  title: "題名（title）",
  author: "著者（author）",
  authors: "著者（authors）",
  translator: "翻訳者（translator）",
  translators: "翻訳者（translators）",
  raw_header: "元の見出し（raw_header）",
};
type Work<E> =
  | { kind: "block"; node: PreviewBlock; parent: E }
  | { kind: "item"; node: PreviewListItem; parent: E }
  | { kind: "inline"; node: PreviewInline; parent: E };

class Stop extends Error {}
class Cancelled extends Error {}

/**
 * Builds the preview into a detached root in small batches. The caller swaps
 * the finished root in; a cancelled or over-budget render returns nothing, so
 * no partial tree is ever shown.
 */
export async function renderPreview<E, T>(
  model: PreviewModel,
  dom: PreviewDom<E, T>,
  options: RenderOptions,
): Promise<RenderResult<E>> {
  const batch = options.batchSize ?? 400,
    maxNodes = options.maxNodes ?? PREVIEW_LIMITS.nodes,
    pause =
      options.yieldControl ?? (() => new Promise((r) => setTimeout(r, 0)));
  let modelNodes = 0,
    created = 0;
  const el = (tag: PreviewTag, className?: string) => {
    const e = dom.createElement(tag);
    if (className) dom.setClass(e, className);
    created++;
    return e;
  };
  const text = (parent: E, s: string) => {
    dom.append(parent, dom.createTextNode(s));
    created++;
  };
  const child = (parent: E, tag: PreviewTag, className?: string) => {
    const e = el(tag, className);
    dom.append(parent, e);
    return e;
  };
  const count = () => {
    if (++modelNodes > maxNodes) throw new Stop("nodes");
  };
  /** Every construction loop, frontmatter included, yields through here. */
  const tick = async () => {
    if (created < batch) return;
    created = 0;
    await pause();
    if (options.cancelled()) throw new Cancelled();
  };
  const root = el("div", "preview-document");
  const queue: Work<E>[] = [];
  let head = 0;
  try {
    if (model.frontmatter) {
      const fm = model.frontmatter;
      const section = child(root, "section", "preview-frontmatter");
      dom.setAttribute(section, "aria-label", "文書情報");
      text(
        child(section, "p", "preview-frontmatter-title"),
        "文書情報（frontmatter）",
      );
      if (fm.status === "valid") {
        if (fm.fields.length) {
          const dl = child(section, "dl");
          for (const [key, value] of fm.fields) {
            count();
            text(child(dl, "dt"), FRONTMATTER_LABELS[key]);
            text(child(dl, "dd"), value);
            await tick();
          }
        } else
          text(
            child(section, "p", "preview-frontmatter-note"),
            "表示する項目はありません。",
          );
        const details = child(section, "details");
        text(child(details, "summary"), "frontmatterの原文");
        text(child(details, "pre", "preview-literal"), fm.raw);
      } else {
        text(
          child(section, "p", "preview-frontmatter-note"),
          fm.status === "invalid"
            ? "frontmatterとして読み取れないため、原文のまま表示します。本文は続けて表示します。"
            : "frontmatterが閉じていない（2つ目の --- がない）ため、文書全体を原文のまま表示します。",
        );
        text(child(section, "pre", "preview-literal"), fm.raw);
      }
    }
    const body = child(root, "div", "preview-body");
    for (const node of model.body)
      queue.push({ kind: "block", node, parent: body });
    while (head < queue.length) {
      const work = queue[head];
      queue[head++] = undefined as unknown as Work<E>;
      count();
      if (work.kind === "item") {
        const li = child(work.parent, "li");
        for (const node of work.node.c)
          queue.push({ kind: "block", node, parent: li });
      } else if (work.kind === "block") renderBlock(work.node, work.parent);
      else renderInline(work.node, work.parent);
      await tick();
    }
  } catch (e) {
    if (e instanceof Stop) return { status: "limit", reason: "nodes" };
    if (e instanceof Cancelled) return { status: "cancelled" };
    throw e;
  }
  if (options.cancelled()) return { status: "cancelled" };
  return { status: "done", root, nodes: modelNodes };

  function inlines(nodes: PreviewInline[], parent: E) {
    for (const node of nodes) queue.push({ kind: "inline", node, parent });
  }
  function blocks(nodes: PreviewBlock[], parent: E) {
    for (const node of nodes) queue.push({ kind: "block", node, parent });
  }
  function renderBlock(node: PreviewBlock, parent: E) {
    switch (node.k) {
      case "p":
        inlines(node.c, child(parent, "p"));
        return;
      case "h":
        inlines(node.c, child(parent, HEADINGS[node.level - 1]));
        return;
      case "quote":
        blocks(node.c, child(parent, "blockquote"));
        return;
      case "ul":
      case "ol": {
        const list = child(parent, node.k);
        if (node.k === "ol" && node.start !== 1)
          dom.setAttribute(list, "start", String(node.start));
        for (const item of node.c)
          queue.push({ kind: "item", node: item, parent: list });
        return;
      }
      case "hr":
        child(parent, "hr");
        return;
      case "pre": {
        const box = child(parent, "div", "preview-code");
        if (node.info) text(child(box, "span", "preview-code-info"), node.info);
        text(child(child(box, "pre"), "code"), node.v);
        return;
      }
      case "indent":
        blocks(node.c, child(parent, "div", INDENTS[node.level - 1]));
        return;
      case "align-end":
        blocks(node.c, child(parent, "div", "preview-align-end"));
        return;
      case "page-break":
      case "blank-page": {
        const mark = child(
          parent,
          "div",
          node.k === "page-break" ? "preview-page-break" : "preview-blank-page",
        );
        dom.setAttribute(mark, "role", "separator");
        const label = node.k === "page-break" ? "改ページ" : "空白ページ";
        dom.setAttribute(mark, "aria-label", label);
        text(child(mark, "span"), label);
        return;
      }
    }
  }
  function renderInline(node: PreviewInline, parent: E) {
    switch (node.k) {
      case "text":
        text(parent, node.v);
        return;
      case "strong":
      case "em":
        inlines(node.c, child(parent, node.k));
        return;
      case "u":
        inlines(node.c, child(parent, "u", "preview-underline"));
        return;
      case "code":
        text(child(parent, "code"), node.v);
        return;
      case "ruby": {
        const ruby = child(parent, "ruby");
        text(ruby, node.base);
        text(child(ruby, "rp"), "《");
        text(child(ruby, "rt"), node.rt);
        text(child(ruby, "rp"), "》");
        return;
      }
      case "tcy":
        text(child(parent, "span", "preview-tcy"), node.v);
        return;
      case "link": {
        const box = child(parent, "span", "preview-link");
        inlines(node.c, child(box, "span", "preview-link-label"));
        text(
          child(box, "span", "preview-url"),
          `〈リンク先: ${node.url}${node.title ? ` “${node.title}”` : ""}〉`,
        );
        return;
      }
      case "image": {
        const box = child(parent, "span", "preview-image");
        text(child(box, "span", "preview-image-alt"), `［画像: ${node.alt}］`);
        text(
          child(box, "span", "preview-url"),
          `〈画像は読み込みません: ${node.url}${node.title ? ` “${node.title}”` : ""}〉`,
        );
        return;
      }
    }
  }
}
