import { TrackedText, type Edit } from "./trackedText.js";
import { pattern, type PatternName } from "./patterns.generated.js";
import {
  decimal,
  fullwidthDigits,
  strip,
  splitlines,
} from "./pythonStringCompat.js";
import { headingBase } from "./rubyContext.js";
import type { Context, HeadingLevels } from "./types.js";
import { DEFAULT_HEADING_LEVELS, normalizeOptions } from "./options.js";
const KINDS: Record<string, keyof HeadingLevels> = {
  大: "large",
  中: "medium",
  小: "small",
};
export function headingsStage(
  t: TrackedText,
  levels: Readonly<HeadingLevels> = DEFAULT_HEADING_LEVELS,
) {
  const stats = { converted: 0, unsupported: 0 };
  for (const name of [
    "_BLOCK_HEADING_RE",
    "_RANGE_HEADING_RE",
    "_FORWARD_HEADING_RE",
  ] as PatternName[]) {
    const edits: Edit[] = [];
    for (const m of t.text.matchAll(pattern(name, true))) {
      const a = m.index!,
        b = a + m[0].length,
        g = m.groups!;
      if (t.blocked(a, b)) continue;
      if (name === "_FORWARD_HEADING_RE") {
        // Group body starts after the optional indent, not at the first equal substring.
        const end = a + m[0].indexOf("［＃「"),
          start = end - g.body.length;
        const base = headingBase(t, start, end);
        if (
          !g.quoted ||
          base === null ||
          (strip(g.body) !== g.quoted && strip(base) !== g.quoted)
        ) {
          const noteStart = end;
          t.diagnose(
            "HEADING_TARGET_MISMATCH",
            "headings",
            noteStart,
            b - m[0].match(/[ \t　\r]*$/u)![0].length,
            { quoted: g.quoted, baseText: base ?? "" },
          );
          continue;
        }
      }
      const title = splitlines(g.body).map(strip).filter(Boolean).join(" ");
      if (!title) continue;
      const n = g.indent
        ? Math.max(0, Math.min(decimal(fullwidthDigits(g.indent)), 40))
        : 0;
      const marks = "#".repeat(levels[KINDS[g.level]]);
      stats.converted++;
      edits.push({
        start: a,
        end: b,
        parts: [`${marks} ${"　".repeat(n)}${title}`],
      });
    }
    t.apply(edits);
  }
  for (const m of t.text.matchAll(pattern("_UNSUPPORTED_HEADING_RE", true)))
    if (!t.blocked(m.index!, m.index! + m[0].length)) stats.unsupported++;
  return stats;
}
/** `levels` is validated and merged like `ConversionOptions.headingLevels`. */
export function convertHeadings(
  text: string,
  context: Context = "markdown",
  levels?: Partial<HeadingLevels>,
) {
  const merged = normalizeOptions({ headingLevels: levels }).headingLevels;
  const t = new TrackedText(text, context);
  return t.result(headingsStage(t, merged));
}
