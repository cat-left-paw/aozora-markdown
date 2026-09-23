import { PY_WS } from "../core/pythonStringCompat.js";
const trim = (s: string) =>
  s.replace(new RegExp(`^[.${PY_WS}]+|[.${PY_WS}]+$`, "gu"), "");
const reserved = (s: string) =>
  /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(s);
export function utf8Length(s: string): number {
  let n = 0;
  for (const c of s) {
    const cp = c.codePointAt(0)!;
    n += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
  }
  return n;
}
export interface FilenameOptions {
  maxCodePoints?: number;
  extension?: "md" | "txt";
  suffix?: string;
}
export function sanitizeFilename(
  name: string,
  options: FilenameOptions | number = {},
): string {
  const o = typeof options === "number" ? { maxCodePoints: options } : options;
  if (
    o.extension !== undefined &&
    o.extension !== "md" &&
    o.extension !== "txt"
  )
    throw new TypeError("Only md/txt output extensions are supported");
  const suffix = o.suffix ?? "";
  if (!/^(?:_converted[0-9]*)?$/u.test(suffix))
    throw new TypeError("Invalid collision suffix");
  const tail = suffix + (o.extension ? "." + o.extension : "");
  const max = Math.max(1, Math.min(100, o.maxCodePoints ?? 100)),
    budget = 240 - utf8Length(tail),
    countBudget = max - Array.from(tail).length;
  if (budget < 1 || countBudget < 1)
    throw new RangeError("Filename suffix exceeds budget");
  let base =
    trim(
      name
        .replace(/[\/\\:*?"<>|]/gu, "_")
        .replace(/[\x00-\x1f\x7f-\x9f]/gu, ""),
    ) || "untitled";
  if (reserved(base)) base = "_" + base;
  const cut = (value: string) => {
    let out = "",
      bytes = 0,
      count = 0;
    for (const ch of value) {
      const n = utf8Length(ch);
      if (bytes + n > budget || count === countBudget) break;
      out += ch;
      bytes += n;
      count++;
    }
    return trim(out);
  };
  base = cut(base) || cut("untitled");
  if (reserved(base)) base = cut("_" + base);
  if (!base) throw new RangeError("No valid filename fits budget");
  return base + tail;
}
export function collisionKey(path: string): string {
  return path
    .split("/")
    .map((s) =>
      s
        .normalize("NFC")
        .toLowerCase()
        .replace(/[ .]+$/gu, ""),
    )
    .join("/");
}
