import { TrackedText, copy, type Edit, type Part } from "./trackedText.js";
import { pattern, type PatternName } from "./patterns.generated.js";
import { lines, strip } from "./pythonStringCompat.js";
import { matchQuotedTarget } from "./tcy.js";
import type { Context } from "./types.js";
const wrap = (s: string, b: boolean, i: boolean) =>
  !s || s.includes("*")
    ? null
    : `${b ? (i ? "***" : "**") : "*"}${s}${b ? (i ? "***" : "**") : "*"}`;
function inline(t: TrackedText) {
  const stats = { bold: 0, italic: 0, both: 0, unconverted: 0 };
  let edits: Edit[] = [];
  let pos = 0;
  for (const m of t.text.matchAll(pattern("_FORWARD_EMPHASIS_BOTH_RE", true))) {
    const g = m.groups!,
      start = m.index!,
      end = start + m[0].length,
      q = g.q1;
    const complementary = q === g.q2 && (g.k1 === "太字") !== (g.k2 === "太字");
    // Literal suffix, or a complete TCY region generated earlier in this call.
    const hit = complementary ? matchQuotedTarget(t, pos, start, q) : null;
    const from = hit ? hit.from : start;
    if (complementary && !t.blocked(from, end)) {
      const s = hit ? wrap(hit.visible, true, true) : null;
      if (s !== null) {
        edits.push({
          start: from,
          end,
          parts: [t.generated(s, hit!.base, from, end)],
        });
        stats.both++;
      }
      // R12: one pass owns individual failures; a failed both pass adds no third count.
    }
    pos = end;
  }
  t.apply(edits);
  edits = [];
  pos = 0;
  for (const m of t.text.matchAll(pattern("_FORWARD_EMPHASIS_ONE_RE", true))) {
    const g = m.groups!,
      start = m.index!,
      end = start + m[0].length,
      q = g.quoted;
    const hit = matchQuotedTarget(t, pos, start, q),
      from = hit ? hit.from : start;
    if (!t.blocked(from, end)) {
      const s = hit
        ? wrap(hit.visible, g.kind === "太字", g.kind !== "太字")
        : null;
      if (s !== null) {
        edits.push({
          start: from,
          end,
          parts: [t.generated(s, hit!.base, from, end)],
        });
        if (g.kind === "太字") stats.bold++;
        else stats.italic++;
      } else {
        stats.unconverted++;
        t.diagnose("EMPHASIS_NOT_CONVERTED", "emphasis", start, end, {
          reason: hit ? "asterisk" : "target-mismatch",
        });
      }
    }
    pos = end;
  }
  t.apply(edits);
  const passes: [PatternName, boolean, boolean][] = [
    ["_INLINE_EMPHASIS_NESTED_RE", true, true],
    ["_INLINE_BOLD_RE", true, false],
    ["_INLINE_ITALIC_RE", false, true],
  ];
  for (const [name, b, i] of passes) {
    edits = [];
    for (const m of t.text.matchAll(pattern(name, true))) {
      const start = m.index!,
        end = start + m[0].length;
      if (t.blocked(start, end)) continue;
      const nested = b && i,
        body = nested ? m.groups!.body : m[1];
      if (
        nested
          ? m.groups!.outer === m.groups!.inner
          : body.includes("［＃") || /[\n\r]/u.test(body)
      )
        continue;
      const s = wrap(body, b, i);
      if (s === null) continue;
      edits.push({ start, end, parts: [t.generated(s, body, start, end)] });
      if (nested) stats.both++;
      else if (b) stats.bold++;
      else stats.italic++;
    }
    t.apply(edits);
  }
  for (const m of t.text.matchAll(
    pattern("_LEFTOVER_INLINE_EMPHASIS_OPEN_RE", true),
  ))
    if (!t.blocked(m.index!, m.index! + m[0].length)) {
      stats.unconverted++;
      t.diagnose(
        "EMPHASIS_NOT_CONVERTED",
        "emphasis",
        m.index!,
        m.index! + m[0].length,
        { reason: "unsupported-range" },
      );
    }
  return stats;
}
export function emphasisStage(t: TrackedText) {
  const stats = { bold: 0, italic: 0, both: 0, unconverted: 0 };
  const rows = lines(t.text),
    edits: Edit[] = [];
  let removeLastSeparator = false;
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
    const start = pattern("_BLOCK_EMPHASIS_START_RE").exec(
      row.text.replace(/\r+$/u, ""),
    );
    if (start && !t.blocked(row.start, row.end)) {
      const kind = start.groups!.kind;
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
        const end = pattern("_BLOCK_EMPHASIS_END_RE").exec(
          rows[j].text.replace(/\r+$/u, ""),
        );
        if (end) {
          found = end.groups!.kind === kind;
          break;
        }
      }
      const inner = rows.slice(i + 1, j);
      const unsafe =
        !found ||
        inner.some(
          (r) =>
            r.text.includes("［＃") ||
            (strip(r.text) !== "" && r.text.includes("*")),
        ) ||
        t.blocked(row.start, found ? rows[j].end : row.end);
      if (unsafe) {
        stats.unconverted++;
        t.diagnose("EMPHASIS_NOT_CONVERTED", "emphasis", row.start, row.end, {
          reason: "unsupported-block",
        });
        if (found) i = j;
        continue;
      }
      if (!inner.length && j === rows.length - 1) removeLastSeparator = true;
      const parts: Part[] = [];
      for (let k = 0; k < inner.length; k++) {
        if (k) parts.push("\n");
        const r = inner[k];
        parts.push(
          strip(r.text) === ""
            ? copy(r.start, r.end)
            : t.generated(
                wrap(r.text, kind === "太字", kind !== "太字")!,
                r.text,
                r.start,
                r.end,
              ),
        );
      }
      // Removing an empty block removes both whole lines including the following separator.
      const end = rows[j].end + (j < rows.length - 1 ? 1 : 0);
      if (inner.length && j < rows.length - 1) parts.push("\n");
      edits.push({ start: row.start, end, parts });
      if (kind === "太字") stats.bold++;
      else stats.italic++;
      i = j;
      continue;
    }
    const child = t.fork(row.start, row.end),
      s = inline(child);
    for (const k of ["bold", "italic", "both", "unconverted"] as const)
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
export function convertEmphasis(text: string, context: Context = "markdown") {
  const t = new TrackedText(text, context);
  return t.result(emphasisStage(t));
}
