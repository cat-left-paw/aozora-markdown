import { JIS } from "../data/jisPython312.generated.js";
import { pattern } from "./patterns.generated.js";
import { decimal, fullwidthDigits } from "./pythonStringCompat.js";
import { TrackedText, type Edit } from "./trackedText.js";
import type { Context } from "./types.js";
export function jis0213ToUnicode(
  plane: number,
  row: number,
  cell: number,
): string | null {
  if (
    ![plane, row, cell].every(Number.isInteger) ||
    (plane !== 1 && plane !== 2) ||
    row < 1 ||
    row > 94 ||
    cell < 1 ||
    cell > 94
  )
    return null;
  return JIS[(plane - 1) * 8836 + (row - 1) * 94 + cell - 1];
}
function inner(text: string): { recognized: boolean; value: string | null } {
  const s = fullwidthDigits(text);
  const u = pattern("_UPLUS_RE").exec(s);
  if (u) {
    const n = parseInt(u[1], 16);
    if (
      n >= 32 &&
      n !== 127 &&
      !(n >= 128 && n <= 159) &&
      !(n >= 0xd800 && n <= 0xdfff) &&
      n <= 0x10ffff
    )
      return { recognized: true, value: String.fromCodePoint(n) };
  }
  const j =
    pattern("_JIS0213_MENKUTEN_RE").exec(s) ??
    pattern("_JIS0213_ANY_MENKUTEN_RE").exec(s);
  return {
    recognized: !!(u || j),
    value: j
      ? jis0213ToUnicode(
          decimal(j.groups!.plane),
          decimal(j.groups!.row),
          decimal(j.groups!.cell),
        )
      : null,
  };
}
export function gaijiStage(t: TrackedText) {
  const stats = { converted: 0, unconverted: 0 };
  let edits: Edit[] = [];
  let pos = 0;
  for (const m of t.text.matchAll(pattern("_SUBSTITUTE_GAIJI_NOTE_RE", true))) {
    const x = inner(m.groups!.inner);
    if (!x.recognized) continue;
    const start = m.index!,
      end = start + m[0].length,
      q = m.groups!.quoted;
    const has = t.text.slice(pos, start).endsWith(q);
    const from = has ? start - q.length : start;
    if (!t.blocked(from, end)) {
      if (x.value !== null && has) {
        edits.push({ start: from, end, parts: [x.value] });
        stats.converted++;
      } else stats.unconverted++;
    }
    pos = end;
  }
  t.apply(edits);
  edits = [];
  for (const m of t.text.matchAll(pattern("_GAIJI_NOTE_RE", true))) {
    const start = m.index!,
      end = start + m[0].length;
    if (t.blocked(start, end)) continue;
    const x = inner(m[1]);
    if (x.value === null) stats.unconverted++;
    else {
      edits.push({ start, end, parts: [x.value] });
      stats.converted++;
    }
  }
  t.apply(edits);
  return stats;
}
export function convertGaiji(text: string, context: Context = "markdown") {
  const t = new TrackedText(text, context);
  return t.result(gaijiStage(t));
}
