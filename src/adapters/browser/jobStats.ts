import {
  initialJobStats,
  reduceJobStats,
  type JobState,
} from "../../policies/jobStats.js";
import type { ImportResult } from "../../import/types.js";
/** Errors/cancel count input units. Skips count ignored entries, or one empty ZIP.
 * Success is counted only for individual artifacts, after the caller creates ALL Blobs. */
export function browserJobStats(
  result: ImportResult,
  attemptId: string,
  ready: boolean,
): JobState {
  let stats = initialJobStats();
  for (const o of result.outcomes) {
    if (o.status === "cancelled" && o.entryIndex === undefined)
      stats = reduceJobStats(stats, {
        type: "Cancelled",
        fileId: o.fileId,
        attemptId,
      });
    else if (o.status === "failed" && o.entryIndex === undefined)
      stats = reduceJobStats(stats, {
        type: o.kind === "zip" ? "ArchiveFailed" : "WriteFailed",
        fileId: o.fileId,
        attemptId,
        error: o.reason ?? "IMPORT_FAILED",
      });
    else if (
      (o.status === "ignored" && o.entryIndex !== undefined) ||
      o.status === "empty"
    )
      stats = reduceJobStats(stats, {
        type: "Skipped",
        fileId: o.fileId,
        attemptId,
      });
  }
  if (ready)
    for (const a of result.artifacts)
      stats = reduceJobStats(stats, {
        type: "WriteCommitted",
        fileId: a.fileId,
        attemptId,
        result: a.conversion,
        delivery: "browser-artifact",
      });
  return stats;
}
