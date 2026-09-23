import { TrackedText, copy } from "./trackedText.js";
import { lines, strip, fullwidthDigits } from "./pythonStringCompat.js";
import { pattern } from "./patterns.generated.js";
import { annotationDelimiter } from "./annotationBlocks.js";
import type { Context } from "./types.js";
const teihon = (s: string) => /^[ \t　]*底本[：:]/u.test(s);
const creation = (s: string) => /^[ \t　]*青空文庫作成ファイル[：:]/u.test(s);
const personnel = (s: string) => /^[ \t　]*(?:入力|校正)[：:]/u.test(s);
const quote = (s: string) => /^ {0,3}>/u.test(s);
function date(s: string): boolean {
  const m =
    /^[ \t　]*([0-9０-９]{4})年([0-9０-９]{1,2})月([0-9０-９]{1,2})日[ \t　]*(?:作成|修正)/u.exec(
      s,
    );
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map((x) => Number(fullwidthDigits(x)));
  if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return (
    d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
  );
}
export function footerStage(t: TrackedText): { removed: boolean } {
  const rows = lines(t.text),
    window = Math.max(0, rows.length - 400);
  let chosen: number | null = null,
    rejected: number | null = null;
  const usable = (i: number) =>
    !quote(rows[i].text) && !t.blocked(rows[i].start, rows[i].end);
  for (const predicate of [
    teihon,
    (s: string) =>
      pattern("_HONBUN_OWARI_LINE_RE").test(s.replace(/\r+$/u, "")),
  ]) {
    for (let i = window; i < rows.length; i++) {
      if (!predicate(rows[i].text)) continue;
      const rest = rows.slice(i);
      const old =
        rest.some((r) => creation(r.text)) &&
        rest.some(
          (r) =>
            personnel(r.text) || pattern("_AOZORA_FOOTER_DATE_RE").test(r.text),
        );
      if (!old) continue;
      const safe =
        usable(i) &&
        !t.blocked(rows[i].start, t.text.length) &&
        !rest.some((r) => annotationDelimiter(r.text)) &&
        rest.some((r, j) => usable(i + j) && creation(r.text)) &&
        rest.some(
          (r, j) => usable(i + j) && (personnel(r.text) || date(r.text)),
        );
      if (safe) chosen = i;
      else rejected = i;
    }
    if (chosen !== null) break;
  }
  if (chosen === null) {
    if (rejected !== null) {
      const row = rows[rejected];
      t.diagnose("FOOTER_CANDIDATE_PRESERVED", "footer", row.start, row.end);
    }
    return { removed: false };
  }
  let n = chosen;
  while (n > 0 && !strip(rows[n - 1].text)) n--;
  const end = n ? rows[n - 1].end : 0;
  t.apply([
    { start: 0, end: t.text.length, parts: end ? [copy(0, end), "\n"] : [] },
  ]);
  return { removed: true };
}
export function removeAozoraFooter(
  text: string,
  context: Context = "markdown",
) {
  const t = new TrackedText(text, context);
  return t.result(footerStage(t));
}
