import { TrackedText, type Edit } from "./trackedText.js";
import { pattern } from "./patterns.generated.js";
import { isspace } from "./pythonStringCompat.js";
import { rubyContextUnsafe } from "./rubyContext.js";
import {
  generatedTcyBefore,
  overlapsGeneratedTcy,
  rangeHitsTcyBrackets,
} from "./tcy.js";
import type { Context } from "./types.js";
export function applyBouten(text: string, mark = "﹅"): string {
  const c = Array.from(mark)[0] ?? "﹅";
  return Array.from(text, (ch) => (isspace(ch) ? ch : `｜${ch}《${c}》`)).join(
    "",
  );
}
export function boutenStage(t: TrackedText, mark = "﹅") {
  const stats = { converted: 0, unconverted: 0 };
  let edits: Edit[] = [];
  for (const m of t.text.matchAll(pattern("_RANGE_BOUTEN_RE", true))) {
    const start = m.index!,
      end = start + m[0].length,
      body = m.groups!.body;
    if (t.blocked(start, end)) continue;
    const close = `［＃${m.groups!.kind}終わり］`;
    const bodyStart = end - close.length - body.length;
    const bodyEnd = end - close.length;
    // The same brackets a postfix note must not split. One range is one count.
    if (
      rangeHitsTcyBrackets(t.text, bodyStart, bodyEnd) ||
      overlapsGeneratedTcy(t, bodyStart, bodyEnd)
    ) {
      stats.unconverted++;
      t.diagnose("BOUTEN_NOT_CONVERTED", "bouten", start, end, {
        reason: "tcy-overlap",
      });
      continue;
    }
    const context = rubyContextUnsafe(t.text, start, end, end);
    if (/[\n\r｜《》]/u.test(body) || body.includes("［＃") || context) {
      stats.unconverted++;
      if (context) t.diagnose("BOUTEN_RUBY_CONTEXT", "bouten", start, end);
      continue;
    }
    const s = applyBouten(body, mark);
    if (s === body) {
      stats.unconverted++;
      continue;
    }
    stats.converted++;
    edits.push({ start, end, parts: [t.generated(s, body, start, end)] });
  }
  t.apply(edits);
  edits = [];
  let pos = 0;
  for (const m of t.text.matchAll(pattern("_FORWARD_BOUTEN_RE", true))) {
    const a = m.index!,
      b = a + m[0].length,
      q = m.groups!.quoted,
      has = !!q && t.text.slice(pos, a).endsWith(q),
      from = has ? a - q.length : a;
    if (!t.blocked(from, b)) {
      // Per-character ruby splits brackets inside `｟12｠`, `**｟12｠**`, and `｠**`.
      const tcy = !has && q ? generatedTcyBefore(t, a, q) : null;
      const overlap =
        (!!q &&
          has &&
          (overlapsGeneratedTcy(t, from, a) ||
            rangeHitsTcyBrackets(t.text, from, a))) ||
        (tcy != null && tcy.start >= pos);
      if (overlap) {
        const spanStart = tcy != null && tcy.start >= pos ? tcy.start : from;
        if (!t.blocked(spanStart, b)) {
          stats.unconverted++;
          t.diagnose("BOUTEN_NOT_CONVERTED", "bouten", a, b, {
            reason: "tcy-overlap",
          });
        }
      } else {
        const context = has && rubyContextUnsafe(t.text, from, a, b);
        if (!has || /[｜《》]/u.test(q) || context) {
          stats.unconverted++;
          if (context) t.diagnose("BOUTEN_RUBY_CONTEXT", "bouten", a, b);
        } else {
          stats.converted++;
          edits.push({
            start: from,
            end: b,
            parts: [t.generated(applyBouten(q, mark), q, from, b)],
          });
        }
      }
    }
    pos = b;
  }
  t.apply(edits);
  for (const m of t.text.matchAll(pattern("_LEFT_BOUTEN_NOTE_RE", true)))
    if (!t.blocked(m.index!, m.index! + m[0].length)) stats.unconverted++;
  return stats;
}
export function convertBouten(
  text: string,
  boutenChar = "﹅",
  context: Context = "markdown",
) {
  const t = new TrackedText(text, context);
  return t.result(boutenStage(t, boutenChar));
}
