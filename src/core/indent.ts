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
export function indentStage(t: TrackedText, preserve = false) {
  const stats = { converted: 0, unconverted: 0 },
    w = new LineWriter(t);
  let current: number | null = null,
    existing = false;
  const close = () => {
    if (current !== null) {
      w.emit(":::");
      current = null;
    }
  };
  const open = (n: number) => {
    close();
    w.emit(`:::indent-${n}`);
    current = n;
    stats.converted++;
  };
  for (let i = 0; i < w.rows.length; i++) {
    const row = w.rows[i],
      s = strip(row.text);
    if (w.boundary(i)) {
      close();
      w.original(i);
      continue;
    }
    if (existing) {
      w.original(i);
      if (s === ":::") existing = false;
      continue;
    }
    if (current === null && pattern("_EXISTING_NYOZE_INDENT_OPEN_RE").test(s)) {
      existing = true;
      w.original(i);
      continue;
    }
    if (w.blocked(i)) {
      w.original(i);
      continue;
    }
    const block = pattern("_BLOCK_INDENT_START_RE").exec(row.text);
    if (block) {
      if (pattern("_EXISTING_NYOZE_INDENT_OPEN_RE").test(w.next(i))) {
        w.original(i);
        continue;
      }
      const n = decimal(fullwidthDigits(block.groups!.num));
      if (n < 1 || n > 6 || !Number.isFinite(n)) {
        close();
        stats.unconverted++;
        w.original(i);
        continue;
      }
      close();
      if (preserve) w.preserved(i);
      open(n);
      continue;
    }
    if (pattern("_BLOCK_INDENT_END_RE").test(row.text)) {
      if (current !== null) {
        close();
        if (preserve) w.preserved(i);
      } else w.original(i);
      continue;
    }
    const one = pattern("_ONE_LINE_INDENT_RE").exec(row.text);
    if (one) {
      const g = one.groups!,
        body = g.body;
      if (!strip(body) || current !== null) {
        w.original(i);
        continue;
      }
      const n = decimal(fullwidthDigits(g.num));
      if (n < 1 || n > 6 || !Number.isFinite(n)) {
        stats.unconverted++;
        w.original(i);
        continue;
      }
      const bodyStart = row.end - body.length;
      if (preserve) {
        const length = rstrip(row.text.slice(0, bodyStart - row.start)).length;
        w.emit(t.preserved(row.start, row.start + length));
      }
      open(n);
      w.emit(copy(bodyStart, row.end));
      close();
      continue;
    }
    if (current === null && pattern("_INDENT_NOTE_HINT_RE").test(row.text))
      stats.unconverted++;
    w.original(i);
  }
  close();
  w.finish();
  return stats;
}
export function convertIndent(
  text: string,
  options: { preserveNotes?: boolean; context?: Context } = {},
) {
  const t = new TrackedText(text, options.context);
  return t.result(indentStage(t, options.preserveNotes));
}
