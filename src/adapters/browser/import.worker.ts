import { prepareImport } from "../../import/prepareImport.js";
import type {
  ImportWorkerRequest,
  ImportWorkerResponse,
} from "./workerProtocol.js";
const scope = self as unknown as DedicatedWorkerGlobalScope;
let started = false;
scope.addEventListener(
  "message",
  (event: MessageEvent<ImportWorkerRequest>) => {
    if (started) return;
    started = true;
    const request = event.data;
    const send = (
      message: ImportWorkerResponse,
      transfer: Transferable[] = [],
    ) => scope.postMessage(message, transfer);
    void (async () => {
      try {
        if (request.type !== "prepare-import" || !request.requestId)
          throw new Error("invalid request");
        const result = await prepareImport(request.inputs, request.options, {
          onProgress: (progress) =>
            send({ type: "progress", requestId: request.requestId, progress }),
        });
        send(
          { type: "result", requestId: request.requestId, result },
          result.artifacts.map((a) => a.bytes.buffer as ArrayBuffer),
        );
      } catch {
        send({
          type: "failure",
          requestId: request.requestId,
          reason: "request-or-result-transfer",
        });
      } finally {
        scope.close();
      }
    })();
  },
);
