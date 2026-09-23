import type { ConversionOptions, ConversionResult } from "../../src/index.js";
import type { OutputExtension } from "../../src/import/types.js";
export interface ExpectedV3 {
  core: ConversionResult;
  policy: {
    relativePath: string;
    filesConverted: number;
    errors: number;
    filesWithRemainingNotes: number;
    remainingNotes: number;
  };
  changedCorePaths: string[];
}
export interface PipelineCaseV3 {
  id: string;
  caseKey: string;
  base: string;
  input: string;
  inputName: string;
  organizeByAuthor: boolean;
  writeError: boolean;
  conversion: ConversionOptions;
  outputExtension: OutputExtension;
  expected: ExpectedV3;
}
export function withoutAddedStats(
  stats: unknown,
  projection: unknown,
): Record<string, unknown>;
export function expectedV3(
  v2Case: unknown,
  ledgerCase: unknown,
  projection: unknown,
): ExpectedV3;
export function pipelineCasesV3(
  originals: unknown,
  v2: unknown,
  ledger: unknown,
): PipelineCaseV3[];
