import type { ConversionResult } from "../core/types.js";
export interface JobState {
  filesConverted: number;
  filesSkipped: number;
  errors: number;
  filesWithRemainingNotes: number;
  remainingNotes: number;
  cancelledFiles: number;
  artifactFiles: number;
  savedFiles: number;
  committedFileIds: string[];
  skippedFileIds: string[];
  cancelledFileIds: string[];
  seenEvents: string[];
  failedResults: {
    fileId: string;
    attemptId: string;
    error: string;
    result?: ConversionResult;
  }[];
}
export type JobEvent =
  | {
      type: "WriteCommitted";
      fileId: string;
      attemptId: string;
      result: ConversionResult;
      delivery: "filesystem" | "browser-artifact";
    }
  | {
      type: "WriteFailed";
      fileId: string;
      attemptId: string;
      error: string;
      result?: ConversionResult;
    }
  | { type: "Skipped" | "Cancelled"; fileId: string; attemptId: string }
  | { type: "ArchiveFailed"; fileId: string; attemptId: string; error: string };
export function initialJobStats(): JobState {
  return {
    filesConverted: 0,
    filesSkipped: 0,
    errors: 0,
    filesWithRemainingNotes: 0,
    remainingNotes: 0,
    cancelledFiles: 0,
    artifactFiles: 0,
    savedFiles: 0,
    committedFileIds: [],
    skippedFileIds: [],
    cancelledFileIds: [],
    seenEvents: [],
    failedResults: [],
  };
}
export function reduceJobStats(state: JobState, event: JobEvent): JobState {
  const id = JSON.stringify([event.type, event.fileId, event.attemptId]);
  if (state.seenEvents.includes(id)) return state;
  const next = { ...state, seenEvents: [...state.seenEvents, id] };
  switch (event.type) {
    case "WriteCommitted":
      if (!state.committedFileIds.includes(event.fileId)) {
        next.committedFileIds = [...state.committedFileIds, event.fileId];
        next.filesConverted++;
        const count = event.result.remainingNotes.length;
        if (count) next.filesWithRemainingNotes++;
        next.remainingNotes += count;
        if (event.delivery === "browser-artifact") next.artifactFiles++;
        else next.savedFiles++;
      }
      break;
    case "WriteFailed":
      next.errors++;
      next.failedResults = [
        ...state.failedResults,
        {
          fileId: event.fileId,
          attemptId: event.attemptId,
          error: event.error,
          ...(event.result ? { result: event.result } : {}),
        },
      ];
      break;
    case "ArchiveFailed":
      next.errors++;
      break;
    case "Skipped":
      if (!state.skippedFileIds.includes(event.fileId)) {
        next.skippedFileIds = [...state.skippedFileIds, event.fileId];
        next.filesSkipped++;
      }
      break;
    case "Cancelled":
      if (!state.cancelledFileIds.includes(event.fileId)) {
        next.cancelledFileIds = [...state.cancelledFileIds, event.fileId];
        next.cancelledFiles++;
      }
      break;
  }
  return next;
}
