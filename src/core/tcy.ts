import { TrackedText, type Edit } from "./trackedText.js";
import { rubyContextUnsafe } from "./rubyContext.js";
import type { Context } from "./types.js";

/**
 * Postfix Aozora tate-chu-yoko → Nyoze `｟body｠`.
 * Body is 1–4 chars from `[A-Za-z0-9!?]`, the same constraint Nyoze documents
 * as `AOZORA_TCY_BODY_PATTERN`. This file does not import Nyoze source.
 */
export const TCY_OPEN = "\uFF5F";
export const TCY_CLOSE = "\uFF60";
const BODY = /^[A-Za-z0-9!?]{1,4}$/u;
const NOTE = /［＃「(?<quoted>[^」]*)」は縦中横］/gu;

export interface QuotedTarget {
  from: number;
  visible: string;
  /** The quoted characters, or the TCY base when `visible` is `｟base｠`. */
  base: string;
  kind: "literal" | "tcy";
}

function generatedTcySpans(t: TrackedText) {
  return t.regions.filter((r) => {
    if (r.kind !== "generated-markup" || r.baseText == null) return false;
    const text = TCY_OPEN + r.baseText + TCY_CLOSE;
    return (
      r.text === text &&
      r.endUtf16 - r.startUtf16 === text.length &&
      t.text.slice(r.startUtf16, r.endUtf16) === text
    );
  });
}

/** The range touches a TCY span generated in this call. */
export function overlapsGeneratedTcy(
  t: TrackedText,
  from: number,
  to: number,
): boolean {
  return generatedTcySpans(t).some(
    (r) => from < r.endUtf16 && to > r.startUtf16,
  );
}

/**
 * Well-formed `｟body｠` spans on the same line.
 * Body is the Nyoze pattern, so ordinary text and other markup are not spans.
 */
function tcyBracketSpans(
  text: string,
  from: number,
  to: number,
): { start: number; end: number }[] {
  const lineStart = text.lastIndexOf("\n", Math.max(from, 0) - 1) + 1;
  let lineEnd = text.indexOf("\n", to);
  if (lineEnd < 0) lineEnd = text.length;
  const spans: { start: number; end: number }[] = [];
  let i = lineStart;
  while (i < lineEnd) {
    const open = text.indexOf(TCY_OPEN, i);
    if (open < 0 || open >= lineEnd) break;
    const close = text.indexOf(TCY_CLOSE, open + 1);
    if (close < 0 || close >= lineEnd) break;
    const body = text.slice(open + TCY_OPEN.length, close);
    if (BODY.test(body)) {
      spans.push({ start: open, end: close + TCY_CLOSE.length });
      i = close + TCY_CLOSE.length;
    } else {
      // `｟X｟12｠` is not one span. The next opener may still begin `｟12｠`.
      i = open + TCY_OPEN.length;
    }
  }
  return spans;
}

/** The range touches a `｟body｠`, including a quote of that whole span. */
export function rangeHitsTcyBrackets(
  text: string,
  from: number,
  to: number,
): boolean {
  return tcyBracketSpans(text, from, to).some(
    (s) => from < s.end && to > s.start,
  );
}

/**
 * The quote overlaps a `｟body｠` without covering it.
 * `｠**` after `**｟12｠**`, and `｠` inside an input `｟12｠`, both cut the span.
 * A quote of the whole `｟body｠` does not.
 */
export function quoteCutsTcyBrackets(
  text: string,
  from: number,
  to: number,
): boolean {
  return tcyBracketSpans(text, from, to).some(
    (s) => from < s.end && to > s.start && !(from <= s.start && to >= s.end),
  );
}

/** The quote is a real suffix, but replacing it would cut a `｟body｠`. */
export function partialGeneratedTcyQuote(
  t: TrackedText,
  pos: number,
  noteStart: number,
  quoted: string,
): boolean {
  if (!quoted || !t.text.slice(pos, noteStart).endsWith(quoted)) return false;
  const from = noteStart - quoted.length;
  return (
    partialGeneratedTcyOverlap(t, from, noteStart) ||
    quoteCutsTcyBrackets(t.text, from, noteStart)
  );
}

/** A quote covers only part of a generated TCY span, so replacing it would split the brackets. */
function partialGeneratedTcyOverlap(
  t: TrackedText,
  from: number,
  to: number,
): boolean {
  return generatedTcySpans(t).some(
    (r) =>
      from < r.endUtf16 &&
      to > r.startUtf16 &&
      !(from === r.startUtf16 && to === r.endUtf16),
  );
}

/** One complete TCY span generated in this call, ending exactly at the note. */
export function generatedTcyBefore(
  t: TrackedText,
  noteStart: number,
  quoted: string,
): { start: number; text: string; base: string } | null {
  if (!quoted) return null;
  const text = TCY_OPEN + quoted + TCY_CLOSE;
  const hits = t.regions.filter(
    (r) =>
      r.kind === "generated-markup" &&
      r.baseText === quoted &&
      r.text === text &&
      r.endUtf16 === noteStart &&
      r.endUtf16 - r.startUtf16 === text.length &&
      t.text.slice(r.startUtf16, r.endUtf16) === text,
  );
  if (hits.length !== 1) return null;
  return { start: hits[0]!.startUtf16, text, base: quoted };
}

/**
 * Literal suffix, or a complete TCY region from this call.
 * Input `｟12｠` has no generated region, so it is not treated as a base.
 */
export function matchQuotedTarget(
  t: TrackedText,
  pos: number,
  noteStart: number,
  quoted: string,
): QuotedTarget | null {
  if (!quoted) return null;
  const prefix = t.text.slice(pos, noteStart);
  if (prefix.endsWith(quoted)) {
    const from = noteStart - quoted.length;
    // A suffix may be only `｠`, `2｠`, or `｠**` after an outer wrap.
    if (
      !partialGeneratedTcyOverlap(t, from, noteStart) &&
      !quoteCutsTcyBrackets(t.text, from, noteStart)
    )
      return {
        from,
        visible: quoted,
        base: quoted,
        kind: "literal",
      };
  }
  const tcy = generatedTcyBefore(t, noteStart, quoted);
  if (!tcy || tcy.start < pos) return null;
  return { from: tcy.start, visible: tcy.text, base: tcy.base, kind: "tcy" };
}

function lineStartAt(text: string, index: number): number {
  return text.lastIndexOf("\n", index - 1) + 1;
}

/** Target or note sits inside an input `｟…｠` on this line. Unclosed `｟` covers the rest. */
function insideInputTcy(
  text: string,
  targetStart: number,
  noteEnd: number,
): boolean {
  const lineStart = lineStartAt(text, targetStart);
  let lineEnd = text.indexOf("\n", noteEnd);
  if (lineEnd < 0) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  let i = 0;
  while (i < line.length) {
    const open = line.indexOf(TCY_OPEN, i);
    if (open < 0) return false;
    const close = line.indexOf(TCY_CLOSE, open + 1);
    const absOpen = lineStart + open;
    if (close < 0) return absOpen < targetStart && targetStart < lineEnd;
    const absClose = lineStart + close + 1;
    if (absOpen < targetStart && targetStart < absClose) return true;
    if (absOpen < noteEnd && noteEnd <= absClose && targetStart > absOpen)
      return true;
    i = close + 1;
  }
  return false;
}

function failureReason(
  text: string,
  noteStart: number,
  noteEnd: number,
  quoted: string,
): string | null {
  if (quoted.length === 0) return "empty";
  if (!BODY.test(quoted)) return "invalid-body";
  const before = text.slice(lineStartAt(text, noteStart), noteStart);
  if (before.endsWith(TCY_OPEN + quoted + TCY_CLOSE)) return "existing-tcy";
  if (!before.endsWith(quoted)) return "target-mismatch";
  const targetStart = noteStart - quoted.length;
  if (insideInputTcy(text, targetStart, noteEnd)) return "existing-tcy";
  if (rubyContextUnsafe(text, targetStart, noteStart, noteEnd))
    return "ruby-context";
  return null;
}

export function tcyStage(t: TrackedText) {
  const stats = { converted: 0, unconverted: 0 };
  const edits: Edit[] = [];
  for (const m of t.text.matchAll(NOTE)) {
    const noteStart = m.index!,
      noteEnd = noteStart + m[0].length,
      quoted = m.groups!.quoted ?? "";
    const targetStart =
      quoted.length > 0 && noteStart >= quoted.length
        ? noteStart - quoted.length
        : noteStart;
    // A span that touches protected text is kept and not counted.
    if (t.blocked(targetStart, noteEnd)) continue;
    const reason = failureReason(t.text, noteStart, noteEnd, quoted);
    if (reason) {
      stats.unconverted++;
      t.diagnose("TCY_NOT_CONVERTED", "tcy", noteStart, noteEnd, {
        reason,
        quoted,
      });
      continue;
    }
    const from = noteStart - quoted.length;
    stats.converted++;
    edits.push({
      start: from,
      end: noteEnd,
      parts: [
        t.generated(TCY_OPEN + quoted + TCY_CLOSE, quoted, from, noteEnd),
      ],
    });
  }
  t.apply(edits);
  return stats;
}

export function convertTcy(text: string, context: Context = "markdown") {
  const t = new TrackedText(text, context);
  return t.result(tcyStage(t));
}
