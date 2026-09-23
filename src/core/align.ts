import { TrackedText, copy } from "./trackedText.js";
import { LineWriter } from "./lineWriter.js";
import { pattern } from "./patterns.generated.js";
import {
  decimal,
  fullwidthDigits,
  strip,
  rstrip,
} from "./pythonStringCompat.js";
import type { Context } from "./types.js";
export interface AlignOptions {
  approximateJiage?: boolean;
  preserveNotes?: boolean;
  context?: Context;
}
export function alignStage(t: TrackedText, options: AlignOptions = {}) {
  const stats = { converted: 0, approximated: 0, unconverted: 0 },
    w = new LineWriter(t);
  let active: "jitsuki" | "jiage" | null = null,
    existing = false,
    passthrough = false;
  const close = () => {
    if (active !== null) {
      w.emit(":::");
      active = null;
    }
  };
  const open = (jiage: boolean) => {
    close();
    w.emit(":::align-end");
    active = jiage ? "jiage" : "jitsuki";
    if (jiage) stats.approximated++;
    else stats.converted++;
  };
  const count = (s: string) => {
    if (pattern("_JIAGE_NOTE_HINT_RE").test(s)) stats.unconverted++;
  };
  const emitInline = (
    i: number,
    prefix: string,
    note: string,
    body: string,
    jiage: boolean,
  ) => {
    const row = w.rows[i];
    if (strip(prefix))
      w.emit(copy(row.start, row.start + rstrip(prefix).length));
    if (options.preserveNotes) {
      const start = row.start + (strip(prefix) ? prefix.length : 0);
      const end = row.start + prefix.length + note.length;
      w.emit(t.preserved(start, end));
    }
    open(jiage);
    const start = row.start + prefix.length + note.length;
    w.emit(copy(start, start + body.replace(/\r+$/u, "").length));
    close();
  };
  for (let i = 0; i < w.rows.length; i++) {
    const row = w.rows[i],
      s = strip(row.text),
      ml = row.text.replace(/\r+$/u, "");
    if (w.boundary(i)) {
      close();
      w.original(i);
      continue;
    }
    if (passthrough) {
      w.original(i);
      if (pattern("_BLOCK_JIAGE_END_RE").test(ml)) passthrough = false;
      continue;
    }
    if (existing) {
      w.original(i);
      if (s === ":::") existing = false;
      continue;
    }
    if (
      active === null &&
      pattern("_EXISTING_NYOZE_DIRECTIVE_OPEN_RE").test(s)
    ) {
      existing = true;
      w.original(i);
      continue;
    }
    if (w.blocked(i)) {
      w.original(i);
      continue;
    }
    if (pattern("_BLOCK_JITSUKI_START_RE").test(ml)) {
      if (
        pattern("_EXISTING_NYOZE_ALIGN_END_RE").test(w.next(i)) ||
        active !== null
      ) {
        w.original(i);
        continue;
      }
      close();
      if (options.preserveNotes) w.preserved(i);
      open(false);
      continue;
    }
    if (pattern("_BLOCK_JITSUKI_END_RE").test(ml)) {
      if (active === "jitsuki") {
        close();
        if (options.preserveNotes) w.preserved(i);
      } else w.original(i);
      continue;
    }
    const block = pattern("_BLOCK_JIAGE_START_RE").exec(ml);
    if (block) {
      if (pattern("_EXISTING_NYOZE_ALIGN_END_RE").test(w.next(i))) {
        w.original(i);
        continue;
      }
      if (active !== null) {
        count(row.text);
        w.original(i);
        continue;
      }
      const n = decimal(fullwidthDigits(block.groups!.num));
      if (!options.approximateJiage || !(n >= 1)) {
        stats.unconverted++;
        w.original(i);
        passthrough = true;
        continue;
      }
      close();
      if (options.preserveNotes) w.preserved(i);
      open(true);
      continue;
    }
    if (pattern("_BLOCK_JIAGE_END_RE").test(ml)) {
      if (active === "jiage") {
        close();
        if (options.preserveNotes) w.preserved(i);
      } else w.original(i);
      continue;
    }
    const one = pattern("_INLINE_JITSUKI_RE").exec(ml);
    if (one) {
      const g = one.groups!;
      if (active !== null || !strip(g.body)) {
        count(row.text);
        w.original(i);
        continue;
      }
      if (
        [...ml.matchAll(pattern("_ALIGN_RELATED_NOTE_RE", true))].length > 1
      ) {
        stats.unconverted++;
        w.original(i);
        continue;
      }
      emitInline(i, g.prefix, "［＃地付き］", g.body, false);
      continue;
    }
    const jiage = pattern("_INLINE_JIAGE_RE").exec(ml);
    if (jiage) {
      const g = jiage.groups!,
        n = decimal(fullwidthDigits(g.num));
      if (
        active !== null ||
        !strip(g.body) ||
        [...ml.matchAll(pattern("_ALIGN_RELATED_NOTE_RE", true))].length > 1 ||
        !options.approximateJiage ||
        !(n >= 1)
      ) {
        stats.unconverted++;
        w.original(i);
        continue;
      }
      emitInline(i, g.prefix, `［＃地から${g.num}字上げ］`, g.body, true);
      continue;
    }
    count(row.text);
    w.original(i);
  }
  close();
  w.finish();
  return stats;
}
export function convertAlignEnd(text: string, options: AlignOptions = {}) {
  const t = new TrackedText(text, options.context);
  return t.result(alignStage(t, options));
}
