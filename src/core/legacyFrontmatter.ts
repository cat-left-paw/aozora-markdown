import { strip } from "./pythonStringCompat.js";
export function parseLegacyFrontmatter(
  text: string,
): Record<string, string | string[]> | null {
  const rows = text.split("\n");
  if (strip(rows[0]) !== "---") return null;
  const end = rows.findIndex((r, i) => i > 0 && strip(r) === "---");
  if (end < 0) return null;
  const result: Record<string, string | string[]> = Object.create(null);
  for (let i = 1; i < end; i++) {
    const row = rows[i];
    if (!row.includes(":") || row.startsWith(" ")) continue;
    const j = row.indexOf(":"),
      key = strip(row.slice(0, j)),
      value = strip(row.slice(j + 1));
    if (value) result[key] = value;
    else if (key === "authors" || key === "translators") {
      const arr: string[] = [];
      while (i + 1 < end && rows[i + 1].startsWith("  - "))
        arr.push(strip(rows[++i].slice(4)));
      result[key] = arr;
    }
  }
  return Object.keys(result).length ? result : null;
}
