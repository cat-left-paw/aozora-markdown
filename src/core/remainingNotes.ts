import type { Context, Region, RemainingNote } from "./types.js";
import { protectedRanges, intersects } from "./protectedRanges.js";
import { lines } from "./pythonStringCompat.js";
export function scanRemainingNotes(
  text: string,
  options: { context?: Context; preservedNotes?: readonly Region[] } = {},
): RemainingNote[] {
  const protect = protectedRanges(text, options.context),
    found: RemainingNote[] = [];
  const preserved = (options.preservedNotes ?? []).filter(
    (r) =>
      r.kind === "preserved-note" &&
      text.slice(r.startUtf16, r.endUtf16) === r.text,
  );
  for (const [i, row] of lines(text).entries())
    for (const m of row.text.matchAll(/※?［＃[^］\r\n]*］/gu)) {
      const a = row.start + m.index!,
        b = a + m[0].length;
      if (
        intersects(protect, a, b) ||
        preserved.some((r) => r.startUtf16 === a && r.endUtf16 === b)
      )
        continue;
      found.push({ line: i + 1, text: m[0] });
    }
  return found;
}
export function formatRemainingNoteLogLines(
  filename: string,
  notes: readonly RemainingNote[],
): string[] {
  if (!notes.length) return [];
  const result = [
      `[WARN] 未変換の青空文庫注記: ${notes.length}件 — ${filename}`,
    ],
    groups = new Map<string, number[]>();
  for (const n of notes) {
    if (!groups.has(n.text)) groups.set(n.text, []);
    groups.get(n.text)!.push(n.line);
  }
  for (const [s, positions] of [...groups].slice(0, 50))
    result.push(
      `    ${positions.length}件  ${s}  (行 ${positions.slice(0, 3).join(", ")}${positions.length > 3 ? ", ..." : ""})`,
    );
  if (groups.size > 50) result.push(`    ... 他 ${groups.size - 50}種類`);
  return result;
}
