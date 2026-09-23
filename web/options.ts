import {
  DEFAULT_OPTIONS,
  CONTENT_OPTION_KEYS,
  type HeadingLevels,
} from "../src/index.js";
import {
  DEFAULT_IMPORT_LIMITS,
  type ImportOptions,
  type OutputExtension,
} from "../src/import/index.js";
import type { BrowserInput } from "../src/adapters/browser/index.js";
import { HELP_TOPICS } from "./catalog.js";
export { DEFAULT_IMPORT_LIMITS };
export type ConversionSettings = Omit<
  typeof DEFAULT_OPTIONS,
  "headingLevels"
> & {
  headingLevels: HeadingLevels;
};
export interface Settings {
  encoding: NonNullable<ImportOptions["encoding"]>;
  organizeByAuthor: boolean;
  /** Adapter setting outside `conversion`: only the file extension/MIME. */
  outputExtension: OutputExtension;
  conversion: ConversionSettings;
}
export function initialSettings(): Settings {
  return snapshotSettings({
    encoding: "auto",
    organizeByAuthor: false,
    outputExtension: "md",
    conversion: DEFAULT_OPTIONS,
  });
}
/** Own copy down to the nested heading levels; nothing is shared between jobs. */
export function snapshotSettings(value: Settings): Settings {
  return {
    ...value,
    conversion: {
      ...value.conversion,
      headingLevels: { ...value.conversion.headingLevels },
    },
  };
}
export function importOptions(value: Settings): ImportOptions {
  return snapshotSettings(value);
}
/** True when none of the content fields is on (children do not count). S7 includes convertTcy. */
export function isNoContentConversion(conversion: ConversionSettings): boolean {
  return CONTENT_OPTION_KEYS.every((key) => !conversion[key]);
}
export interface OptionControl {
  key: keyof ConversionSettings;
  label: string;
  parent?: keyof ConversionSettings;
  basic?: boolean;
}
export const BOOLEAN_CONTROLS: readonly OptionControl[] = HELP_TOPICS.flatMap(
  (topic) =>
    topic.control === "boolean" && topic.optionKey
      ? [
          {
            key: topic.optionKey,
            label: topic.label,
            ...(topic.parent ? { parent: topic.parent } : {}),
            ...(topic.group === "basic" ? { basic: true } : {}),
          },
        ]
      : [],
);
export interface SelectionIssue {
  inputId?: string;
  text: string;
}
export function selectionIssues(
  inputs: readonly BrowserInput[],
): SelectionIssue[] {
  const issues: SelectionIssue[] = [],
    limits = DEFAULT_IMPORT_LIMITS;
  if (inputs.length > limits.sources)
    issues.push({
      text: `入力は${limits.sources}個までです。不要な入力を削除してください。`,
    });
  let total = 0;
  for (const input of inputs) {
    if (!/\.(txt|md|zip)$/iu.test(input.file.name))
      issues.push({
        inputId: input.id,
        text: "対応形式はTXT・MD・ZIPです。この入力を削除してください。",
      });
    if (input.file.size > limits.inputBytes)
      issues.push({
        inputId: input.id,
        text: `1入力の上限${limits.inputBytes / 1048576} MiBを超えています。`,
      });
    total += input.file.size;
  }
  if (total > limits.totalInputBytes)
    issues.push({
      text: `入力合計の上限${limits.totalInputBytes / 1048576} MiBを超えています。`,
    });
  return issues;
}
