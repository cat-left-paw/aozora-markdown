import { TrackedText, copy, type Part } from "./trackedText.js";
import { lines, strip } from "./pythonStringCompat.js";
export class LineWriter {
  readonly rows;
  private out: Part[][] = [];
  constructor(readonly tracked: TrackedText) {
    this.rows = lines(tracked.text);
  }
  emit(...parts: Part[]): void {
    this.out.push(parts);
  }
  original(i: number): void {
    const r = this.rows[i];
    this.emit(copy(r.start, r.end));
  }
  preserved(i: number): void {
    const r = this.rows[i];
    this.emit(this.tracked.preserved(r.start, r.end));
  }
  next(i: number): string {
    for (let j = i + 1; j < this.rows.length; j++) {
      const s = strip(this.rows[j].text);
      if (s) return s;
    }
    return "";
  }
  boundary(i: number): boolean {
    const row = this.rows[i];
    return this.tracked
      .protected()
      .some(
        (r) =>
          r.kind !== "inline-code" &&
          r.startUtf16 <= row.start &&
          row.start < r.endUtf16,
      );
  }
  blocked(i: number): boolean {
    const r = this.rows[i];
    return this.tracked.blocked(r.start, r.end);
  }
  finish(): void {
    const parts: Part[] = [];
    for (let i = 0; i < this.out.length; i++) {
      if (i) parts.push("\n");
      parts.push(...this.out[i]);
    }
    this.tracked.apply([{ start: 0, end: this.tracked.text.length, parts }]);
  }
}
