const descriptions: Readonly<Record<string, string>> = {
  INVALID_INPUT: "入力形式を確認してください。TXT・MD・ZIPに対応しています。",
  LIMIT_EXCEEDED:
    "処理上限を超えました。入力を分けるか、小さなファイルで再試行してください。",
  ZIP_INVALID: "ZIPの構造またはデータを確認できませんでした。",
  ZIP_HEADER_MISMATCH: "ZIP内の記録に矛盾があります。",
  ZIP_AMBIGUOUS: "ZIPの構造を一意に判断できませんでした。",
  UNSAFE_ZIP_ENTRY:
    "安全に扱えないパスや属性を含むため、このZIPを処理しませんでした。",
  ZIP_UNSUPPORTED: "このZIPの方式は対応していません。",
  ZIP_FILENAME_ENCODING: "ZIP内のファイル名を正しく読み取れませんでした。",
  ZIP_UNICODE_PATH_IGNORED:
    "ZIP内の補助ファイル名を使わず、基本名を採用しました。",
  DECODE_FAILED:
    "文字コードを読み取れませんでした。文字コード設定を確認してください。",
  ENCODING_BOM_CONFLICT: "BOMと指定文字コードが一致しません。",
  FRONTMATTER_PARSE_FAILED:
    "frontmatterを解釈できないため、元の内容を保持しました。",
  FRONTMATTER_INVALID_TYPE:
    "frontmatterの値の型を確認できないため、元の内容を保持しました。",
  EMPHASIS_NOT_CONVERTED: "太字・斜体に安全に変換できない注記を保持しました。",
  UNDERLINE_NOT_CONVERTED: "傍線に安全に変換できない注記を保持しました。",
  HEADING_TARGET_MISMATCH: "見出しの対象が一致しないため、注記を保持しました。",
  BOUTEN_RUBY_CONTEXT: "ルビを壊さないよう、傍点の注記を保持しました。",
  BOUTEN_NOT_CONVERTED:
    "傍点が縦中横の括弧や本体を分解してしまうため、注記を保持しました。",
  TCY_NOT_CONVERTED:
    "縦中横に変換できない注記を保持しました。対象は直前の半角英数字または ! ? の1〜4文字です。",
  INVALID_UTF8:
    "UTF-8として読み取れませんでした。文字コード設定を確認してください。",
  BOM_CONFLICT: "BOMと指定文字コードが一致しません。",
  WORKER_UNAVAILABLE:
    "Workerを利用できません。対応ブラウザとHTTP配信を確認してください。",
  WORKER_FAILED:
    "処理用Workerを読み込めませんでした。再読み込みしても続く場合は配信ファイルを確認してください。",
  FILE_OR_WORKER_FAILED: "入力の読込またはWorkerの開始に失敗しました。",
  JOB_TIMEOUT:
    "準備時間の上限に達しました。入力を小さくして再試行してください。",
  BLOB_FAILED: "出力の準備に失敗しました。再試行してください。",
  CANCELLED: "処理を中止しました。",
  REMAINING_AOZORA_NOTES:
    "未変換の青空文庫注記が残っています。OFFにした処理の注記も含みます。未変換注記の一覧を確認してください。",
  INVALID_FRONTMATTER:
    "frontmatterを解釈できないため、元の内容を保持しました。",
  FRONTMATTER_INVALID:
    "frontmatterを解釈できないため、元の内容を保持しました。",
  UNCLOSED_ANNOTATION_BLOCK:
    "注記説明ブロックが閉じていないため、削除せず保持しました。",
  FOOTER_CANDIDATE_PRESERVED:
    "末尾情報の境界が曖昧なため、本文を保持しました。",
  OUTPUT_BYTES_LIMIT:
    "出力の容量上限を超えました。選択を減らして再試行してください。",
  INPUT_BYTES_LIMIT: "選択した出力の合計容量が上限を超えました。",
  FILE_BYTES_LIMIT: "1件の出力容量が上限を超えました。",
  PATH_LIMIT: "出力パスが長すぎます。",
  PATH_COLLISION: "出力パス同士が衝突しています。",
  UNSAFE_PATH: "出力パスを安全に扱えません。",
  INVALID_OPTION:
    "設定の値を確認できませんでした。設定を初期値に戻して再試行してください。",
  INVALID_WORKER_RESULT:
    "Workerの応答を確認できませんでした。再読み込みして再試行してください。",
};
const tcyReasons: Readonly<Record<string, string>> = {
  empty: "縦中横の引用が空です。注記からは本文を作りません。",
  "invalid-body":
    "縦中横の対象は、半角の英字・数字・!・? の1〜4文字だけです。全角・空白・絵文字などは変換しません。",
  "target-mismatch":
    "縦中横の引用と、直前の同じ行の文字が一致しないため、注記を保持しました。",
  "ruby-context": "ルビの途中なので、縦中横へは変換しません。",
  "existing-tcy": "既にある縦中横の内側や直後は、重ねて変換しません。",
};
export function explain(code: string, details?: { reason?: unknown }): string {
  const reason = typeof details?.reason === "string" ? details.reason : "";
  if (code === "TCY_NOT_CONVERTED" && tcyReasons[reason])
    return tcyReasons[reason];
  if (code === "BOUTEN_NOT_CONVERTED" && reason === "tcy-overlap")
    return descriptions.BOUTEN_NOT_CONVERTED;
  return (
    descriptions[code] ??
    "処理中の診断があります。識別コードと詳細を確認してください。"
  );
}
export function severityLabel(value: string): string {
  return value === "error" ? "エラー" : "警告";
}
