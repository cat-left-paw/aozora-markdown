import {
  importFiles,
  type BrowserInput,
  type BrowserImportContext,
  type BrowserImportResult,
} from "../src/adapters/browser/index.js";
import {
  prepareBrowserExport,
  type BrowserExportContext,
  type BrowserExportResult,
} from "../src/adapters/browser/export.js";
import type { ImportOptions } from "../src/import/index.js";
import type { ExportArtifact, ExportOptions } from "../src/export/index.js";
import {
  initialState,
  type ActiveJob,
  type DeliveryMode,
  type WebState,
} from "./state.js";
import {
  initialSettings,
  snapshotSettings,
  importOptions,
  selectionIssues,
  type Settings,
} from "./options.js";
import {
  DOWNLOAD_CAP_MESSAGE,
  Downloads,
  MAX_DOWNLOAD_HANDLES,
  type DownloadServices,
} from "./downloads.js";
import { runPreview, type PreviewRunner } from "./preview/client.js";
import {
  PreviewSession,
  type PreviewFace,
  type PreviewMode,
  type PreviewTab,
} from "./preview/session.js";
export interface Services {
  importFiles(
    inputs: readonly BrowserInput[],
    options: ImportOptions,
    context: BrowserImportContext,
  ): Promise<BrowserImportResult>;
  prepareExport(
    artifacts: readonly ExportArtifact[],
    options: ExportOptions,
    context: BrowserExportContext,
  ): Promise<BrowserExportResult>;
  preview?: PreviewRunner;
}
export type Change =
  | "state"
  | "progress"
  | "result"
  | "cancel"
  | "clear"
  | "prepared"
  | "help"
  | "preview";
export class Controller {
  readonly state: WebState;
  readonly downloads: Downloads;
  readonly preview: PreviewSession;
  private sequence = 0;
  private listeners = new Set<(change: Change) => void>();
  constructor(
    private urls: { import: URL; export: URL; preview?: URL },
    private services: Services = {
      importFiles,
      prepareExport: prepareBrowserExport,
    },
    available = true,
    downloads?: DownloadServices,
  ) {
    this.state = initialState(available);
    this.downloads = new Downloads(() => {
      if (
        this.downloads.count < MAX_DOWNLOAD_HANDLES &&
        this.state.downloadMessage === DOWNLOAD_CAP_MESSAGE
      )
        this.state.downloadMessage = "";
      this.emit("state");
    }, downloads);
    this.preview = new PreviewSession(
      services.preview ?? runPreview,
      urls.preview,
      () => this.emit("preview"),
    );
  }
  subscribe(listener: (change: Change) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(change: Change) {
    if (!this.state.disposed)
      for (const listener of this.listeners) listener(change);
  }
  private editable() {
    return !this.state.disposed && !this.state.active;
  }
  private invalidate() {
    const s = this.state;
    this.preview.reset();
    s.generation++;
    s.delivered = undefined;
    s.selected = new Set();
    s.exported = undefined;
    s.detailId = undefined;
    s.inputPage =
      s.resultPage =
      s.diagnosticPage =
      s.notePage =
      s.conversionPage =
        0;
    s.downloadMessage = "";
    s.delivery = "single";
    s.progress = "";
    s.message = s.files.length
      ? "選択・設定が変わりました。変換を開始してください。"
      : "ファイルを選択してください。";
  }
  selectFiles(files: readonly File[]) {
    if (!this.editable() || !files.length) return false; // Picker cancellation preserves selection.
    this.invalidate();
    this.state.files = files.map((file, index) => ({
      file,
      id: `selection-${this.state.generation}-${index}`,
    }));
    this.state.message = "選択したファイルを確認して、変換を開始してください。";
    this.emit("state");
    return true;
  }
  removeFile(id: string) {
    if (!this.editable()) return false;
    this.state.files = this.state.files.filter((f) => f.id !== id);
    this.invalidate();
    this.emit("state");
    return true;
  }
  changeSettings(settings: Settings) {
    if (!this.editable()) return false;
    this.state.settings = snapshotSettings(settings);
    this.invalidate();
    this.emit("state");
    return true;
  }
  resetSettings() {
    return this.changeSettings(initialSettings());
  }
  get canImport() {
    return (
      this.editable() &&
      this.state.available &&
      this.state.files.length > 0 &&
      !selectionIssues(this.state.files).length
    );
  }
  get artifacts() {
    const d = this.state.delivered;
    return d &&
      (d.result.status === "completed" || d.result.status === "partial")
      ? d.artifacts
      : [];
  }
  get selectedArtifacts() {
    return this.artifacts.filter((a) => this.state.selected.has(a.fileId));
  }
  setSelected(id: string, selected: boolean) {
    if (!this.editable() || !this.artifacts.some((a) => a.fileId === id))
      return false;
    const ids = new Set(this.state.selected);
    if (selected) ids.add(id);
    else ids.delete(id);
    this.state.selected = ids;
    this.state.exported = undefined;
    this.state.downloadMessage = "";
    this.syncDelivery();
    this.emit("state");
    return true;
  }
  selectAll(selected: boolean) {
    if (!this.editable()) return false;
    this.state.selected = new Set(
      selected ? this.artifacts.map((a) => a.fileId) : [],
    );
    this.state.exported = undefined;
    this.state.downloadMessage = "";
    this.syncDelivery();
    this.emit("state");
    return true;
  }
  /** Same selection set may keep an explicit mode. A selection change calls syncDelivery instead. */
  setDelivery(mode: DeliveryMode): boolean {
    if (!this.editable() || !this.state.available) return false;
    const count = this.selectedArtifacts.length;
    if (count < 1 || (count > 1 && mode !== "zip")) return false;
    if (mode !== "single" && mode !== "zip") return false;
    if (this.state.delivery === mode) return true;
    this.state.delivery = mode;
    this.state.exported = undefined;
    this.emit("state");
    return true;
  }
  openHelp(id: string): boolean {
    if (this.state.disposed || !id || this.state.helpTopic === id)
      return !this.state.disposed && !!id;
    this.state.helpTopic = id;
    this.emit("help");
    return true;
  }
  closeHelp(): boolean {
    if (this.state.disposed || !this.state.helpTopic) return false;
    this.state.helpTopic = undefined;
    this.emit("help");
    return true;
  }
  private syncDelivery() {
    this.state.delivery = this.selectedArtifacts.length > 1 ? "zip" : "single";
  }
  setPage(
    key:
      | "inputPage"
      | "resultPage"
      | "diagnosticPage"
      | "notePage"
      | "conversionPage",
    page: number,
  ) {
    if (this.state.disposed) return;
    this.state[key] = Math.max(0, page);
    this.emit("state");
  }
  showDetail(id: string) {
    if (!this.artifacts.some((a) => a.fileId === id)) return;
    this.state.detailId = id;
    this.state.notePage = this.state.conversionPage = 0;
    this.emit("state");
  }
  /** Viewing is independent of the export selection and of ready/URL state. */
  openPreview(id: string): boolean {
    if (this.state.disposed || this.state.active) return false;
    const artifact = this.artifacts.find((a) => a.fileId === id);
    if (!artifact) return false;
    return this.preview.open({
      fileId: artifact.fileId,
      relativePath: artifact.relativePath,
      format: artifact.format,
      bytes: artifact.bytes,
      generation: this.state.generation,
      artifact,
    });
  }
  retryPreview(): boolean {
    const target = this.preview.view.target;
    if (
      this.state.disposed ||
      this.state.active ||
      !target ||
      !this.artifacts.some((a) => a === target.artifact)
    )
      return false;
    return this.preview.retry();
  }
  setPreviewTab(tab: PreviewTab): boolean {
    return !this.state.disposed && this.preview.setTab(tab);
  }
  setPreviewMode(mode: PreviewMode): boolean {
    return !this.state.disposed && this.preview.setMode(mode);
  }
  setPreviewFace(face: PreviewFace): boolean {
    return !this.state.disposed && this.preview.setFace(face);
  }
  closePreview() {
    if (!this.state.disposed) this.preview.reset();
  }
  private begin(kind: ActiveJob["kind"]): ActiveJob {
    if (kind === "import") this.preview.reset();
    else this.preview.cancelForBusy();
    const job: ActiveJob = {
      kind,
      generation: this.state.generation,
      token: ++this.sequence,
      abort: new AbortController(),
      files: [...this.state.files],
      settings: snapshotSettings(this.state.settings),
    };
    this.state.active = job;
    this.state.progress = "";
    this.state.exported = undefined;
    this.state.downloadMessage = "";
    this.state.message =
      kind === "import" ? "変換しています。" : "出力を作成しています。";
    return job;
  }
  private owns(job: ActiveJob) {
    return (
      !this.state.disposed &&
      this.state.generation === job.generation &&
      this.state.active?.token === job.token
    );
  }
  async startImport(): Promise<boolean> {
    if (!this.canImport) return false;
    this.state.delivered = undefined;
    this.state.selected = new Set();
    this.syncDelivery();
    this.state.detailId = undefined;
    this.state.resultPage = this.state.diagnosticPage = 0;
    const job = this.begin("import");
    this.emit("state");
    try {
      const delivered = await this.services.importFiles(
        job.files,
        importOptions(job.settings),
        {
          requestId: `web-import-${job.token}`,
          attemptId: `attempt-${job.token}`,
          workerUrl: this.urls.import,
          signal: job.abort.signal,
          onProgress: (p) => {
            if (this.owns(job)) {
              this.state.progress = `${{ enumerating: "ZIPの内容を確認中", reading: "読込中", converting: "変換中", converted: "変換処理済み" }[p.stage]} · 読込 ${p.metrics.inputBytes.toLocaleString()} bytes · 変換処理 ${p.metrics.conversions} 件`;
              this.emit("progress");
            }
          },
        },
      );
      if (!this.owns(job)) return false;
      this.state.delivered = delivered;
      this.state.selected = new Set(this.artifacts.map((a) => a.fileId));
      this.syncDelivery();
      const status = delivered.result.status;
      this.state.message =
        status === "partial"
          ? "一部の入力で失敗しました。正常な出力だけを利用できます。"
          : status === "failed"
            ? "変換に失敗しました。診断を確認してください。"
            : status === "cancelled"
              ? "変換を中止しました。出力はありません。"
              : this.artifacts.length
                ? "変換が完了しました。結果と警告を確認してください。"
                : "変換処理が終了しました。出力はありません（空ZIP・処理対象外など）。";
    } catch {
      if (this.owns(job))
        this.state.message =
          "変換処理を開始できませんでした。ブラウザの対応状況とWorkerの配信を確認してください（UI_IMPORT_FAILED）。";
    } finally {
      if (this.owns(job)) {
        this.state.active = undefined;
        this.state.progress = "";
        this.emit("result");
      }
    }
    return true;
  }
  async prepare(mode: "single" | "zip"): Promise<boolean> {
    const selected = this.selectedArtifacts;
    if (
      !this.editable() ||
      !this.state.available ||
      !selected.length ||
      (mode === "single" && selected.length !== 1)
    )
      return false;
    const artifacts = selected.map(
      ({ fileId, relativePath, format, bytes }) => ({
        fileId,
        relativePath,
        format,
        bytes,
      }),
    );
    const job = this.begin("export");
    this.emit("state");
    try {
      const result = await this.services.prepareExport(
        artifacts,
        { mode },
        {
          requestId: `web-export-${job.token}`,
          workerUrl: this.urls.export,
          signal: job.abort.signal,
          onProgress: (p) => {
            if (this.owns(job)) {
              this.state.progress = `${mode === "zip" ? "ZIPを作成中" : "ファイルを作成中"} · 読取 ${p.metrics.processedBytes.toLocaleString()} bytes · コピー ${p.metrics.copiedBytes.toLocaleString()} bytes`;
              this.emit("progress");
            }
          },
        },
      );
      if (!this.owns(job)) return false;
      this.state.exported = result;
      this.state.message =
        result.status === "ready"
          ? "出力を作成しました。ダウンロードは別の操作です。"
          : result.status === "cancelled"
            ? "出力の作成を中止しました。変換結果は保持しています。"
            : "出力の作成に失敗しました。変換結果は保持しています。再試行できます。";
    } catch {
      if (this.owns(job))
        this.state.message =
          "出力の作成に失敗しました。変換結果は保持しています（UI_EXPORT_FAILED）。";
    } finally {
      if (this.owns(job)) {
        this.state.active = undefined;
        this.state.progress = "";
        this.emit("prepared");
      }
    }
    return true;
  }
  cancel() {
    const job = this.state.active;
    if (!job || this.state.disposed) return;
    this.state.active = undefined;
    ++this.sequence;
    job.abort.abort();
    this.state.exported = undefined;
    this.state.progress = "";
    this.state.message =
      job.kind === "import"
        ? "変換を中止しました。出力はありません。"
        : "出力の作成を中止しました。変換結果は保持しています。";
    this.emit("cancel");
  }
  clear() {
    if (this.state.disposed) return;
    const job = this.state.active;
    this.state.active = undefined;
    job?.abort.abort();
    this.state.files = [];
    this.invalidate();
    this.state.message = "入力と結果をクリアしました。設定は保持しています。";
    this.emit("clear");
  }
  requestDownload() {
    const ready = this.state.exported;
    if (!this.editable() || ready?.status !== "ready") return false;
    this.state.downloadMessage = this.downloads.request(
      ready.blob,
      ready.filename,
    );
    this.emit("state");
    return true;
  }
  dispose() {
    if (this.state.disposed) return;
    this.clear();
    this.preview.dispose();
    this.downloads.dispose();
    this.state.disposed = true;
    this.listeners.clear();
  }
}
