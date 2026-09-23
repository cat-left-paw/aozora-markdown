import { crc32 } from "../../src/import/filenameDecoding.js";
import {
  prepareImport,
  type ImportInput,
  type ImportOptions,
} from "../../src/import/index.js";
import type {
  ImportWorkerRequest,
  ImportWorkerResponse,
} from "../../src/adapters/browser/workerProtocol.js";

const encoder = new TextEncoder();
export const utf8 = (s: string) => encoder.encode(s);
export const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** Minimal stored (method 0) ZIP with UTF-8 names; independent of the product reader. */
export function storedZip(entries: [name: string, data: Uint8Array][]) {
  const chunks: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  const header = (size: number, fill: (v: DataView) => void) => {
    const b = new Uint8Array(size);
    fill(new DataView(b.buffer));
    return b;
  };
  for (const [name, data] of entries) {
    const n = utf8(name),
      crc = crc32(data);
    const common = (v: DataView, at: number) => {
      v.setUint16(at, 20, true);
      v.setUint16(at + 2, 0x0800, true);
      v.setUint16(at + 4, 0, true);
      v.setUint16(at + 6, 0, true);
      v.setUint16(at + 8, 0x21, true);
      v.setUint32(at + 10, crc, true);
      v.setUint32(at + 14, data.length, true);
      v.setUint32(at + 18, data.length, true);
      v.setUint16(at + 22, n.length, true);
    };
    const local = header(30, (v) => {
      v.setUint32(0, 0x04034b50, true);
      common(v, 4);
    });
    central.push(
      header(46, (v) => {
        v.setUint32(0, 0x02014b50, true);
        v.setUint16(4, 20, true);
        common(v, 6);
        v.setUint32(42, offset, true);
      }),
      n,
    );
    chunks.push(local, n, data);
    offset += local.length + n.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const eocd = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, entries.length, true);
    v.setUint16(10, entries.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, offset, true);
  });
  const all = [...chunks, ...central, eocd];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export const loose = (name: string, text: string, id = name): ImportInput => ({
  id,
  name,
  kind: name.endsWith(".md") ? "md" : "txt",
  bytes: utf8(text),
});
export const zip = (
  name: string,
  entries: [string, string][],
  id = name,
): ImportInput => ({
  id,
  name,
  kind: "zip",
  bytes: storedZip(entries.map(([n, t]) => [n, utf8(t)])),
});
export const run = (inputs: ImportInput[], options: ImportOptions = {}) =>
  prepareImport(inputs, options);

/** In-process Worker double running the real prepareImport. */
export class FakeWorker extends EventTarget {
  terminated = 0;
  request?: ImportWorkerRequest;
  respond?: (request: ImportWorkerRequest) => void;
  postMessage(request: ImportWorkerRequest) {
    this.request = request;
    this.respond?.(request);
  }
  terminate() {
    this.terminated++;
  }
  send(message: ImportWorkerResponse) {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
  asWorker() {
    return this as unknown as Worker;
  }
  static real(
    edit: (r: ImportWorkerResponse & { type: "result" }) => unknown = (r) => r,
  ) {
    const w = new FakeWorker();
    w.respond = (request) => {
      void prepareImport(request.inputs, request.options).then((result) =>
        w.send(
          edit({
            type: "result",
            requestId: request.requestId,
            result,
          }) as ImportWorkerResponse,
        ),
      );
    };
    return w;
  }
}
