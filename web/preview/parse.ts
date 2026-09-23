// Preview-only Markdown reading. Runs inside the preview Worker (and in Node
// tests). It never renders HTML: tokens become the typed model in ./model.ts.
// The Aozora/Nyoze syntax rules are written for this project from the public
// syntax description; no Nyoze source is used.
import MarkdownIt from "markdown-it";
import type {
  MarkdownIt as MarkdownItInstance,
  StateBlock,
  StateCore,
  StateInline,
  Token,
  Delimiter,
} from "markdown-it";
import { frontmatterEnvelope } from "../../src/core/protectedRanges.js";
import { readFrontmatter } from "../../src/core/frontmatter.js";
import {
  Budget,
  FRONTMATTER_KEYS,
  ModelLimitError,
  type FrontmatterKey,
  type HeadingLevel,
  type IndentLevel,
  type PreviewBlock,
  type PreviewFrontmatter,
  type PreviewInline,
  type PreviewModel,
  type PreviewNoticeCode,
} from "./model.js";
import {
  PREVIEW_CONTRACT,
  PREVIEW_LIMITS,
  type PreviewWorkerOutcome,
} from "./protocol.js";

/** markdown-it stops block parsing silently at this level; reaching it is a depth limit. */
const MAX_NESTING = 64;
const PIPE = 0x7c;
const LT = 0x3c;
const STAR = 0x2a;
const DIRECTIVE_DEPTH = Symbol("aozora-directive-depth");
const CLOSE_LINES = Symbol("aozora-directive-close-lines");
const DIRECTIVE_SCAN = Symbol("aozora-directive-scan");
const CODE_SPANS = Symbol("aozora-code-spans");
const SPAN_BASE = Symbol("aozora-span-base");

function codePointBefore(src: string, pos: number): number {
  if (pos <= 0) return 0x20;
  const low = src.charCodeAt(pos - 1);
  if (low >= 0xdc00 && low <= 0xdfff && pos >= 2) {
    const high = src.charCodeAt(pos - 2);
    if (high >= 0xd800 && high <= 0xdbff)
      return 0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00);
  }
  return low;
}
function codePointAt(src: string, pos: number): number {
  return pos < src.length ? (src.codePointAt(pos) ?? 0x20) : 0x20;
}
/** Han, kana, Hangul, CJK punctuation/compatibility forms and fullwidth forms. */
export function isCjk(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x11ff) ||
    (c >= 0x2e80 && c <= 0x2fff) ||
    (c >= 0x3001 && c <= 0x33ff) ||
    (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xa960 && c <= 0xa97f) ||
    (c >= 0xac00 && c <= 0xd7ff) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xffef) ||
    (c >= 0x20000 && c <= 0x3ffff)
  );
}

function createParser(): MarkdownItInstance {
  const md = new MarkdownIt("default", {
    html: false,
    linkify: false,
    typographer: false,
    breaks: true,
    maxNesting: MAX_NESTING,
  });
  // Tables/strikethrough stay literal. Reference definitions would otherwise
  // disappear from the view, so they stay visible as ordinary text.
  md.disable(["table", "strikethrough", "reference", "html_inline"]);
  md.disable(["html_block", "linkify", "replacements", "smartquotes"]);
  const { isWhiteSpace, isPunctCharCode, isMdAsciiPunct } = md.utils;
  const punct = (c: number) => isMdAsciiPunct(c) || isPunctCharCode(c);

  // CommonMark flanking rejects `第**｟IIII｠**章`. Next to CJK text, the
  // punctuation clause is relaxed for `*` only. ASCII contexts are unchanged.
  class AozoraStateInline extends MarkdownIt.StateInline {
    /** Offset of `src` in the scanned text; image alts are parsed as a new src. */
    spanBase: number;
    constructor(
      src: string,
      md: MarkdownItInstance,
      env: Record<PropertyKey, unknown>,
      outTokens: Token[],
    ) {
      super(src, md, env, outTokens);
      const stack = env?.[SPAN_BASE] as number[] | undefined;
      this.spanBase = stack ? stack[stack.length - 1] : 0;
    }
    scanDelims(start: number, canSplitWord: boolean) {
      const base = super.scanDelims(start, canSplitWord);
      if (this.src.charCodeAt(start) !== STAR) return base;
      const prev = codePointBefore(this.src, start),
        next = codePointAt(this.src, start + base.length);
      if (!isCjk(prev) && !isCjk(next)) return base;
      const cjk = isCjk(prev) || isCjk(next);
      const left =
        !isWhiteSpace(next) &&
        (!punct(next) || isWhiteSpace(prev) || punct(prev) || cjk);
      const right =
        !isWhiteSpace(prev) &&
        (!punct(prev) || isWhiteSpace(next) || punct(next) || cjk);
      return { can_open: left, can_close: right, length: base.length };
    }
  }
  md.inline.State = AozoraStateInline;

  // Same as the default text rule, plus `|` so that `||` reaches its rule.
  md.inline.ruler.at("text", (state: StateInline, silent: boolean) => {
    let pos = state.pos;
    while (pos < state.posMax && !terminator(state.src.charCodeAt(pos))) pos++;
    if (pos === state.pos) return false;
    if (!silent) state.pending += state.src.slice(state.pos, pos);
    state.pos = pos;
    return true;
  });
  // Directive scanning records code span offsets. markdown-it exposes the
  // built-in rule functions only through its ruler (the version is pinned).
  const rule = (name: string) =>
    md.inline.ruler.__rules__[md.inline.ruler.__find__(name)].fn;
  const backticks = rule("backticks"),
    image = rule("image");
  md.inline.ruler.at("backticks", (state: StateInline, silent: boolean) => {
    const start = state.pos,
      before = state.tokens.length;
    if (!backticks(state, silent)) return false;
    const spans = state.env[CODE_SPANS] as number[] | undefined;
    if (
      spans &&
      !silent &&
      state.tokens.length > before &&
      state.tokens[state.tokens.length - 1].type === "code_inline"
    ) {
      const base = (state as AozoraStateInline).spanBase;
      spans.push(base + start, base + state.pos);
    }
    return true;
  });
  md.inline.ruler.at("image", (state: StateInline, silent: boolean) => {
    const stack = state.env[SPAN_BASE] as number[] | undefined;
    if (!stack || silent) return image(state, silent);
    stack.push((state as AozoraStateInline).spanBase + state.pos + 2);
    try {
      return image(state, silent);
    } finally {
      stack.pop();
    }
  });
  md.inline.ruler.before("emphasis", "aozora_pipe_underline", pipeUnderline);
  md.inline.ruler.before("autolink", "aozora_html_underline", htmlUnderline);
  md.inline.ruler2.before("emphasis", "aozora_underline", underlinePost);
  md.core.ruler.after("text_join", "aozora_ruby_tcy", rubyAndTcy);
  md.block.ruler.before("fence", "aozora_directive", directive, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  return md;
}
function terminator(ch: number): boolean {
  switch (ch) {
    case 0x0a:
    case 0x21:
    case 0x23:
    case 0x24:
    case 0x25:
    case 0x26:
    case 0x2a:
    case 0x2b:
    case 0x2d:
    case 0x3a:
    case 0x3c:
    case 0x3d:
    case 0x3e:
    case 0x40:
    case 0x5b:
    case 0x5c:
    case 0x5d:
    case 0x5e:
    case 0x5f:
    case 0x60:
    case 0x7b:
    case 0x7c:
    case 0x7d:
    case 0x7e:
      return true;
    default:
      return false;
  }
}

function pipeUnderline(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  if (silent || state.src.charCodeAt(start) !== PIPE) return false;
  let end = start;
  while (end < state.posMax && state.src.charCodeAt(end) === PIPE) end++;
  let len = end - start;
  if (len < 2) return false;
  const { isWhiteSpace } = state.md.utils;
  const open = !isWhiteSpace(codePointAt(state.src, end));
  const close = !isWhiteSpace(codePointBefore(state.src, start));
  if (len % 2) {
    state.push("text", "", 0).content = "|";
    len--;
  }
  for (let i = 0; i < len; i += 2) {
    state.push("text", "", 0).content = "||";
    state.delimiters.push({
      marker: PIPE,
      length: 0,
      token: state.tokens.length - 1,
      end: -1,
      open,
      close,
    });
  }
  state.pos = end;
  return true;
}
/** Only the exact attribute-free lowercase tags; everything else stays text. */
function htmlUnderline(state: StateInline, silent: boolean): boolean {
  const src = state.src,
    pos = state.pos;
  if (silent || src.charCodeAt(pos) !== LT) return false;
  const open = src.startsWith("<u>", pos);
  if (!open && !src.startsWith("</u>", pos)) return false;
  state.push("text", "", 0).content = open ? "<u>" : "</u>";
  state.delimiters.push({
    marker: LT,
    length: 0,
    token: state.tokens.length - 1,
    end: -1,
    open,
    close: !open,
  });
  state.pos += open ? 3 : 4;
  return true;
}
function underlineIn(state: StateInline, delimiters: Delimiter[]) {
  const lone: number[] = [];
  for (const start of delimiters) {
    if ((start.marker !== PIPE && start.marker !== LT) || start.end === -1)
      continue;
    const end = delimiters[start.end];
    const o = state.tokens[start.token],
      c = state.tokens[end.token];
    o.type = "aozora_u_open";
    o.tag = "u";
    o.nesting = 1;
    o.markup = o.content;
    o.content = "";
    c.type = "aozora_u_close";
    c.tag = "u";
    c.nesting = -1;
    c.markup = c.content;
    c.content = "";
    const before = state.tokens[end.token - 1];
    if (
      start.marker === PIPE &&
      before?.type === "text" &&
      before.content === "|"
    )
      lone.push(end.token - 1);
  }
  // `a||b|||`: keep the odd pipe outside the closing tag.
  while (lone.length) {
    const i = lone.pop()!;
    let j = i + 1;
    while (j < state.tokens.length && state.tokens[j].type === "aozora_u_close")
      j++;
    j--;
    if (i !== j) {
      const t = state.tokens[j];
      state.tokens[j] = state.tokens[i];
      state.tokens[i] = t;
    }
  }
}
function underlinePost(state: StateInline) {
  underlineIn(state, state.delimiters);
  for (const meta of state.tokens_meta)
    if (meta?.delimiters) underlineIn(state, meta.delimiters);
}

// Explicit ruby, conservative kanji-only ruby (the core's rule in
// rubyContext.ts), and the S7 TCY body contract. Non-empty readings only.
const INLINE_MARKUP =
  /｜([^｜《》\n]+)《([^｜《》\n]+)》|([\p{Script=Han}々〆ヵヶ]+)《([^｜《》\n]+)》|｟([A-Za-z0-9!?]{1,4})｠/gu;
function rubyAndTcy(state: StateCore) {
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const out: Token[] = [];
    for (const t of block.children) {
      if (t.type !== "text") {
        out.push(t);
        continue;
      }
      let last = 0;
      for (const m of t.content.matchAll(INLINE_MARKUP)) {
        const at = m.index!;
        if (at > last) out.push(text(state, t.content.slice(last, at)));
        if (m[5] !== undefined) {
          const tcy = new state.Token("aozora_tcy", "", 0);
          tcy.content = m[5];
          out.push(tcy);
        } else {
          const ruby = new state.Token("aozora_ruby", "", 0);
          ruby.meta = { base: m[1] ?? m[3], rt: m[2] ?? m[4] };
          out.push(ruby);
        }
        last = at + m[0].length;
      }
      if (last === 0) out.push(t);
      else if (last < t.content.length)
        out.push(text(state, t.content.slice(last)));
    }
    block.children = out;
  }
}
function text(state: StateCore, content: string): Token {
  const t = new state.Token("text", "", 0);
  t.content = content;
  return t;
}

const DIRECTIVE_OPEN =
  /^:::(?:indent-([1-6])|(align-end)|(page-break)|(blank-page))[ \t]*$/;
const DIRECTIVE_CLOSE = /^:::[ \t]*$/;
function lineText(state: StateBlock, line: number): string {
  return state.src.slice(
    state.bMarks[line] + state.tShift[line],
    state.eMarks[line],
  );
}
/** First index whose value is >= x. */
function lowerBound(values: ArrayLike<number>, x: number): number {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
interface DirectiveScan {
  /** Top-level lone `:::` lines outside code. */
  closes: number[];
  /** 1 for lines inside a fence, an indented code block or a code span. */
  code: Uint8Array;
}
/**
 * Found once per parse so each opener is O(log n). Code comes from one
 * block-only pass of the same parser with directives off, so containers and
 * unclosed fences follow markdown-it exactly. Only paragraphs holding a
 * backtick and a directive-like line after their first line are
 * inline-parsed, to find code spans that cross lines.
 */
function scanDirectives(state: StateBlock): DirectiveScan {
  const cached = state.env[CLOSE_LINES] as DirectiveScan | undefined;
  if (cached) return cached;
  const lineMax = state.lineMax;
  const marks: number[] = [];
  for (let line = 0; line < lineMax; line++) {
    if (state.sCount[line] >= 4) continue;
    const s = lineText(state, line);
    if (DIRECTIVE_CLOSE.test(s) || DIRECTIVE_OPEN.test(s)) marks.push(line);
  }
  const diff = new Int32Array(lineMax + 1);
  const mark = (from: number, to: number) => {
    if (from >= to) return;
    diff[from]++;
    diff[Math.min(to, lineMax)]--;
  };
  const scan: Token[] = [];
  state.md.block.parse(state.src, state.md, { [DIRECTIVE_SCAN]: true }, scan);
  for (const t of scan) {
    if (!t.map) continue;
    const [first, end] = t.map;
    if (t.type === "fence" || t.type === "code_block") mark(first, end);
    if (t.type !== "inline" || !t.content.includes("`")) continue;
    const at = lowerBound(marks, first + 1);
    if (at >= marks.length || marks[at] >= end) continue;
    const spans: number[] = [];
    state.md.inline.parse(
      t.content,
      state.md,
      { [CODE_SPANS]: spans, [SPAN_BASE]: [0] },
      [],
    );
    if (!spans.length) continue;
    // Content line i is source line first + i.
    const newlines: number[] = [];
    for (
      let i = t.content.indexOf("\n");
      i >= 0;
      i = t.content.indexOf("\n", i + 1)
    )
      newlines.push(i);
    for (let k = 0; k < spans.length; k += 2)
      mark(
        first + 1 + lowerBound(newlines, spans[k]),
        first + 1 + lowerBound(newlines, spans[k + 1] - 1),
      );
  }
  const code = new Uint8Array(lineMax);
  const closes: number[] = [];
  let inCode = 0,
    next = 0;
  for (let line = 0; line < lineMax; line++) {
    inCode += diff[line];
    code[line] = inCode > 0 ? 1 : 0;
    if (marks[next] !== line) continue;
    next++;
    if (!inCode && DIRECTIVE_CLOSE.test(lineText(state, line)))
      closes.push(line);
  }
  const result = { closes, code };
  state.env[CLOSE_LINES] = result;
  return result;
}
/**
 * Nyoze-style blocks as emitted by the core: top level only, flat, closed by
 * a lone `:::`. Inside quotes/lists the line stays literal text.
 */
function directive(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  // A top-level paragraph checks terminators with parentType "paragraph".
  if (
    state.env[DIRECTIVE_SCAN] ||
    state.env[DIRECTIVE_DEPTH] ||
    (state.parentType !== "root" && state.parentType !== "paragraph") ||
    state.level !== 0 ||
    state.blkIndent !== 0 ||
    state.sCount[startLine] >= 4
  )
    return false;
  const m = DIRECTIVE_OPEN.exec(lineText(state, startLine));
  if (!m) return false;
  const scan = scanDirectives(state);
  if (scan.code[startLine]) return false;
  const lines = scan.closes;
  const lo = lowerBound(lines, startLine + 1);
  const close = lo < lines.length && lines[lo] < endLine ? lines[lo] : -1;
  if (close < 0) return false;
  const pageKind = m[3] ? "page-break" : m[4] ? "blank-page" : undefined;
  if (pageKind && close !== startLine + 1) return false;
  if (silent) return true;
  if (pageKind) {
    const t = state.push("aozora_break", "", 0);
    t.meta = { kind: pageKind };
    t.map = [startLine, close + 1];
    state.line = close + 1;
    return true;
  }
  const open = state.push("aozora_directive_open", "div", 1);
  open.meta = m[1] ? { kind: "indent", level: Number(m[1]) } : { kind: m[2] };
  open.map = [startLine, close + 1];
  const parentType = state.parentType,
    lineMax = state.lineMax;
  state.env[DIRECTIVE_DEPTH] = 1;
  state.parentType = "aozora_directive" as typeof state.parentType;
  state.lineMax = close;
  state.md.block.tokenize(state, startLine + 1, close);
  state.env[DIRECTIVE_DEPTH] = 0;
  state.parentType = parentType;
  state.lineMax = lineMax;
  state.push("aozora_directive_close", "div", -1);
  state.line = close + 1;
  return true;
}

let parser: MarkdownItInstance | undefined;

class Builder {
  readonly notices = new Set<PreviewNoticeCode>();
  constructor(
    readonly md: MarkdownItInstance,
    readonly budget: Budget,
  ) {}
  blocks(tokens: Token[]): PreviewBlock[] {
    const root: PreviewBlock[] = [];
    type Frame = { c: unknown[]; depth: number; close: string };
    const stack: Frame[] = [{ c: root, depth: 0, close: "" }];
    const open = (node: PreviewBlock, c: unknown[], close: string) => {
      const top = stack[stack.length - 1];
      this.budget.node(top.depth + 1);
      top.c.push(node);
      stack.push({ c, depth: top.depth + 1, close });
    };
    const leaf = (node: PreviewBlock) => {
      const top = stack[stack.length - 1];
      this.budget.node(top.depth + 1);
      top.c.push(node);
    };
    for (const t of tokens) {
      if (t.nesting === 1 && t.level >= MAX_NESTING - 1)
        throw new ModelLimitError("depth");
      const top = stack[stack.length - 1];
      switch (t.type) {
        case "paragraph_open": {
          const node = { k: "p" as const, c: [] as PreviewInline[] };
          open(node, node.c, "paragraph_close");
          break;
        }
        case "heading_open": {
          const level = Number(t.tag.slice(1));
          if (!(level >= 1 && level <= 6)) throw Error("heading-level");
          const node = {
            k: "h" as const,
            level: level as HeadingLevel,
            c: [] as PreviewInline[],
          };
          open(node, node.c, "heading_close");
          break;
        }
        case "blockquote_open": {
          const node = { k: "quote" as const, c: [] as PreviewBlock[] };
          open(node, node.c, "blockquote_close");
          break;
        }
        case "bullet_list_open": {
          const node = { k: "ul" as const, c: [] };
          open(node, node.c, "bullet_list_close");
          break;
        }
        case "ordered_list_open": {
          const start = Number(t.attrGet("start") ?? 1);
          const node = {
            k: "ol" as const,
            start:
              Number.isInteger(start) && start >= 0 && start <= 999999999
                ? start
                : 1,
            c: [],
          };
          open(node, node.c, "ordered_list_close");
          break;
        }
        case "list_item_open": {
          const node = { k: "li" as const, c: [] as PreviewBlock[] };
          open(node as unknown as PreviewBlock, node.c, "list_item_close");
          break;
        }
        case "aozora_directive_open": {
          const meta = t.meta as { kind: string; level?: number };
          const node =
            meta.kind === "indent"
              ? {
                  k: "indent" as const,
                  level: meta.level as IndentLevel,
                  c: [] as PreviewBlock[],
                }
              : { k: "align-end" as const, c: [] as PreviewBlock[] };
          open(node, node.c, "aozora_directive_close");
          break;
        }
        case "inline":
          top.c.push(...this.inlines(t.children ?? [], top.depth + 1));
          break;
        case "hr":
          leaf({ k: "hr" });
          break;
        case "fence":
        case "code_block":
          this.budget.chars(t.info);
          this.budget.chars(t.content);
          leaf({
            k: "pre",
            info: t.type === "fence" ? t.info : "",
            v: t.content,
          });
          break;
        case "aozora_break":
          leaf({ k: (t.meta as { kind: "page-break" | "blank-page" }).kind });
          break;
        default:
          if (t.nesting === -1 && t.type === top.close) {
            stack.pop();
            break;
          }
          throw Error("unsupported-token");
      }
    }
    if (stack.length !== 1) throw Error("unbalanced-blocks");
    return root;
  }
  inlines(tokens: Token[], depth: number): PreviewInline[] {
    const root: PreviewInline[] = [];
    type Frame = {
      node: PreviewInline & { c: PreviewInline[] };
      parent: PreviewInline[];
      depth: number;
      close: string;
      markup: string;
    };
    const stack: Frame[] = [];
    const current = () =>
      stack.length ? stack[stack.length - 1].node.c : root;
    const nextDepth = () =>
      stack.length ? stack[stack.length - 1].depth + 1 : depth;
    const addText = (s: string) => {
      if (!s) return;
      const c = current(),
        last = c[c.length - 1];
      this.budget.chars(s);
      if (last?.k === "text") last.v += s;
      else {
        this.budget.node(nextDepth());
        c.push({ k: "text", v: s });
      }
    };
    const leaf = (node: PreviewInline) => {
      this.budget.node(nextDepth());
      current().push(node);
    };
    const open = (
      node: PreviewInline & { c: PreviewInline[] },
      close: string,
      markup: string,
    ) => {
      const d = nextDepth();
      this.budget.node(d);
      const parent = current();
      parent.push(node);
      stack.push({ node, parent, depth: d, close, markup });
    };
    for (const t of tokens) {
      switch (t.type) {
        case "text":
          addText(t.content);
          break;
        case "softbreak":
        case "hardbreak":
          addText("\n");
          break;
        case "code_inline":
          this.budget.chars(t.content);
          leaf({ k: "code", v: t.content });
          break;
        case "aozora_ruby": {
          const { base, rt } = t.meta as { base: string; rt: string };
          this.budget.chars(base);
          this.budget.chars(rt);
          leaf({ k: "ruby", base, rt });
          break;
        }
        case "aozora_tcy":
          this.budget.chars(t.content);
          this.notices.add("tcy-horizontal");
          leaf({ k: "tcy", v: t.content });
          break;
        case "strong_open":
          open({ k: "strong", c: [] }, "strong_close", t.markup);
          break;
        case "em_open":
          open({ k: "em", c: [] }, "em_close", t.markup);
          break;
        case "aozora_u_open":
          open({ k: "u", c: [] }, "aozora_u_close", t.markup);
          break;
        case "link_open": {
          const url = this.md.normalizeLinkText(
            String(t.attrGet("href") ?? ""),
          );
          const title = String(t.attrGet("title") ?? "");
          this.budget.chars(url);
          this.budget.chars(title);
          this.notices.add("link-not-opened");
          open({ k: "link", c: [], url, title }, "link_close", "");
          break;
        }
        case "image": {
          const alt = plain(t.children ?? []);
          const url = this.md.normalizeLinkText(String(t.attrGet("src") ?? ""));
          const title = String(t.attrGet("title") ?? "");
          this.budget.chars(alt);
          this.budget.chars(url);
          this.budget.chars(title);
          this.notices.add("image-not-loaded");
          leaf({ k: "image", alt, url, title });
          break;
        }
        case "strong_close":
        case "em_close":
        case "aozora_u_close":
        case "link_close":
          if (stack.length && stack[stack.length - 1].close === t.type)
            stack.pop();
          else addText(t.markup);
          break;
        default:
          throw Error("unsupported-token");
      }
    }
    // A crossing `<u>`/`||` pair cannot nest: show its opening markup as text.
    while (stack.length) {
      const f = stack.pop()!;
      const at = f.parent.indexOf(f.node);
      this.budget.chars(f.markup);
      const literal: PreviewInline[] = f.markup
        ? [{ k: "text", v: f.markup }]
        : [];
      f.parent.splice(at, 1, ...literal, ...f.node.c);
    }
    return root;
  }
}
function plain(tokens: Token[]): string {
  let s = "";
  for (const t of tokens) {
    if (t.type === "softbreak" || t.type === "hardbreak") s += "\n";
    else if (t.children) s += plain(t.children);
    else s += t.content;
  }
  return s;
}

function readFrontmatterView(text: string): {
  frontmatter: PreviewFrontmatter | null;
  body: string;
  notice?: PreviewNoticeCode;
} {
  const envelope = frontmatterEnvelope(text);
  if (!envelope) return { frontmatter: null, body: text };
  if (!envelope.closed)
    return {
      frontmatter: { status: "unclosed", raw: text },
      body: "",
      notice: "frontmatter-unclosed",
    };
  const raw = text.slice(0, envelope.endUtf16);
  const rest = text.slice(
    envelope.endUtf16 + (text[envelope.endUtf16] === "\n" ? 1 : 0),
  );
  const read = readFrontmatter(text);
  if (!read.ok || !read.metadata)
    return {
      frontmatter: { status: "invalid", raw },
      body: rest,
      notice: "frontmatter-invalid",
    };
  const fields: [FrontmatterKey, string][] = [];
  const metadata = read.metadata as Partial<
    Record<FrontmatterKey, string | string[]>
  >;
  for (const key of FRONTMATTER_KEYS) {
    const value = metadata[key];
    if (typeof value === "string") fields.push([key, value]);
    else if (Array.isArray(value))
      for (const v of value) if (typeof v === "string") fields.push([key, v]);
  }
  return { frontmatter: { status: "valid", fields, raw }, body: rest };
}

/** Throws ModelLimitError when the model would exceed a display budget. */
export function parsePreview(
  text: string,
  limits: { nodes: number; depth: number; textUnits: number } = PREVIEW_LIMITS,
): PreviewModel {
  parser ??= createParser();
  const budget = new Budget(limits);
  const fm = readFrontmatterView(text);
  if (fm.frontmatter) {
    budget.chars(fm.frontmatter.raw);
    if (fm.frontmatter.status === "valid")
      for (const [, v] of fm.frontmatter.fields) {
        budget.node(1);
        budget.chars(v);
      }
  }
  const builder = new Builder(parser, budget);
  if (fm.notice) builder.notices.add(fm.notice);
  const body = fm.body ? builder.blocks(parser.parse(fm.body, {})) : [];
  return {
    contract: PREVIEW_CONTRACT,
    frontmatter: fm.frontmatter,
    body,
    notices: [...builder.notices].sort(),
  };
}

/** Worker body: bytes are the artifact copy; UTF-8 is decoded without normalization. */
export function previewBytes(
  bytes: Uint8Array,
  limits: {
    inputBytes: number;
    nodes: number;
    depth: number;
    textUnits: number;
  } = PREVIEW_LIMITS,
): PreviewWorkerOutcome {
  if (bytes.byteLength > limits.inputBytes)
    return { status: "limit", reason: "input-bytes" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return { status: "failed", reason: "invalid-utf8" };
  }
  try {
    return { status: "ok", model: parsePreview(text, limits) };
  } catch (e) {
    if (e instanceof ModelLimitError)
      return { status: "limit", reason: e.reason };
    return { status: "failed", reason: "parse-failed" };
  }
}
