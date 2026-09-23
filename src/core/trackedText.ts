import type {
  Context,
  Diagnostic,
  Range,
  Region,
  StageResult,
} from "./types.js";
import {
  protectedRanges,
  intersects,
  type ProtectedRange,
} from "./protectedRanges.js";
export type Part =
  | string
  | { copy: [number, number] }
  | { text: string; regions: Region[]; origins?: Origin[] };
export interface Edit {
  start: number;
  end: number;
  parts: Part[];
}
interface Origin extends Range {
  sourceStart: number;
  sourceEnd: number;
}
export class TrackedText {
  text: string;
  regions: Region[] = [];
  diagnostics: Diagnostic[] = [];
  private origins: Origin[];
  private index: ProtectedRange[] | undefined;
  constructor(
    text: string,
    readonly context: Context = "markdown",
  ) {
    this.text = text;
    this.origins = [
      {
        startUtf16: 0,
        endUtf16: text.length,
        sourceStart: 0,
        sourceEnd: text.length,
      },
    ];
  }
  protected(): ProtectedRange[] {
    return (this.index ??= protectedRanges(this.text, this.context));
  }
  blocked(start: number, end: number): boolean {
    return intersects(this.protected(), start, end);
  }
  sourceRange(start: number, end: number): Range {
    const hit = this.origins.filter(
      (r) => r.startUtf16 < end && start < r.endUtf16,
    );
    if (!hit.length) return { startUtf16: start, endUtf16: end };
    const position = (r: Origin, p: number) =>
      r.sourceStart +
      (r.sourceEnd - r.sourceStart === r.endUtf16 - r.startUtf16
        ? Math.max(0, Math.min(p - r.startUtf16, r.endUtf16 - r.startUtf16))
        : 0);
    return {
      startUtf16: position(hit[0], start),
      endUtf16:
        hit.at(-1)!.sourceEnd -
        (hit.at(-1)!.sourceEnd - hit.at(-1)!.sourceStart ===
        hit.at(-1)!.endUtf16 - hit.at(-1)!.startUtf16
          ? Math.max(0, hit.at(-1)!.endUtf16 - end)
          : 0),
    };
  }
  occurrence(start: number, end: number): string {
    const r = this.sourceRange(start, end);
    return `source:${r.startUtf16}:${r.endUtf16}`;
  }
  diagnose(
    code: string,
    stage: string,
    start: number,
    end: number,
    details: Diagnostic["details"] = {},
  ): void {
    const range = this.sourceRange(start, end);
    const sourceOccurrenceId = this.occurrence(start, end);
    if (
      !this.diagnostics.some(
        (d) =>
          d.code === code &&
          d.stage === stage &&
          d.sourceOccurrenceId === sourceOccurrenceId,
      )
    )
      this.diagnostics.push({
        code,
        severity: "warning",
        stage,
        range,
        sourceOccurrenceId,
        details,
      });
  }
  preserved(start: number, end: number): Part {
    const text = this.text.slice(start, end);
    const regions: Region[] = [];
    for (const m of text.matchAll(/※?［＃[^］\r\n]*］/gu))
      regions.push({
        startUtf16: m.index!,
        endUtf16: m.index! + m[0].length,
        text: m[0],
        kind: "preserved-note",
        sourceOccurrenceId: this.occurrence(
          start + m.index!,
          start + m.index! + m[0].length,
        ),
      });
    return { text, regions };
  }
  /** Fold only complete markup regions generated in this call, never input syntax. */
  markupBase(start: number, end: number): string {
    let value = "",
      pos = start;
    const generated = this.regions
      .filter(
        (r) =>
          r.kind === "generated-markup" &&
          start <= r.startUtf16 &&
          r.endUtf16 <= end,
      )
      .sort((a, b) => a.startUtf16 - b.startUtf16 || b.endUtf16 - a.endUtf16);
    for (const r of generated) {
      if (r.startUtf16 < pos) continue;
      value += this.text.slice(pos, r.startUtf16) + (r.baseText ?? r.text);
      pos = r.endUtf16;
    }
    return value + this.text.slice(pos, end);
  }
  generated(text: string, baseText: string, start: number, end: number): Part {
    return {
      text,
      regions: [
        {
          startUtf16: 0,
          endUtf16: text.length,
          text,
          kind: "generated-markup",
          baseText,
          sourceOccurrenceId: this.occurrence(start, end),
        },
      ],
    };
  }
  /** All coordinates are in the pre-edit string. Copies explicitly retain provenance. */
  apply(edits: Edit[]): void {
    if (!edits.length) return;
    const sorted = [...edits].sort((a, b) => a.start - b.start);
    let prev = 0;
    const chunks: string[] = [];
    const regions: Region[] = [];
    const origins: Origin[] = [];
    let size = 0;
    const copy = (a: number, b: number) => {
      if (a === b) return;
      const target = size;
      chunks.push(this.text.slice(a, b));
      size += b - a;
      for (const r of this.regions)
        if (a <= r.startUtf16 && r.endUtf16 <= b)
          regions.push({
            ...r,
            startUtf16: target + r.startUtf16 - a,
            endUtf16: target + r.endUtf16 - a,
          });
      for (const r of this.origins) {
        const l = Math.max(a, r.startUtf16),
          h = Math.min(b, r.endUtf16);
        if (l < h) {
          const exact =
            r.sourceEnd - r.sourceStart === r.endUtf16 - r.startUtf16;
          origins.push({
            startUtf16: target + l - a,
            endUtf16: target + h - a,
            sourceStart: exact
              ? r.sourceStart + l - r.startUtf16
              : r.sourceStart,
            sourceEnd: exact ? r.sourceStart + h - r.startUtf16 : r.sourceEnd,
          });
        }
      }
    };
    for (const e of sorted) {
      if (
        e.start < prev ||
        e.start < 0 ||
        e.end < e.start ||
        e.end > this.text.length
      )
        throw new Error("Invalid or overlapping UTF-16 edit");
      copy(prev, e.start);
      const source = this.sourceRange(e.start, e.end);
      for (const p of e.parts) {
        if (typeof p !== "string" && "copy" in p) {
          copy(...p.copy);
          continue;
        }
        const s = typeof p === "string" ? p : p.text;
        const offset = size;
        chunks.push(s);
        size += s.length;
        if (typeof p !== "string" && p.origins) {
          for (const r of p.origins)
            origins.push({
              ...r,
              startUtf16: r.startUtf16 + offset,
              endUtf16: r.endUtf16 + offset,
            });
        } else if (s.length)
          origins.push({
            startUtf16: offset,
            endUtf16: size,
            sourceStart: source.startUtf16,
            sourceEnd: source.endUtf16,
          });
        if (typeof p !== "string")
          for (const r of p.regions)
            regions.push({
              ...r,
              startUtf16: offset + r.startUtf16,
              endUtf16: offset + r.endUtf16,
            });
      }
      prev = e.end;
    }
    copy(prev, this.text.length);
    this.text = chunks.join("");
    this.regions = regions;
    this.origins = origins;
    this.index = undefined;
  }
  fork(start: number, end: number): TrackedText {
    const child = new TrackedText(this.text.slice(start, end), this.context);
    child.regions = this.regions
      .filter((r) => start <= r.startUtf16 && r.endUtf16 <= end)
      .map((r) => ({
        ...r,
        startUtf16: r.startUtf16 - start,
        endUtf16: r.endUtf16 - start,
      }));
    child.origins = [];
    for (const r of this.origins) {
      const a = Math.max(start, r.startUtf16),
        b = Math.min(end, r.endUtf16);
      if (a < b) {
        const exact = r.sourceEnd - r.sourceStart === r.endUtf16 - r.startUtf16;
        child.origins.push({
          startUtf16: a - start,
          endUtf16: b - start,
          sourceStart: exact ? r.sourceStart + a - r.startUtf16 : r.sourceStart,
          sourceEnd: exact ? r.sourceStart + b - r.startUtf16 : r.sourceEnd,
        });
      }
    }
    return child;
  }
  fragment(): Part {
    return {
      text: this.text,
      regions: this.regions.map((r) => ({ ...r })),
      origins: this.origins.map((r) => ({ ...r })),
    };
  }
  result<S>(stats: S): StageResult<S> {
    return {
      text: this.text,
      stats,
      regions: this.regions.map((r) => ({ ...r })),
      diagnostics: this.diagnostics.map((d) => ({
        ...d,
        range: d.range ? { ...d.range } : undefined,
      })),
    };
  }
}
export const copy = (start: number, end: number): Part => ({
  copy: [start, end],
});
