import { PREVIEW_CONTRACT, PREVIEW_LIMITS } from "./protocol.js";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type IndentLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type PreviewInline =
  | { k: "text"; v: string }
  | { k: "strong" | "em" | "u"; c: PreviewInline[] }
  | { k: "code"; v: string }
  | { k: "ruby"; base: string; rt: string }
  | { k: "tcy"; v: string }
  | { k: "link"; c: PreviewInline[]; url: string; title: string }
  | { k: "image"; alt: string; url: string; title: string };
export interface PreviewListItem {
  k: "li";
  c: PreviewBlock[];
}
export type PreviewBlock =
  | { k: "p"; c: PreviewInline[] }
  | { k: "h"; level: HeadingLevel; c: PreviewInline[] }
  | { k: "quote"; c: PreviewBlock[] }
  | { k: "ul"; c: PreviewListItem[] }
  | { k: "ol"; start: number; c: PreviewListItem[] }
  | { k: "hr" }
  | { k: "pre"; info: string; v: string }
  | { k: "indent"; level: IndentLevel; c: PreviewBlock[] }
  | { k: "align-end"; c: PreviewBlock[] }
  | { k: "page-break" }
  | { k: "blank-page" };
export const FRONTMATTER_KEYS = [
  "title",
  "author",
  "authors",
  "translator",
  "translators",
  "raw_header",
] as const;
export type FrontmatterKey = (typeof FRONTMATTER_KEYS)[number];
export type PreviewFrontmatter =
  | { status: "valid"; fields: [FrontmatterKey, string][]; raw: string }
  | { status: "invalid" | "unclosed"; raw: string };
export const NOTICE_CODES = [
  "frontmatter-invalid",
  "frontmatter-unclosed",
  "image-not-loaded",
  "link-not-opened",
  "tcy-horizontal",
] as const;
export type PreviewNoticeCode = (typeof NOTICE_CODES)[number];
export interface PreviewModel {
  contract: typeof PREVIEW_CONTRACT;
  frontmatter: PreviewFrontmatter | null;
  body: PreviewBlock[];
  notices: PreviewNoticeCode[];
}
export type ModelLimit = "nodes" | "depth" | "text";
export class ModelLimitError extends Error {
  constructor(readonly reason: ModelLimit) {
    super(reason);
  }
}
/** Shared counting rule for the Worker builder and the main-thread validator. */
export class Budget {
  nodes = 0;
  text = 0;
  constructor(
    readonly limits: {
      nodes: number;
      depth: number;
      textUnits: number;
    } = PREVIEW_LIMITS,
  ) {}
  node(depth: number) {
    if (depth > this.limits.depth) throw new ModelLimitError("depth");
    if (++this.nodes > this.limits.nodes) throw new ModelLimitError("nodes");
  }
  chars(s: string) {
    this.text += s.length;
    if (this.text > this.limits.textUnits) throw new ModelLimitError("text");
  }
}

export type ValidationResult =
  | {
      ok: true;
      model: PreviewModel;
      nodes: number;
      text: number;
    }
  | { ok: false; kind: "limit"; reason: ModelLimit }
  | { ok: false; kind: "invalid" };

class ShapeError extends Error {}
const fail = (): never => {
  throw new ShapeError("shape");
};
function record(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    typeof v !== "object" ||
    v === null ||
    Array.isArray(v) ||
    Object.getPrototypeOf(v) !== Object.prototype
  )
    fail();
  const own = Reflect.ownKeys(v as object);
  if (
    own.length !== keys.length ||
    own.some((k) => typeof k !== "string" || !keys.includes(k))
  )
    fail();
  return v as Record<string, unknown>;
}
function list(v: unknown): unknown[] {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype) fail();
  return v as unknown[];
}
function str(v: unknown, budget: Budget): string {
  if (typeof v !== "string") fail();
  budget.chars(v as string);
  return v as string;
}
function kind(v: unknown): string {
  if (typeof v !== "object" || v === null) fail();
  const k = (v as { k?: unknown }).k;
  if (typeof k !== "string") fail();
  return k as string;
}
const level6 = (v: unknown) =>
  v === 1 || v === 2 || v === 3 || v === 4 || v === 5 || v === 6;

function inline(v: unknown, depth: number, b: Budget): PreviewInline {
  b.node(depth);
  switch (kind(v)) {
    case "text":
    case "code":
    case "tcy": {
      const r = record(v, ["k", "v"]);
      return { k: r.k, v: str(r.v, b) } as PreviewInline;
    }
    case "strong":
    case "em":
    case "u": {
      const r = record(v, ["k", "c"]);
      return {
        k: r.k as "strong",
        c: list(r.c).map((x) => inline(x, depth + 1, b)),
      };
    }
    case "ruby": {
      const r = record(v, ["k", "base", "rt"]);
      return { k: "ruby", base: str(r.base, b), rt: str(r.rt, b) };
    }
    case "link": {
      const r = record(v, ["k", "c", "url", "title"]);
      return {
        k: "link",
        c: list(r.c).map((x) => inline(x, depth + 1, b)),
        url: str(r.url, b),
        title: str(r.title, b),
      };
    }
    case "image": {
      const r = record(v, ["k", "alt", "url", "title"]);
      return {
        k: "image",
        alt: str(r.alt, b),
        url: str(r.url, b),
        title: str(r.title, b),
      };
    }
  }
  return fail();
}
function item(v: unknown, depth: number, b: Budget): PreviewListItem {
  b.node(depth);
  if (kind(v) !== "li") fail();
  const r = record(v, ["k", "c"]);
  return { k: "li", c: list(r.c).map((x) => block(x, depth + 1, b)) };
}
function block(v: unknown, depth: number, b: Budget): PreviewBlock {
  b.node(depth);
  switch (kind(v)) {
    case "p": {
      const r = record(v, ["k", "c"]);
      return { k: "p", c: list(r.c).map((x) => inline(x, depth + 1, b)) };
    }
    case "h": {
      const r = record(v, ["k", "level", "c"]);
      if (!level6(r.level)) fail();
      return {
        k: "h",
        level: r.level as HeadingLevel,
        c: list(r.c).map((x) => inline(x, depth + 1, b)),
      };
    }
    case "quote":
    case "align-end": {
      const r = record(v, ["k", "c"]);
      return {
        k: r.k as "quote",
        c: list(r.c).map((x) => block(x, depth + 1, b)),
      };
    }
    case "ul": {
      const r = record(v, ["k", "c"]);
      return { k: "ul", c: list(r.c).map((x) => item(x, depth + 1, b)) };
    }
    case "ol": {
      const r = record(v, ["k", "start", "c"]);
      if (
        typeof r.start !== "number" ||
        !Number.isInteger(r.start) ||
        r.start < 0 ||
        r.start > 999999999
      )
        fail();
      return {
        k: "ol",
        start: r.start as number,
        c: list(r.c).map((x) => item(x, depth + 1, b)),
      };
    }
    case "hr":
    case "page-break":
    case "blank-page":
      record(v, ["k"]);
      return { k: kind(v) } as PreviewBlock;
    case "pre": {
      const r = record(v, ["k", "info", "v"]);
      return { k: "pre", info: str(r.info, b), v: str(r.v, b) };
    }
    case "indent": {
      const r = record(v, ["k", "level", "c"]);
      if (!level6(r.level)) fail();
      return {
        k: "indent",
        level: r.level as IndentLevel,
        c: list(r.c).map((x) => block(x, depth + 1, b)),
      };
    }
  }
  return fail();
}
function frontmatter(v: unknown, b: Budget): PreviewFrontmatter | null {
  if (v === null) return null;
  const status = (v as { status?: unknown } | undefined)?.status;
  if (status === "valid") {
    const r = record(v, ["status", "fields", "raw"]);
    const fields = list(r.fields).map((f): [FrontmatterKey, string] => {
      b.node(1);
      const pair = list(f);
      if (
        pair.length !== 2 ||
        !(FRONTMATTER_KEYS as readonly unknown[]).includes(pair[0])
      )
        fail();
      return [pair[0] as FrontmatterKey, str(pair[1], b)];
    });
    return { status: "valid", fields, raw: str(r.raw, b) };
  }
  if (status === "invalid" || status === "unclosed") {
    const r = record(v, ["status", "raw"]);
    return { status, raw: str(r.raw, b) };
  }
  return fail();
}

/** Main-thread gate for Worker output. Only a structurally exact model passes. */
export function validateModel(
  value: unknown,
  limits = PREVIEW_LIMITS,
): ValidationResult {
  const b = new Budget(limits);
  try {
    const r = record(value, ["contract", "frontmatter", "body", "notices"]);
    if (r.contract !== PREVIEW_CONTRACT) fail();
    const fm = frontmatter(r.frontmatter, b);
    const body = list(r.body).map((x) => block(x, 1, b));
    const notices = list(r.notices).map((n) => {
      if (!(NOTICE_CODES as readonly unknown[]).includes(n)) fail();
      return n as PreviewNoticeCode;
    });
    if (new Set(notices).size !== notices.length) fail();
    return {
      ok: true,
      model: { contract: PREVIEW_CONTRACT, frontmatter: fm, body, notices },
      nodes: b.nodes,
      text: b.text,
    };
  } catch (e) {
    if (e instanceof ModelLimitError)
      return { ok: false, kind: "limit", reason: e.reason };
    return { ok: false, kind: "invalid" };
  }
}
