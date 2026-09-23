import type {
  ConversionOptions,
  HeadingLevel,
  HeadingLevels,
  StageStats,
} from "./types.js";
export type NormalizedOptions = Required<
  Omit<ConversionOptions, "headingLevels">
> & { headingLevels: HeadingLevels };
export const DEFAULT_HEADING_LEVELS: Readonly<HeadingLevels> = Object.freeze({
  large: 2,
  medium: 3,
  small: 4,
});
export const DEFAULT_OPTIONS: Readonly<
  Omit<NormalizedOptions, "headingLevels"> & {
    headingLevels: Readonly<HeadingLevels>;
  }
> = Object.freeze({
  addFrontmatter: true,
  removeAnnotationBlocks: true,
  removeAozoraFooter: true,
  addHeaderToBody: false,
  convertGaiji: true,
  convertTcy: true,
  convertBouten: true,
  boutenChar: "﹅",
  convertHeadings: true,
  headingLevels: DEFAULT_HEADING_LEVELS,
  convertNyozeIndent: false,
  preserveIndentNotes: false,
  convertNyozeAlignEnd: false,
  approximateJiage: false,
  preserveAlignNotes: false,
  convertNyozePageBreak: false,
  approximateSpreadBreaks: false,
  preservePageBreakNotes: false,
  convertMarkdownEmphasis: true,
  convertUnderline: true,
  underlineOutputFormat: "nyoze",
  approximateOtherUnderlineStyles: false,
  approximateLeftUnderline: false,
});
/**
 * Every field that can change the text. When all are false the core returns
 * its input unchanged. Child/format/level settings are not listed.
 * S7 adds convertTcy to the S6 set of twelve.
 */
export const CONTENT_OPTION_KEYS = Object.freeze([
  "convertGaiji",
  "convertTcy",
  "convertMarkdownEmphasis",
  "convertUnderline",
  "convertBouten",
  "convertHeadings",
  "convertNyozeIndent",
  "convertNyozeAlignEnd",
  "convertNyozePageBreak",
  "removeAozoraFooter",
  "removeAnnotationBlocks",
  "addFrontmatter",
  "addHeaderToBody",
] as const satisfies readonly (keyof ConversionOptions)[]);
const REMOVED_FIELDS = {
  sourceFormat:
    "was removed in aozora-ts-v3: every input uses the same conversion. Drop the field.",
  renameToMd:
    'was removed in aozora-ts-v3: choose the file extension with ImportOptions.outputExtension ("md" | "txt").',
} as const;
/**
 * Rejected option. `field` is a stable dotted path such as
 * `headingLevels.medium`, or "" for the options argument itself. `removed`
 * marks an aozora-ts-v2 field that no longer exists.
 */
export class ConversionOptionsError extends TypeError {
  constructor(
    readonly field: string,
    message: string,
    readonly removed = false,
  ) {
    super(`ConversionOptions${field ? "." + field : ""} ${message}`);
    this.name = "ConversionOptionsError";
  }
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const isHeadingLevel = (value: unknown): value is HeadingLevel =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 6;
function normalizeHeadingLevels(value: unknown): HeadingLevels {
  const levels: HeadingLevels = { ...DEFAULT_HEADING_LEVELS };
  if (value === undefined) return levels;
  if (!isObject(value))
    throw new ConversionOptionsError(
      "headingLevels",
      "must be an object with optional large/medium/small levels",
    );
  for (const key of Object.keys(value))
    if (!Object.hasOwn(levels, key))
      throw new ConversionOptionsError(
        "headingLevels." + key,
        "is not a heading kind (use large, medium or small)",
      );
  for (const key of ["large", "medium", "small"] as const) {
    const level = value[key];
    if (level === undefined) continue;
    if (!isHeadingLevel(level))
      throw new ConversionOptionsError(
        "headingLevels." + key,
        "must be an integer from 1 to 6",
      );
    levels[key] = level;
  }
  return levels;
}
/**
 * Optional fields may be present with undefined; false remains explicit.
 * Returns fresh objects; neither the argument nor DEFAULT_OPTIONS is mutated.
 */
export function normalizeOptions(
  options?: ConversionOptions,
): NormalizedOptions {
  if (options === undefined) options = {};
  if (!isObject(options))
    throw new ConversionOptionsError("", "must be an object or undefined");
  for (const [key, message] of Object.entries(REMOVED_FIELDS))
    if (options[key as keyof ConversionOptions] !== undefined)
      throw new ConversionOptionsError(key, message, true);
  const defined = Object.fromEntries(
    Object.entries(options).filter(
      ([key, value]) => value !== undefined && key !== "headingLevels",
    ),
  );
  return {
    ...DEFAULT_OPTIONS,
    ...defined,
    headingLevels: normalizeHeadingLevels(options.headingLevels),
  };
}
export function zeroStats(): StageStats {
  return {
    gaiji: { converted: 0, unconverted: 0 },
    tcy: { converted: 0, unconverted: 0 },
    emphasis: { bold: 0, italic: 0, both: 0, unconverted: 0 },
    underline: { converted: 0, approximated: 0, unconverted: 0 },
    bouten: { converted: 0, unconverted: 0 },
    headings: { converted: 0, unsupported: 0 },
    indent: { converted: 0, unconverted: 0 },
    align: { converted: 0, approximated: 0, unconverted: 0 },
    pageBreak: {
      pageBreaks: 0,
      blankPages: 0,
      spreadApproximated: 0,
      unconverted: 0,
      kaidanUnconverted: 0,
    },
    footerRemoved: false,
    remainingNotes: 0,
  };
}
