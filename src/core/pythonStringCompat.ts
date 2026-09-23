import { decimalValues } from "../data/pythonUnicode.generated.js";
// CPython 3.12 Unicode 15.0 isspace; notably includes 001C..001F, excludes FEFF.
export const PY_WS =
  "\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
export function strip(s: string): string {
  return s.replace(new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "gu"), "");
}
export function rstrip(s: string): string {
  return s.replace(new RegExp(`[${PY_WS}]+$`, "u"), "");
}
export function isspace(s: string): boolean {
  return s.length > 0 && new RegExp(`^[${PY_WS}]+$`, "u").test(s);
}
export function splitlines(s: string): string[] {
  if (!s) return [];
  const rows = s.split(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/u);
  if (/[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]$/u.test(s)) rows.pop();
  return rows;
}
export function fullwidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10));
}
export function decimal(s: string): number {
  if (Array.from(s).length > 4300) return NaN; // CPython default int string conversion limit
  let n = 0;
  for (const c of s) {
    const v = decimalValues[c.codePointAt(0)!];
    if (v === undefined) return NaN;
    n = Math.min(Number.MAX_SAFE_INTEGER, n * 10 + v);
  }
  return s ? n : NaN;
}
export function lines(
  s: string,
): { text: string; start: number; end: number }[] {
  let offset = 0;
  return s.split("\n").map((text) => {
    const r = { text, start: offset, end: offset + text.length };
    offset += text.length + 1;
    return r;
  });
}
