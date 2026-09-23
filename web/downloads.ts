import {
  createDownloadHandle,
  DOWNLOAD_URL_LIFETIME_MS,
  type DownloadHandle,
} from "../src/adapters/browser/export.js";
export const MAX_DOWNLOAD_HANDLES = 8;
export interface DownloadServices {
  createHandle: typeof createDownloadHandle;
  now(): number;
  setTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}
const defaultServices: DownloadServices = {
  createHandle: createDownloadHandle,
  now: () => performance.now(),
  setTimer: (cb, ms) => setTimeout(cb, ms),
  clearTimer: (t) => clearTimeout(t),
};
/** Issued URL lifetime is independent of input/result/ready-Blob lifetime. */
export class Downloads {
  private handles = new Map<DownloadHandle, number>();
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private requesting = false;
  constructor(
    private changed: () => void,
    private services = defaultServices,
  ) {}
  get count() {
    return this.handles.size;
  }
  private prune() {
    for (const [handle] of this.handles)
      if (handle.state === "disposed" || handle.state === "failed")
        this.handles.delete(handle);
    if (!this.handles.size && this.timer !== undefined) {
      this.services.clearTimer(this.timer);
      this.timer = undefined;
    }
  }
  private arm() {
    if (this.timer !== undefined || !this.handles.size || this.disposed) return;
    const deadline = Math.min(...this.handles.values());
    this.timer = this.services.setTimer(
      () => {
        this.timer = undefined;
        this.prune();
        this.changed();
        this.arm();
      },
      Math.max(1000, deadline - this.services.now() + 1),
    );
  }
  request(blob: Blob, filename: string): string {
    if (this.disposed || this.requesting)
      return "ダウンロードを要求できません。";
    this.prune();
    if (this.handles.size >= MAX_DOWNLOAD_HANDLES)
      return "ダウンロード操作が続いています。少し待ってから再試行してください。";
    this.requesting = true;
    try {
      const handle = this.services.createHandle(blob, filename);
      const result = handle.request();
      if (result.status !== "requested") {
        handle.dispose();
        return `ダウンロードを要求できませんでした（${result.diagnostic.code}）。再試行できます。`;
      }
      if (this.disposed) handle.dispose();
      else {
        this.handles.set(
          handle,
          this.services.now() + DOWNLOAD_URL_LIFETIME_MS,
        );
        this.arm();
      }
      return "ダウンロードを開始しました。保存状況はブラウザで確認してください。";
    } catch {
      return "ダウンロードを要求できませんでした。ブラウザの設定を確認してください。";
    } finally {
      this.requesting = false;
    }
  }
  dispose() {
    this.disposed = true;
    if (this.timer !== undefined) this.services.clearTimer(this.timer);
    this.timer = undefined;
    for (const [handle] of this.handles) handle.dispose();
    this.handles.clear();
  }
}
