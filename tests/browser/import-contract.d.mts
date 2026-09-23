import type {
  ImportInput,
  ImportOptions,
  ImportResult,
} from "../../src/import/types.js";
export const plain: ImportOptions;
export const integrationOptions: ImportOptions;
export const integrationText: string;
export const negativeZips: string[];
export const positiveNames: string[][];
export function equal(actual: unknown, expected: unknown, label: string): void;
export function validateIntegration(result: ImportResult): void;
export function integrationInputs(
  bytes: Record<string, Uint8Array>,
): ImportInput[];
export function runContract(
  prepare: (
    inputs: ImportInput[],
    options: ImportOptions,
  ) => Promise<ImportResult>,
  bytes: Record<string, Uint8Array>,
): Promise<{ passed: number; integration: ImportResult }>;
