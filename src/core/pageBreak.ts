import { TrackedText } from "./trackedText.js";
import { LineWriter } from "./lineWriter.js";
import { pattern } from "./patterns.generated.js";
import { strip } from "./pythonStringCompat.js";
import type { Context } from "./types.js";
export interface PageOptions {
  approximateSpreadBreaks?: boolean;
  preserveNotes?: boolean;
  context?: Context;
}
export function pageBreakStage(t: TrackedText, options: PageOptions = {}) {
  const stats = {
      pageBreaks: 0,
      blankPages: 0,
      spreadApproximated: 0,
      unconverted: 0,
      kaidanUnconverted: 0,
    },
    w = new LineWriter(t);
  let existing = false;
  const ml = (i: number) => w.rows[i].text.replace(/\r+$/u, "");
  const emit = (blank = false, spread = false) => {
    w.emit(blank ? ":::blank-page" : ":::page-break");
    w.emit(":::");
    if (blank) stats.blankPages++;
    else if (spread) stats.spreadApproximated++;
    else stats.pageBreaks++;
  };
  for (let i = 0; i < w.rows.length; i++) {
    const row = w.rows[i],
      s = strip(row.text);
    if (w.boundary(i)) {
      w.original(i);
      continue;
    }
    if (existing) {
      w.original(i);
      if (s === ":::") existing = false;
      continue;
    }
    if (pattern("_EXISTING_NYOZE_DIRECTIVE_OPEN_RE").test(s)) {
      existing = true;
      w.original(i);
      continue;
    }
    if (w.blocked(i)) {
      w.original(i);
      continue;
    }
    if (pattern("_PAGE_BREAK_LINE_RE").test(ml(i))) {
      let k = i + 1,
        saw = false;
      while (k < w.rows.length && !strip(w.rows[k].text)) {
        saw = true;
        k++;
      }
      if (
        saw &&
        k < w.rows.length &&
        pattern("_PAGE_BREAK_LINE_RE").test(ml(k)) &&
        !t.blocked(row.start, w.rows[k].end)
      ) {
        if (pattern("_EXISTING_NYOZE_BLANK_PAGE_RE").test(w.next(k))) {
          for (let j = i; j <= k; j++) w.original(j);
          i = k;
          continue;
        }
        if (options.preserveNotes) for (let j = i; j <= k; j++) w.preserved(j);
        emit(true);
        i = k;
        continue;
      }
      if (pattern("_EXISTING_NYOZE_PAGE_BREAK_RE").test(w.next(i))) {
        w.original(i);
        continue;
      }
      if (options.preserveNotes) w.preserved(i);
      emit();
      continue;
    }
    if (
      pattern("_KAICHO_LINE_RE").test(ml(i)) ||
      pattern("_KAIHIRAKI_LINE_RE").test(ml(i))
    ) {
      if (pattern("_EXISTING_NYOZE_PAGE_BREAK_RE").test(w.next(i))) {
        w.original(i);
        continue;
      }
      if (!options.approximateSpreadBreaks) {
        stats.unconverted++;
        w.original(i);
        continue;
      }
      if (options.preserveNotes) w.preserved(i);
      emit(false, true);
      continue;
    }
    if (pattern("_KAIDAN_HINT_RE").test(row.text)) stats.kaidanUnconverted++;
    else if (pattern("_PAGE_NOTE_HINT_RE").test(row.text)) stats.unconverted++;
    w.original(i);
  }
  w.finish();
  return stats;
}
export function convertPageBreaks(text: string, options: PageOptions = {}) {
  const t = new TrackedText(text, options.context);
  return t.result(pageBreakStage(t, options));
}
