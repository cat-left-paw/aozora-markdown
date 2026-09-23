import {
  checkAbort,
  checkLimit,
  inputKind,
  ImportFailure,
  validateIdentity,
} from "../../import/limits.js";
import type {
  ImportInput,
  ImportLimits,
  ImportMetrics,
} from "../../import/types.js";
export interface BrowserInput {
  readonly id: string;
  readonly file: File;
  readonly kind?: ImportInput["kind"];
}
export function preflightFiles(
  inputs: readonly BrowserInput[],
  limits: ImportLimits,
  metrics: ImportMetrics,
): void {
  validateIdentity(
    inputs.map((input) => ({
      id: input.id,
      name: input.file.name,
      kind: input.kind ?? inputKind(input.file.name) ?? "txt",
    })),
    limits,
  );
  metrics.sourceCount = inputs.length;
  for (const input of inputs) {
    const kind = inputKind(input.file.name);
    if (!kind || (input.kind !== undefined && input.kind !== kind))
      throw new ImportFailure(
        "INVALID_INPUT",
        "input",
        "batch",
        "kind-extension-mismatch",
      );
    checkLimit(
      input.file.size,
      limits.inputBytes,
      "inputBytes",
      "batch",
      "input",
    );
    metrics.reservedInputBytes += input.file.size;
    checkLimit(
      metrics.reservedInputBytes,
      limits.totalInputBytes,
      "totalInputBytes",
      "batch",
      "input",
    );
  }
}
export async function readFiles(
  inputs: readonly BrowserInput[],
  limits: ImportLimits,
  metrics: ImportMetrics,
  signal: AbortSignal,
  isSettled: () => boolean,
): Promise<ImportInput[]> {
  const prepared: ImportInput[] = [];
  for (const input of inputs) {
    checkAbort(signal);
    if (isSettled()) return [];
    // arrayBuffer allocates one owned transfer buffer. File.text is never used.
    const buffer = await input.file.arrayBuffer();
    checkAbort(signal);
    if (isSettled()) return [];
    metrics.inputBytes += buffer.byteLength;
    checkLimit(
      buffer.byteLength,
      limits.inputBytes,
      "inputBytes",
      "batch",
      "input",
    );
    checkLimit(
      metrics.inputBytes,
      limits.totalInputBytes,
      "totalInputBytes",
      "batch",
      "input",
    );
    if (buffer.byteLength !== input.file.size)
      throw new ImportFailure(
        "FILE_SIZE_MISMATCH",
        "input",
        "batch",
        "reserved-actual-bytes",
      );
    prepared.push({
      id: input.id,
      name: input.file.name,
      kind: input.kind ?? inputKind(input.file.name)!,
      bytes: new Uint8Array(buffer),
    });
  }
  return prepared;
}
