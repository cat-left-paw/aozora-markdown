import { previewBytes } from "./parse.js";
import {
  PREVIEW_CONTRACT,
  type PreviewWorkerRequest,
  type PreviewWorkerResponse,
} from "./protocol.js";

const scope: DedicatedWorkerGlobalScope = self;
scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data as Partial<PreviewWorkerRequest> | null;
  if (
    !data ||
    data.contract !== PREVIEW_CONTRACT ||
    data.type !== "preview" ||
    typeof data.requestId !== "string" ||
    typeof data.generation !== "number" ||
    !(data.bytes instanceof Uint8Array)
  )
    return;
  const response: PreviewWorkerResponse = {
    contract: PREVIEW_CONTRACT,
    type: "result",
    requestId: data.requestId,
    generation: data.generation,
    outcome: previewBytes(data.bytes),
  };
  scope.postMessage(response);
});
