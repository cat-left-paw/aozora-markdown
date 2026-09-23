import type { ConversionOptions, Diagnostic } from "../../src/index.js";

/** Document toggles off, so a TCY fixture is not wrapped in frontmatter. */
export const quiet = {
  addFrontmatter: false,
  removeAozoraFooter: false,
  removeAnnotationBlocks: false,
} as const satisfies ConversionOptions;

export function tcyDiagnostic(
  input: string,
  note: string,
  reason: string,
  quoted: string,
): Diagnostic {
  const start = input.indexOf(note);
  return {
    code: "TCY_NOT_CONVERTED",
    severity: "warning",
    stage: "tcy",
    range: { startUtf16: start, endUtf16: start + note.length },
    sourceOccurrenceId: `source:${start}:${start + note.length}`,
    details: { reason, quoted },
  };
}
