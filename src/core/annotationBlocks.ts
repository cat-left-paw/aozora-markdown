import { TrackedText } from "./trackedText.js";
import { LineWriter } from "./lineWriter.js";
import type { Context } from "./types.js";
export const annotationDelimiter = (s: string) =>
  /^[ \t　]*-{5,}[ \t　]*$/u.test(s);
export function annotationBlocksStage(t: TrackedText): {
  removedBlocks: number;
} {
  const w = new LineWriter(t),
    indices: number[] = [];
  for (let i = 0; i < w.rows.length; i++)
    if (annotationDelimiter(w.rows[i].text) && !w.blocked(i)) indices.push(i);
  if (indices.length % 2) {
    const row = w.rows[indices.at(-1)!];
    t.diagnose(
      "UNCLOSED_ANNOTATION_BLOCK",
      "annotationBlocks",
      row.start,
      row.end,
    );
    return { removedBlocks: 0 };
  }
  const removed = new Set<number>();
  let removedBlocks = 0;
  for (let k = 0; k < indices.length; k += 2) {
    const a = indices[k],
      b = indices[k + 1];
    if (t.blocked(w.rows[a].start, w.rows[b].end)) continue;
    removedBlocks++;
    for (let i = a; i <= b; i++) removed.add(i);
  }
  if (removedBlocks) {
    for (let i = 0; i < w.rows.length; i++) if (!removed.has(i)) w.original(i);
    w.finish();
  }
  return { removedBlocks };
}
export function removeAnnotationBlocks(
  text: string,
  context: Context = "markdown",
) {
  const t = new TrackedText(text, context);
  return t.result(annotationBlocksStage(t));
}
