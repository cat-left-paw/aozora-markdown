import type { PreviewNoticeCode } from "./model.js";
import { PREVIEW_LIMITS } from "./protocol.js";
import type { PreviewMode, PreviewView } from "./session.js";
import type { SourceWindow } from "./source.js";

const n = (v: number) => v.toLocaleString("ja-JP");
const size = (v: number) => `${n(v)} bytes`;

export const NOTICE_TEXT: Record<PreviewNoticeCode, string> = {
  "frontmatter-invalid":
    "frontmatterとして読み取れないため、その部分は原文のまま表示しています。",
  "frontmatter-unclosed":
    "frontmatterが閉じていないため、文書全体を原文のまま表示しています。",
  "image-not-loaded":
    "画像は読み込みません。代替テキストと画像の場所を文字で表示しています。",
  "link-not-opened":
    "リンクは開けません。表示名とリンク先を文字で表示しています。",
  "tcy-horizontal":
    "縦中横（｟｠）は横書きでは普通の横並びで表示します。縦書きでの見た目ではありません。",
};

/** Mode-specific wording; the notice codes themselves come from the Worker model. */
const VERTICAL_NOTICE_TEXT: Partial<Record<PreviewNoticeCode, string>> = {
  "tcy-horizontal":
    "縦中横（｟｠）は1文字分の幅に詰めて横並びにしています。桁が多いと小さく見えます（参考表示）。",
};

export function noticeTexts(
  codes: readonly PreviewNoticeCode[],
  mode: PreviewMode,
): string[] {
  return codes.map(
    (code) =>
      (mode === "vertical" ? VERTICAL_NOTICE_TEXT[code] : undefined) ??
      NOTICE_TEXT[code],
  );
}

const SHARED_HINT =
  ".txt出力にも同じMarkdown・Nyoze記法が入っているため、同じプレビューを使います。閲覧は、ダウンロードの選択を変えません。";
export const MODE_HINT_TEXT: Record<PreviewMode, string> = {
  horizontal: `横書きの参考表示です。Nyoze・Obsidianなどでの見た目と同じになるとは限りません。${SHARED_HINT}`,
  vertical: `縦書きの参考表示です。Nyozeなどの縦書き表示や組版と、字詰め・ページ割り・禁則処理が同じになるとは限りません。${SHARED_HINT}`,
};

export const VERTICAL_GUIDE_TEXT =
  "右端の行から読み始め、行は右から左へ進みます。枠の上でホイールを下へ回すと次の行（左）へ、上へ回すと前の行（右）へ移ります。枠を選んで ←・→ キーや PageDown・PageUp でも移動できます。端まで来ると、ホイールはページのスクロールに戻ります。文書情報（frontmatter）とコードは横書きの枠で表示し、枠に収まらない部分は枠の中でスクロールします。";

const LIMIT_TEXT = {
  nodes: `要素${n(PREVIEW_LIMITS.nodes)}個`,
  depth: `入れ子${PREVIEW_LIMITS.depth}段`,
  text: `文字数${n(PREVIEW_LIMITS.textUnits)}（UTF-16単位）`,
} as const;

export function previewStatusText(view: PreviewView): string {
  switch (view.status) {
    case "idle":
      return "";
    case "loading":
      return `プレビューを準備しています（最長${PREVIEW_LIMITS.timeoutMs / 1000}秒）。`;
    case "rendering":
      return "表示を組み立てています。";
    case "ready":
      return "プレビューを表示しています。";
    case "empty":
      return "空の文書です。表示する本文がありません（エラーではありません）。";
    case "limit":
      return view.limit === "input-bytes"
        ? `この出力は${size(view.target?.bytes.byteLength ?? 0)}で、プレビューの上限（${PREVIEW_LIMITS.inputBytes / 1048576} MiB）を超えるため、表示の準備をしません。「出力テキスト」で先頭を確認するか、ダウンロードして全文を確認してください。`
        : `表示の上限（${LIMIT_TEXT[view.limit ?? "nodes"]}）を超えたため、プレビューを表示しません。「出力テキスト」またはダウンロードで確認してください。変換結果は変わっていません。`;
    case "timeout":
      return `${PREVIEW_LIMITS.timeoutMs / 1000}秒以内に表示の準備が終わらなかったため、中止しました。${PREVIEW_LIMITS.inputBytes / 1048576} MiB以下でも、複雑な文書では時間内に終わらないことがあります。もう一度試すか、「出力テキスト」で確認してください。`;
    case "cancelled":
      return view.cancelCause === "busy"
        ? "変換または出力の作成を始めたため、プレビューを中止しました。処理が終わったら、もう一度表示できます。"
        : "プレビューを中止しました。";
    case "failed":
      switch (view.failure) {
        case "worker-unavailable":
        case "worker-failed":
          return "プレビュー用のWorkerを読み込めませんでした（配信を確認してください）。変換結果とダウンロードには影響しません。";
        case "invalid-result":
          return "プレビューの結果を検証できなかったため、表示しません。変換結果とダウンロードには影響しません。";
        case "invalid-utf8":
          return "UTF-8として読めない内容のため、プレビューできません。";
        default:
          return "プレビューを作れませんでした。変換結果とダウンロードには影響しません。";
      }
  }
}

export function sourceStatusText(w: SourceWindow): string {
  if (!w.totalBytes) return "空の出力です（0 bytes）。";
  return w.truncated
    ? `先頭の${size(w.shownBytes)}だけを表示しています（全体は${size(w.totalBytes)}）。全文ではありません。全文はダウンロードで確認してください。`
    : `全文（${size(w.totalBytes)}）を表示しています。ダウンロードされる内容と同じです。`;
}
