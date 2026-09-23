import { TrackedText } from "./trackedText.js";
/** Bounded, single-line context check. A closed, unrelated preceding ruby is harmless. */
export function rubyContextUnsafe(
  text: string,
  start: number,
  end: number,
  noteEnd: number,
): boolean {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = text.indexOf("\n", noteEnd);
  if (lineEnd < 0) lineEnd = text.length;
  const before = text.slice(lineStart, start);
  const lastBar = before.lastIndexOf("｜"),
    lastOpen = before.lastIndexOf("《"),
    lastClose = before.lastIndexOf("》");
  if (lastOpen > lastClose || lastBar > lastClose) return true;
  const after = text
    .slice(noteEnd, lineEnd)
    .replace(/^(?:※?［＃[^］\r\n]*］)*/u, "");
  if (after.startsWith("《")) return true;
  for (const m of text
    .slice(lineStart, lineEnd)
    .matchAll(/｜[^｜《》\n]*《[^《》\n]*》/gu)) {
    const a = lineStart + m.index!,
      b = a + m[0].length;
    if (a < end && start < b) return true;
  }
  return false;
}
/** Only unambiguous Aozora ruby and markup generated in THIS call have a base. */
export function headingBase(
  t: TrackedText,
  start: number,
  end: number,
): string | null {
  let value = t.markupBase(start, end);
  // Explicit ruby, then the conservative kanji-only implicit form.
  value = value.replace(
    /｜([^｜《》\n]+)《[^｜《》\n]*》/gu,
    (_, base: string) => base,
  );
  value = value.replace(
    /([\p{Script=Han}々〆ヵヶ]+)《[^｜《》\n]*》/gu,
    (_, base: string) => base,
  );
  return /[｜《》]/u.test(value) ? null : value;
}
