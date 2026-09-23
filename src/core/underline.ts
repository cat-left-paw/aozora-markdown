import { TrackedText, copy, type Edit, type Part } from "./trackedText.js";
import { pattern } from "./patterns.generated.js";
import { lines, strip } from "./pythonStringCompat.js";
import { matchQuotedTarget, partialGeneratedTcyQuote } from "./tcy.js";
import type { Context } from "./types.js";
export interface UnderlineOptions {
  outputFormat?: string;
  approximateOtherStyles?: boolean;
  approximateLeft?: boolean;
  context?: Context;
}
function kind(
  head: string,
  options: UnderlineOptions,
): "converted" | "approximated" | null {
  const left = head.startsWith("左に");
  const style = left ? head.slice(2) : head;
  if (style === "傍線")
    return left
      ? options.approximateLeft
        ? "approximated"
        : null
      : "converted";
  return options.approximateOtherStyles && (!left || options.approximateLeft)
    ? "approximated"
    : null;
}
function wrap(s: string, format: string): string | null {
  if (!s) return null;
  return format === "html"
    ? s.toLowerCase().includes("<u>") || s.toLowerCase().includes("</u>")
      ? null
      : `<u>${s}</u>`
    : s.includes("||")
      ? null
      : `||${s}||`;
}
function inside(before: string, after: string): boolean {
  return (
    (before.endsWith("||") && after.startsWith("||")) ||
    (before.toLowerCase().endsWith("<u>") &&
      after.toLowerCase().startsWith("</u>"))
  );
}
function inline(t: TrackedText, options: UnderlineOptions) {
  const stats = { converted: 0, approximated: 0, unconverted: 0 };
  const format = options.outputFormat === "html" ? "html" : "nyoze";
  let edits: Edit[] = [],
    pos = 0;
  for (const m of t.text.matchAll(pattern("_FORWARD_UNDERLINE_RE", true))) {
    const g = m.groups!,
      a = m.index!,
      b = a + m[0].length,
      q = g.quoted,
      prefix = t.text.slice(pos, a),
      hit = matchQuotedTarget(t, pos, a, q),
      from = hit ? hit.from : a;
    const k = kind((g.left ? "左に" : "") + g.style, options);
    const before =
      hit?.kind === "literal"
        ? prefix.slice(0, -q.length)
        : hit
          ? t.text.slice(pos, hit.from)
          : "";
    if (!t.blocked(from, b) && k && hit && !inside(before, t.text.slice(b))) {
      const s = wrap(hit.visible, format);
      if (s !== null) {
        stats[k]++;
        edits.push({
          start: from,
          end: b,
          parts: [
            t.generated(
              s,
              hit.kind === "literal" ? t.markupBase(from, a) : hit.base,
              from,
              b,
            ),
          ],
        });
      }
    } else if (
      k &&
      !hit &&
      !t.blocked(a, b) &&
      partialGeneratedTcyQuote(t, pos, a, q)
    ) {
      // Leftover scan counts the kept note. This records why it was not a target.
      t.diagnose("UNDERLINE_NOT_CONVERTED", "underline", a, b, {
        reason: "target-mismatch",
      });
    }
    pos = b;
  }
  t.apply(edits);
  edits = [];
  for (const m of t.text.matchAll(pattern("_INLINE_UNDERLINE_RE", true))) {
    const g = m.groups!,
      a = m.index!,
      b = a + m[0].length,
      k = kind(g.head, options),
      body = g.body;
    if (
      t.blocked(a, b) ||
      !k ||
      body.includes("［＃") ||
      /[\n\r]/u.test(body) ||
      inside(t.text.slice(0, a), t.text.slice(b))
    )
      continue;
    const s = wrap(body, format);
    if (s === null) continue;
    stats[k]++;
    const bodyStart = a + m[0].indexOf("］") + 1;
    edits.push({
      start: a,
      end: b,
      parts: [
        t.generated(s, t.markupBase(bodyStart, bodyStart + body.length), a, b),
      ],
    });
  }
  t.apply(edits);
  for (const m of t.text.matchAll(pattern("_LEFTOVER_UNDERLINE_NOTE_RE", true)))
    if (!t.blocked(m.index!, m.index! + m[0].length)) stats.unconverted++;
  return stats;
}
export function underlineStage(t: TrackedText, options: UnderlineOptions = {}) {
  const stats = { converted: 0, approximated: 0, unconverted: 0 },
    rows = lines(t.text),
    edits: Edit[] = [];
  let removeLastSeparator = false;
  const format = options.outputFormat === "html" ? "html" : "nyoze";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (
      t
        .protected()
        .some(
          (r) =>
            r.kind !== "inline-code" &&
            r.startUtf16 <= row.start &&
            row.start < r.endUtf16,
        )
    )
      continue;
    const start = pattern("_BLOCK_UNDERLINE_START_RE").exec(
      row.text.replace(/\r+$/u, ""),
    );
    if (start && !t.blocked(row.start, row.end)) {
      const head = start.groups!.head,
        k = kind(head, options);
      let j = i + 1,
        found = false;
      for (; j < rows.length; j++) {
        if (
          t
            .protected()
            .some(
              (r) =>
                r.kind !== "inline-code" &&
                r.startUtf16 <= rows[j].start &&
                rows[j].start < r.endUtf16,
            )
        )
          break;
        const end = pattern("_BLOCK_UNDERLINE_END_RE").exec(
          rows[j].text.replace(/\r+$/u, ""),
        );
        if (end) {
          found = end.groups!.head === head;
          break;
        }
      }
      const inner = rows.slice(i + 1, j);
      if (
        !k ||
        !found ||
        inner.some(
          (r) =>
            r.text.includes("［＃") ||
            (strip(r.text) !== "" && wrap(r.text, format) === null),
        ) ||
        t.blocked(row.start, found ? rows[j].end : row.end)
      ) {
        stats.unconverted++;
        if (found) i = j;
        continue;
      }
      if (!inner.length && j === rows.length - 1) removeLastSeparator = true;
      const parts: Part[] = [];
      for (let n = 0; n < inner.length; n++) {
        if (n) parts.push("\n");
        const r = inner[n];
        parts.push(
          strip(r.text) === ""
            ? copy(r.start, r.end)
            : t.generated(
                wrap(r.text, format)!,
                t.markupBase(r.start, r.end),
                r.start,
                r.end,
              ),
        );
      }
      if (inner.length && j < rows.length - 1) parts.push("\n");
      edits.push({
        start: row.start,
        end: rows[j].end + (j < rows.length - 1 ? 1 : 0),
        parts,
      });
      stats[k]++;
      i = j;
      continue;
    }
    const child = t.fork(row.start, row.end),
      s = inline(child, options);
    for (const k of ["converted", "approximated", "unconverted"] as const)
      stats[k] += s[k];
    t.diagnostics.push(...child.diagnostics);
    if (child.text !== row.text)
      edits.push({ start: row.start, end: row.end, parts: [child.fragment()] });
  }
  t.apply(edits);
  if (removeLastSeparator && t.text.endsWith("\n"))
    t.apply([{ start: t.text.length - 1, end: t.text.length, parts: [] }]);
  return stats;
}
export function convertUnderline(text: string, options: UnderlineOptions = {}) {
  const t = new TrackedText(text, options.context);
  return t.result(underlineStage(t, options));
}
