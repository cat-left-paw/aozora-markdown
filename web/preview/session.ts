import type { PreviewModel, PreviewNoticeCode } from "./model.js";
import { PREVIEW_LIMITS, type PreviewLimitReason } from "./protocol.js";
import type {
  PreviewFailure,
  PreviewOutcome,
  PreviewRunner,
} from "./client.js";

export type PreviewTab = "preview" | "source";
/** Writing direction of the プレビュー tab only; 出力テキスト stays horizontal. */
export type PreviewMode = "horizontal" | "vertical";
/** Body typeface of the プレビュー tab. Code and frontmatter keep their own faces. */
export type PreviewFace = "gothic" | "mincho";
export type PreviewStatus =
  | "idle"
  | "loading"
  | "rendering"
  | "ready"
  | "empty"
  | "limit"
  | "failed"
  | "timeout"
  | "cancelled";
/** A borrowed view of one delivered artifact of one result generation. */
export interface PreviewTarget {
  fileId: string;
  relativePath: string;
  format: "md" | "txt";
  bytes: Uint8Array;
  generation: number;
  /** Identity of the delivered artifact; a same-named file of another result differs. */
  artifact: object;
}
export interface PreviewView {
  status: PreviewStatus;
  tab: PreviewTab;
  /** Kept across open, close and file switches; only a new page resets it. */
  mode: PreviewMode;
  /** Same lifetime as mode. A face change does not restart reading. */
  face: PreviewFace;
  target?: PreviewTarget;
  limit?: PreviewLimitReason;
  failure?: PreviewFailure | "render-failed";
  cancelCause?: "busy" | "user";
  notices: readonly PreviewNoticeCode[];
  nodes?: number;
}
export type SurfaceResult = "done" | "cancelled" | "limit" | "failed";
/** DOM owner supplied by the view. `isCurrent` turns false once superseded. */
export interface PreviewSurface {
  render(
    model: PreviewModel,
    isCurrent: () => boolean,
  ): Promise<{ result: SurfaceResult; nodes?: number }>;
  clear(): void;
}

/**
 * At most one preview job and one rendered result. Every new open, reset or
 * busy cancellation bumps the token, aborts the Worker and clears the DOM,
 * so late results from an older job are dropped.
 */
export class PreviewSession {
  private token = 0;
  private abort?: AbortController;
  private surface?: PreviewSurface;
  view: PreviewView = {
    status: "idle",
    tab: "preview",
    mode: "horizontal",
    face: "gothic",
    notices: [],
  };
  constructor(
    private run: PreviewRunner,
    private workerUrl: URL | undefined,
    private notify: () => void,
  ) {}
  attach(surface: PreviewSurface | undefined) {
    this.surface = surface;
  }
  get active() {
    return this.view.status === "loading" || this.view.status === "rendering";
  }
  private stop() {
    this.token++;
    this.abort?.abort();
    this.abort = undefined;
    this.surface?.clear();
  }
  open(target: PreviewTarget): boolean {
    this.stop();
    const token = this.token;
    const size = target.bytes.byteLength;
    const status: PreviewStatus =
      size === 0
        ? "empty"
        : size > PREVIEW_LIMITS.inputBytes
          ? "limit"
          : "loading";
    this.view = {
      status,
      tab: this.view.target ? this.view.tab : "preview",
      mode: this.view.mode,
      face: this.view.face,
      target,
      notices: [],
      ...(status === "limit" ? { limit: "input-bytes" as const } : {}),
    };
    this.notify();
    if (status === "loading") void this.load(token, target);
    return true;
  }
  retry(): boolean {
    const target = this.view.target;
    if (!target || this.active) return false;
    return this.open(target);
  }
  private async load(token: number, target: PreviewTarget) {
    const abort = (this.abort = new AbortController());
    let outcome: PreviewOutcome;
    try {
      outcome = await this.run(target.bytes, {
        requestId: `preview-${token}`,
        generation: target.generation,
        signal: abort.signal,
        workerUrl: this.workerUrl,
      });
    } catch {
      outcome = { status: "failed", reason: "worker-failed" };
    }
    if (token !== this.token) return;
    this.abort = undefined;
    const current = () => token === this.token;
    if (outcome.status !== "ok") {
      this.finish({
        status: outcome.status,
        ...(outcome.status === "limit" ? { limit: outcome.reason } : {}),
        ...(outcome.status === "failed" ? { failure: outcome.reason } : {}),
      });
      return;
    }
    const model = outcome.model;
    if (!model.frontmatter && !model.body.length) {
      this.finish({ status: "empty", notices: model.notices });
      return;
    }
    const surface = this.surface;
    if (!surface) {
      this.finish({ status: "cancelled", cancelCause: "user" });
      return;
    }
    this.finish({ status: "rendering", notices: model.notices });
    let rendered: { result: SurfaceResult; nodes?: number };
    try {
      rendered = await surface.render(model, current);
    } catch {
      rendered = { result: "failed" };
    }
    if (!current()) return;
    if (rendered.result === "done")
      this.finish({
        status: "ready",
        notices: model.notices,
        nodes: rendered.nodes,
      });
    else {
      surface.clear();
      this.finish(
        rendered.result === "limit"
          ? { status: "limit", limit: "nodes" }
          : rendered.result === "failed"
            ? { status: "failed", failure: "render-failed" }
            : { status: "cancelled", cancelCause: "user" },
      );
    }
  }
  private finish(patch: Partial<PreviewView> & { status: PreviewStatus }) {
    this.view = {
      status: patch.status,
      tab: this.view.tab,
      mode: this.view.mode,
      face: this.view.face,
      target: this.view.target,
      notices: patch.notices ?? [],
      ...(patch.limit ? { limit: patch.limit } : {}),
      ...(patch.failure ? { failure: patch.failure } : {}),
      ...(patch.cancelCause ? { cancelCause: patch.cancelCause } : {}),
      ...(patch.nodes !== undefined ? { nodes: patch.nodes } : {}),
    };
    this.notify();
  }
  setTab(tab: PreviewTab): boolean {
    if (!this.view.target || (tab !== "preview" && tab !== "source"))
      return false;
    if (this.view.tab === tab) return true;
    this.view = { ...this.view, tab };
    this.notify();
    return true;
  }
  /** Display-only: no re-parse, no re-render, no effect on bytes or export. */
  setMode(mode: PreviewMode): boolean {
    if (mode !== "horizontal" && mode !== "vertical") return false;
    if (this.view.mode === mode) return true;
    this.view = { ...this.view, mode };
    this.notify();
    return true;
  }
  /** Display-only, like setMode, and it does not move the reading position. */
  setFace(face: PreviewFace): boolean {
    if (face !== "gothic" && face !== "mincho") return false;
    if (this.view.face === face) return true;
    this.view = { ...this.view, face };
    this.notify();
    return true;
  }
  /** Import/export start: stop a running job; a finished view stays. */
  cancelForBusy() {
    if (!this.active) return;
    this.stop();
    this.finish({ status: "cancelled", cancelCause: "busy" });
  }
  /** Result invalidation, close, clear. Drops the target reference too. */
  reset() {
    const had = this.view.status !== "idle" || this.view.target;
    this.stop();
    this.view = {
      status: "idle",
      tab: "preview",
      mode: this.view.mode,
      face: this.view.face,
      notices: [],
    };
    if (had) this.notify();
  }
  dispose() {
    this.stop();
    this.view = {
      status: "idle",
      tab: "preview",
      mode: "horizontal",
      face: "gothic",
      notices: [],
    };
    this.surface = undefined;
  }
}
