import {
  collisionKey,
  sanitizeFilename,
  utf8Length,
} from "../policies/naming.js";
import { ExportFailure, resolveExportLimits } from "./limits.js";
import type {
  ExportArtifact,
  ExportLimits,
  ExportManifestEntry,
  ExportMetrics,
  ExportOptions,
} from "./types.js";
export function validExportBasename(name: unknown): name is string {
  if (
    typeof name !== "string" ||
    !name ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      name,
    )
  )
    return false;
  return sanitizeFilename(name) === name;
}
export function exportMime(format: "md" | "txt" | "zip"): string {
  return format === "zip"
    ? "application/zip"
    : format === "md"
      ? "text/markdown;charset=utf-8"
      : "text/plain;charset=utf-8";
}
export interface ExportPlan {
  limits: ExportLimits;
  manifest: ExportManifestEntry[];
  filename: string;
  mime: string;
}
export function validateArtifacts(
  artifacts: readonly ExportArtifact[],
  options: ExportOptions,
  metrics: ExportMetrics,
): ExportPlan {
  if (!options || (options.mode !== "single" && options.mode !== "zip"))
    throw new ExportFailure(
      "INVALID_MODE",
      "validate",
      "explicit-mode-required",
    );
  const limits = resolveExportLimits(options.limits);
  if (!Array.isArray(artifacts))
    throw new ExportFailure("INVALID_ARTIFACT", "validate", "array-required");
  metrics.selectedFiles = artifacts.length;
  if (!artifacts.length)
    throw new ExportFailure("NO_ARTIFACTS", "validate", "selection-empty");
  if (artifacts.length > limits.maxFiles)
    throw new ExportFailure(
      "FILE_COUNT_LIMIT",
      "validate",
      "selected-file-count",
    );
  if (options.mode === "single" && artifacts.length !== 1)
    throw new ExportFailure(
      "SINGLE_FILE_COUNT",
      "validate",
      "exactly-one-required",
    );
  if (options.mode === "single" && options.archiveName !== undefined)
    throw new ExportFailure(
      "INVALID_ARCHIVE_NAME",
      "validate",
      "archive-name-only-for-zip",
    );
  const archiveName =
    options.archiveName === undefined
      ? "aozora-markdown.zip"
      : options.archiveName;
  if (
    options.mode === "zip" &&
    (!validExportBasename(archiveName) || !archiveName.endsWith(".zip"))
  )
    throw new ExportFailure(
      "INVALID_ARCHIVE_NAME",
      "validate",
      "safe-zip-basename-required",
    );
  const ids = new Set<string>(),
    paths = new Set<string>(),
    parents = new Set<string>();
  const manifest: ExportManifestEntry[] = [];
  const candidates: readonly ExportArtifact[] = artifacts;
  for (const a of candidates) {
    if (!a || typeof a.fileId !== "string" || !a.fileId.trim())
      throw new ExportFailure(
        "INVALID_FILE_ID",
        "validate",
        "nonempty-id-required",
      );
    if (ids.has(a.fileId))
      throw new ExportFailure(
        "DUPLICATE_FILE_ID",
        "validate",
        "unique-id-required",
        a.fileId,
      );
    ids.add(a.fileId);
    if (a.format !== "md" && a.format !== "txt")
      throw new ExportFailure(
        "INVALID_FORMAT",
        "validate",
        "md-or-txt-required",
        a.fileId,
      );
    if (
      typeof a.relativePath !== "string" ||
      utf8Length(a.relativePath) > limits.maxPathBytes
    )
      throw new ExportFailure(
        "PATH_LIMIT",
        "validate",
        "relative-path-byte-budget",
        a.fileId,
      );
    const parts = a.relativePath.split("/");
    if (
      parts.some((p) => !validExportBasename(p)) ||
      !parts.at(-1)!.endsWith("." + a.format)
    )
      throw new ExportFailure(
        "UNSAFE_PATH",
        "validate",
        "canonical-file-path-required",
        a.fileId,
      );
    const key = collisionKey(a.relativePath);
    if (paths.has(key) || parents.has(key))
      throw new ExportFailure(
        "PATH_COLLISION",
        "validate",
        "file-or-directory-collision",
        a.fileId,
      );
    const parentParts = key.split("/");
    parentParts.pop();
    while (parentParts.length) {
      const parent = parentParts.join("/");
      if (paths.has(parent))
        throw new ExportFailure(
          "PATH_COLLISION",
          "validate",
          "file-or-directory-collision",
          a.fileId,
        );
      parents.add(parent);
      parentParts.pop();
    }
    paths.add(key);
    if (
      !(a.bytes instanceof Uint8Array) ||
      !(a.bytes.buffer instanceof ArrayBuffer)
    )
      throw new ExportFailure(
        "INVALID_BYTES",
        "validate",
        "unshared-uint8array-required",
        a.fileId,
      );
    // Detached buffers must not silently become empty files.
    try {
      a.bytes.subarray(0, 0);
    } catch {
      throw new ExportFailure(
        "INVALID_BYTES",
        "validate",
        "detached-buffer",
        a.fileId,
      );
    }
    if (a.bytes.byteLength > limits.maxFileBytes)
      throw new ExportFailure(
        "FILE_BYTES_LIMIT",
        "validate",
        "file-byte-budget",
        a.fileId,
      );
    metrics.inputBytes += a.bytes.byteLength;
    if (metrics.inputBytes > limits.maxInputBytes)
      throw new ExportFailure(
        "INPUT_BYTES_LIMIT",
        "validate",
        "selection-byte-budget",
        a.fileId,
      );
    manifest.push({
      fileId: a.fileId,
      relativePath: a.relativePath,
      format: a.format,
      byteLength: a.bytes.byteLength,
    });
  }
  if (options.mode === "single" && metrics.inputBytes > limits.maxOutputBytes)
    throw new ExportFailure(
      "OUTPUT_BYTES_LIMIT",
      "validate",
      "single-output-budget",
    );
  return {
    limits,
    manifest,
    filename:
      options.mode === "zip"
        ? archiveName
        : artifacts[0].relativePath.split("/").at(-1)!,
    mime: exportMime(options.mode === "zip" ? "zip" : artifacts[0].format),
  };
}
