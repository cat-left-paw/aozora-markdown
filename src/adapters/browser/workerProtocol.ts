import type {
  ImportInput,
  ImportOptions,
  ImportProgress,
  ImportResult,
} from "../../import/types.js";
export interface ImportWorkerRequest {
  type: "prepare-import";
  requestId: string;
  inputs: ImportInput[];
  options: ImportOptions;
}
export type ImportWorkerResponse =
  | { type: "progress"; requestId: string; progress: ImportProgress }
  | { type: "result"; requestId: string; result: ImportResult }
  | { type: "failure"; requestId: string; reason: string };
