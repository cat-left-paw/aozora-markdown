import { prepareExport } from "../../export/prepareExport.js";
import type {
  ExportWorkerRequest,
  ExportWorkerResponse,
} from "./exportProtocol.js";
const scope: DedicatedWorkerGlobalScope = self;
let used = false;
scope.addEventListener(
  "message",
  (event: MessageEvent<ExportWorkerRequest>) => {
    if (used) return;
    used = true;
    const request = event.data;
    void (async () => {
      try {
        if (
          request?.type !== "prepare-export" ||
          typeof request.requestId !== "string" ||
          !request.requestId.trim() ||
          request.options?.mode !== "zip"
        )
          throw Error("invalid-request");
        const result = await prepareExport(request.artifacts, request.options, {
          onProgress(progress) {
            scope.postMessage({
              type: "progress",
              requestId: request.requestId,
              progress,
            } satisfies ExportWorkerResponse);
          },
        });
        const response: ExportWorkerResponse = {
          type: "result",
          requestId: request.requestId,
          result,
        };
        scope.postMessage(
          response,
          result.status === "ready" ? [result.bytes.buffer] : [],
        );
      } catch {
        scope.postMessage({
          type: "failure",
          requestId: request?.requestId,
        } satisfies ExportWorkerResponse);
      }
    })();
  },
);
