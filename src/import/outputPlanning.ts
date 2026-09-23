import { planOutputs, type OutputRequest } from "../policies/outputPlan.js";
import { zipOutputRequest } from "../policies/zipPlan.js";
import { sanitizeFilename } from "../policies/naming.js";
import { basename, ImportFailure } from "./limits.js";
import type { ImportInput, ImportOptions, PreparedArtifact } from "./types.js";
export function outputRequest(
  input: ImportInput,
  artifact: PreparedArtifact,
  relativeName: string,
  options: ImportOptions,
): OutputRequest {
  const metadata = artifact.conversion.namingMetadata.ok
    ? artifact.conversion.namingMetadata.metadata
    : undefined;
  if (artifact.source.entryIndex !== undefined)
    return zipOutputRequest(
      {
        archiveId: input.id,
        stem: basename(input.name).replace(/\.zip$/iu, ""),
      },
      relativeName,
      artifact.fileId,
      {
        outputExtension: artifact.format,
        organizeByAuthor: options.organizeByAuthor,
        metadata: { [artifact.fileId]: metadata ?? {} },
      },
    );
  const stem = basename(input.name).replace(/\.(txt|md)$/iu, "");
  const author = metadata?.author ?? "unknown_author";
  return {
    sourceId: artifact.fileId,
    desiredPath: `${sanitizeFilename(options.organizeByAuthor ? (metadata?.title ?? stem) : stem)}.${artifact.format}`,
    ...(options.organizeByAuthor
      ? { directories: [{ name: author, groupId: "author:" + author }] }
      : {}),
  };
}
export function planArtifacts(
  artifacts: PreparedArtifact[],
  requests: OutputRequest[],
  inputs: readonly ImportInput[],
): void {
  const plan = planOutputs(requests, {
    inputs: inputs.map((input) => ({ path: basename(input.name) })),
    existing: [],
  });
  if (!plan.ok)
    throw new ImportFailure(
      plan.code,
      "output",
      "batch",
      "output-plan-invalid",
    );
  plan.outputs.forEach((output, index) => {
    artifacts[index].relativePath = output.relativePath;
  });
}
