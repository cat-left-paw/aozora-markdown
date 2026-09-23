import type {
  BrowserInput,
  BrowserImportResult,
} from "../src/adapters/browser/index.js";
import type { BrowserExportResult } from "../src/adapters/browser/export.js";
import { initialSettings, type Settings } from "./options.js";
export const WEB_CONTRACT = "aozora-web-v6";
export type DeliveryMode = "single" | "zip";
export const PAGE_SIZE = 50;
export interface ActiveJob {
  kind: "import" | "export";
  generation: number;
  token: number;
  abort: AbortController;
  files: readonly BrowserInput[];
  settings: Settings;
}
export interface WebState {
  generation: number;
  files: readonly BrowserInput[];
  settings: Settings;
  active?: ActiveJob;
  delivered?: BrowserImportResult;
  selected: ReadonlySet<string>;
  exported?: BrowserExportResult;
  inputPage: number;
  resultPage: number;
  diagnosticPage: number;
  detailId?: string;
  notePage: number;
  conversionPage: number;
  message: string;
  progress: string;
  downloadMessage: string;
  delivery: DeliveryMode;
  helpTopic?: string;
  available: boolean;
  disposed: boolean;
}
export function initialState(available = true): WebState {
  return {
    generation: 0,
    files: [],
    settings: initialSettings(),
    selected: new Set(),
    inputPage: 0,
    resultPage: 0,
    diagnosticPage: 0,
    notePage: 0,
    conversionPage: 0,
    message: available
      ? "ファイルを選択して、変換を開始してください。"
      : "この環境では利用できません。JavaScript・module Worker対応のブラウザをHTTPで開いてください。",
    progress: "",
    downloadMessage: "",
    delivery: "single",
    available,
    disposed: false,
  };
}
export function pageOf<T>(items: readonly T[], page: number): readonly T[] {
  return items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
}
/** Visible file-picker copy. The count is the controller File list, not the native input. */
export function fileSelectionPresentation(count: number): {
  action: string;
  status: string;
} {
  return count === 0
    ? { action: "ファイルを選ぶ", status: "未選択" }
    : { action: "ファイルを選び直す", status: `${count}ファイル選択済み` };
}
export function deliveryButtonLabel(mode: DeliveryMode, count: number): string {
  return mode === "zip"
    ? `ZIPファイルを作成（${count}件）`
    : "ダウンロード用ファイルを作成";
}
