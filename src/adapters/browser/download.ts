import { validExportBasename } from "../../export/validateArtifacts.js";
import type { ExportDiagnostic } from "../../export/types.js";
export type DownloadState = "ready" | "requested" | "failed" | "disposed";
export type DownloadRequestResult =
  | { status: "requested" }
  | { status: "failed"; diagnostic: ExportDiagnostic };
/** Optional host seam for tests / alternate documents; it must implement DOM semantics. */
export interface DownloadHost {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): Pick<
    HTMLAnchorElement,
    "href" | "download" | "click" | "remove"
  >;
  appendAnchor(
    anchor: Pick<HTMLAnchorElement, "href" | "download" | "click" | "remove">,
  ): void;
  setTimer(callback: () => void, delay: number): unknown;
  clearTimer(timer: unknown): void;
}
export interface DownloadHandle {
  readonly state: DownloadState;
  readonly diagnostic?: ExportDiagnostic;
  request(): DownloadRequestResult;
  dispose(): void;
}
export const DOWNLOAD_URL_LIFETIME_MS = 60000;
// Deferred: evaluating/importing this module never accesses document or starts timers.
const defaultHost: DownloadHost = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createAnchor: () => document.createElement("a"),
  appendAnchor: (anchor) =>
    document.body.appendChild(anchor as HTMLAnchorElement),
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
export function createDownloadHandle(
  blob: Blob,
  filename: string,
  host: DownloadHost = defaultHost,
): DownloadHandle {
  let state: DownloadState = "ready",
    diagnostic: ExportDiagnostic | undefined;
  let heldBlob: Blob | undefined = blob,
    url: string | undefined,
    timer: unknown;
  const error = (code: string): DownloadRequestResult => ({
    status: "failed",
    diagnostic: {
      code,
      severity: "error",
      stage: "download",
      reason: code.toLowerCase(),
    },
  });
  const release = () => {
    heldBlob = undefined;
    if (timer !== undefined) {
      const t = timer;
      timer = undefined;
      host.clearTimer(t);
    }
    if (url !== undefined) {
      const u = url;
      url = undefined;
      host.revokeObjectURL(u);
    }
  };
  if (
    !(blob instanceof Blob) ||
    !validExportBasename(filename) ||
    !/\.(?:md|txt|zip)$/u.test(filename)
  ) {
    state = "failed";
    heldBlob = undefined;
    diagnostic = {
      code: "INVALID_DOWNLOAD",
      severity: "error",
      stage: "download",
      reason: "blob-and-safe-basename-required",
    };
  }
  return {
    get state() {
      return state;
    },
    get diagnostic() {
      return diagnostic;
    },
    request() {
      if (state !== "ready")
        return error(
          state === "requested"
            ? "ALREADY_REQUESTED"
            : state === "disposed"
              ? "DISPOSED"
              : "DOWNLOAD_FAILED",
        );
      let anchor: ReturnType<DownloadHost["createAnchor"]> | undefined;
      let result: DownloadRequestResult;
      // Reserve the sole request before calling any host code (including reentrant hosts).
      state = "requested";
      try {
        url = host.createObjectURL(heldBlob!);
        anchor = host.createAnchor();
        anchor.href = url;
        anchor.download = filename;
        host.appendAnchor(anchor);
        anchor.click();
        // A click listener can dispose its screen (and this handle) synchronously.
        if (state === "requested")
          timer = host.setTimer(() => {
            release();
            state = "disposed";
          }, DOWNLOAD_URL_LIFETIME_MS);
        heldBlob = undefined;
        result = { status: "requested" };
      } catch {
        state = "failed";
        diagnostic = {
          code: "DOWNLOAD_FAILED",
          severity: "error",
          stage: "download",
          reason: "url-or-anchor-request-failure",
        };
        release();
        result = { status: "failed", diagnostic };
      } finally {
        try {
          anchor?.remove();
        } catch {
          state = "failed";
          diagnostic = {
            code: "DOWNLOAD_FAILED",
            severity: "error",
            stage: "download",
            reason: "anchor-cleanup-failure",
          };
          release();
          result = { status: "failed", diagnostic };
        }
      }
      return result!;
    },
    dispose() {
      release();
      state = "disposed";
    },
  };
}
