import type { Range, Context } from "./types.js";
import { lines } from "./pythonStringCompat.js";
import { CST, Parser } from "yaml";
export interface ProtectedRange extends Range {
  kind: "fence" | "inline-code" | "frontmatter";
}
export interface Envelope extends Range {
  closed: boolean;
  contentStart: number;
  contentEnd: number;
}
export function frontmatterEnvelope(text: string): Envelope | null {
  const rows = lines(text);
  if (!/^[ \t]*---[ \t]*\r?$/u.test(rows[0].text)) return null;
  const contentStart = Math.min(rows[0].end + 1, text.length);
  // YAML owns block/quoted scalar contents before the whitespace-delimiter
  // extension is considered. Parse syntax only: no values, aliases or tags
  // are resolved here, and offsets still refer to the unchanged source.
  const scalarRanges: Range[] = [];
  for (const token of new Parser().parse(text.slice(contentStart))) {
    if (token.type !== "document") continue;
    CST.visit(token, ({ key, value }) => {
      for (const node of [key, value]) {
        if (
          node?.type !== "block-scalar" &&
          node?.type !== "single-quoted-scalar" &&
          node?.type !== "double-quoted-scalar"
        )
          continue;
        const start = contentStart + node.offset;
        const headerLength =
          node.type === "block-scalar"
            ? node.props.reduce(
                (n, prop) => n + ("source" in prop ? prop.source.length : 0),
                0,
              )
            : 0;
        scalarRanges.push({
          startUtf16: start,
          endUtf16: start + headerLength + node.source.length,
        });
      }
    });
    // A column-zero document marker ends this YAML document. Later Markdown
    // must not influence the envelope or require YAML parsing.
    break;
  }
  for (let i = 1; i < rows.length; i++)
    if (
      /^[ \t]*---[ \t]*\r?$/u.test(rows[i].text) &&
      !intersects(scalarRanges, rows[i].start, rows[i].end)
    )
      return {
        startUtf16: 0,
        endUtf16: rows[i].end,
        closed: true,
        contentStart,
        contentEnd: rows[i].start,
      };
  return {
    startUtf16: 0,
    endUtf16: text.length,
    closed: false,
    contentStart,
    contentEnd: text.length,
  };
}
export function protectedRanges(
  text: string,
  context: Context = "markdown",
): ProtectedRange[] {
  if (context === "text") return [];
  const out: ProtectedRange[] = [];
  const fm = frontmatterEnvelope(text);
  if (fm) out.push({ ...fm, kind: "frontmatter" });
  let fence: { char: string; length: number; start: number } | null = null;
  for (const row of lines(text)) {
    if (fm && row.start < fm.endUtf16) continue;
    const s = row.text.replace(/\r+$/u, "");
    if (fence) {
      const close = /^[ \t　]*(`{3,}|~{3,})[ \t　]*$/u.exec(s);
      if (
        close &&
        close[1][0] === fence.char &&
        close[1].length >= fence.length
      ) {
        out.push({ startUtf16: fence.start, endUtf16: row.end, kind: "fence" });
        fence = null;
      }
      continue;
    }
    const open = /^[ \t　]*(`{3,}|~{3,})/u.exec(s);
    if (open) {
      fence = { char: open[1][0], length: open[1].length, start: row.start };
      continue;
    }
    const runs = [...s.matchAll(/`+/gu)];
    for (let i = 0; i < runs.length; i++) {
      let j = i + 1;
      while (j < runs.length && runs[j][0].length !== runs[i][0].length) j++;
      if (j < runs.length) {
        out.push({
          startUtf16: row.start + runs[i].index!,
          endUtf16: row.start + runs[j].index! + runs[j][0].length,
          kind: "inline-code",
        });
        i = j;
      }
    }
  }
  if (fence)
    out.push({ startUtf16: fence.start, endUtf16: text.length, kind: "fence" });
  return out.sort((a, b) => a.startUtf16 - b.startUtf16);
}
export function intersects(
  ranges: readonly Range[],
  start: number,
  end: number,
): boolean {
  return ranges.some((r) => r.startUtf16 < end && start < r.endUtf16);
}
