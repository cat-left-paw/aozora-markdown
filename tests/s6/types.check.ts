/**
 * S6-01 SCHEMA_V3_API at the type level. Checked by `npm run typecheck`
 * (tsconfig.json includes tests/); each @ts-expect-error must stay an error.
 */
import {
  convertText,
  convertHeadings,
  type ConversionOptions,
  type ConversionResult,
  type HeadingLevels,
} from "../../src/index.js";
import type {
  ImportOptions,
  PreparedArtifact,
} from "../../src/import/index.js";
import type { ZipPlanOptions } from "../../src/policies/index.js";

// @ts-expect-error sourceFormat was removed from ConversionOptions
export const sourceFormat: ConversionOptions = { sourceFormat: "md" };
// @ts-expect-error renameToMd was removed from ConversionOptions
export const renameToMd: ConversionOptions = { renameToMd: true };
// @ts-expect-error renameToMd is not an import option either
export const importRename: ImportOptions = { renameToMd: true };
// @ts-expect-error the extension is "md" | "txt" only
export const html: ImportOptions = { outputExtension: "html" };
// @ts-expect-error the ZIP planner has no renameToMd
export const zipRename: ZipPlanOptions = { renameToMd: true };
// @ts-expect-error heading levels are 1 to 6
export const level7: ConversionOptions = { headingLevels: { large: 7 } };
// @ts-expect-error unknown heading kind
export const huge: ConversionOptions = { headingLevels: { huge: 1 } };
// @ts-expect-error convertText no longer takes a format argument
export const withFormat = convertText("x", "md");
export function noMarkdownFlag(result: ConversionResult) {
  // @ts-expect-error isMarkdownOutput was removed from ConversionResult
  return result.isMarkdownOutput;
}

export const ok: ConversionOptions[] = [
  {},
  { convertGaiji: false, convertBouten: false, convertHeadings: false },
  { headingLevels: { medium: 1 } },
  { headingLevels: { large: 6, medium: 6, small: 6 } },
];
export const importOk: ImportOptions[] = [
  {},
  { outputExtension: "md" },
  { outputExtension: "txt", conversion: { convertHeadings: false } },
  { outputExtension: undefined },
];
export const levels: HeadingLevels = { large: 1, medium: 2, small: 3 };
export const formats: PreparedArtifact["format"][] = ["md", "txt"];
export const optional = convertText("x");
export const threeArgs = convertHeadings("x", "markdown", { small: 5 });
