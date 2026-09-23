import type { ConversionSettings } from "./options.js";
import type { HeadingLevels } from "../src/index.js";
import { VERTICAL_GUIDE_TEXT } from "./preview/messages.js";

/** Visible picker copy. Views write these strings; they are the selection explanation. */
export const PICKER_FORMATS = "TXT・MD・ZIP／複数選択可";
export const PICKER_REPLACE = "選び直すと一覧を置換。取消は現在の選択を保持。";
export const DETAILS_TITLE = "注記・装飾・本文整理の詳細設定";
export const DETAILS_OPEN_LABEL = "詳細設定を開く";
export const DETAILS_CLOSE_LABEL = "詳細設定を閉じる";
export const DETAILS_BRIEF =
  "外字・末尾情報・注記説明の整理、装飾と見出し、Nyoze向けの配置を調整します。";
export const NO_CONTENT_CONVERSION =
  "本文の変換なし。文字コードはUTF-8、改行はLFで出力します。";
export const REMAINING_NOTES_LABEL = "未変換注記（OFFにした処理の注記を含む）";

export type HelpGroup =
  | "basic"
  | "body"
  | "decoration"
  | "nyoze"
  | "action"
  | "output";

export interface HelpTopic {
  id: string;
  apiField: string;
  label: string;
  summary: string;
  detail: string;
  group: HelpGroup;
  control: "boolean" | "select" | "text" | "button" | "radio";
  optionKey?: keyof ConversionSettings;
  parent?: keyof ConversionSettings;
  /** Level select for one heading kind (child of convertHeadings). */
  levelKey?: keyof HeadingLevels;
}

/**
 * S5 label / always-visible summary / supplemental detail / API field map.
 * Summaries state the current aozora-ts-v3 behavior. Details add examples and limits.
 */
export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "usage",
    apiField: "ui.usage",
    label: "使い方",
    summary: "ファイル選択からダウンロードまでの流れを確認します。",
    detail:
      "1. TXT・MD・ZIPを選び、必要なら設定を変更します。\n2. 「変換を開始」を押し、出力・失敗した入力・未変換注記を確認します。\n3. 出力を選んで受け取り用ファイルを作成し、「ダウンロード」を押します。",
    group: "action",
    control: "button",
  },
  {
    id: "encoding",
    apiField: "encoding",
    label: "入力ファイルの文字コード",
    summary:
      "通常は自動判定です。入力の文字コードが分かっているときだけ指定します。出力は常にUTF-8です。",
    detail:
      "自動は、UTF-8、次にCP932、その次にShift_JISの順で厳密に読みます。符号を指定したときは、その符号だけを試します。UTF-16などは読めません。.md・.txtのどちらもUTF-8・改行LFで出力し、BOMは付けません。",
    group: "basic",
    control: "select",
  },
  {
    id: "outputExtension",
    apiField: "outputExtension",
    label: "出力拡張子",
    summary:
      "拡張子が変わっても変換内容は同じです。TXTにもMarkdown・Nyozeの記法が含まれます。",
    detail:
      "選べるのは .md と .txt です。入力がTXTでもMDでも、本文・警告・未変換注記は同じで、変わるのは出力ファイルの拡張子と種類だけです。記法を残したくないときは、下の各変換をOFFにしてください。入力と同じ名前になるときは _converted を付け、上書きしません。",
    group: "basic",
    control: "radio",
  },
  {
    id: "addFrontmatter",
    apiField: "conversion.addFrontmatter",
    label: "タイトル・著者などを文書先頭の情報欄に記録",
    summary:
      "元テキストから読めた題名や著者を、文書先頭のYAML情報欄へ記録します。.txt出力でも同じです。OFFにしても、既にある情報欄は消しません。",
    detail:
      "生成例:\n---\ntitle: 題名\nauthor: 著者名\n---\n既に情報欄があり、解釈できないときは元のまま残します。このOFFは、既存の情報欄を削除する操作ではありません。",
    group: "basic",
    control: "boolean",
    optionKey: "addFrontmatter",
  },
  {
    id: "organizeByAuthor",
    apiField: "organizeByAuthor",
    label: "著者別の出力フォルダ",
    summary:
      "出力先のフォルダ分けです。ZIPで受け取るとき、著者名のフォルダが中に入ります。1件をそのまま受け取るときはファイル名だけです。",
    detail:
      "ファイルの移動やVaultの作成は行いません。著者を読めないときは unknown_author を使います。.md・.txtのどちらでも同じフォルダ分けです。単体ダウンロードの名前にフォルダは含まれません。",
    group: "basic",
    control: "boolean",
  },
  {
    id: "convertGaiji",
    apiField: "conversion.convertGaiji",
    label: "外字注記を文字に変換",
    summary:
      "「※［＃…］」の外字注記を、対応する文字に置き換えます。OFFのときは注記のまま残します。",
    detail:
      "例: ※［＃「米＋羔」、U+7CD5］ → 糕。JIS面区点やUnicodeの指定から、確実に決まる文字だけを使います。決まらない注記は元のまま残し、未変換注記として数えます。",
    group: "body",
    control: "boolean",
    optionKey: "convertGaiji",
  },
  {
    id: "removeAozoraFooter",
    apiField: "conversion.removeAozoraFooter",
    label: "青空文庫の末尾情報を除去",
    summary:
      "底本や、入力・校正・作成日などの末尾情報を、境界が明確なときだけ除きます。",
    detail:
      "本文中の注記をまとめて消す設定ではありません。末尾の境界が曖昧なときは本文を残し、警告を出します。",
    group: "body",
    control: "boolean",
    optionKey: "removeAozoraFooter",
  },
  {
    id: "removeAnnotationBlocks",
    apiField: "conversion.removeAnnotationBlocks",
    label: "注記の説明区間を除去",
    summary:
      "ダッシュ行で囲まれた注記の説明区間を除きます。作品中の個々の注記を、この設定だけで一括では消しません。",
    detail:
      "開きと閉じが対になっている区間が対象です。閉じていない場合は削除せず、警告を残します。",
    group: "body",
    control: "boolean",
    optionKey: "removeAnnotationBlocks",
  },
  {
    id: "addHeaderToBody",
    apiField: "conversion.addHeaderToBody",
    label: "タイトル・著者などを本文にも残す",
    summary:
      "新しく情報欄を作るとき、題名や著者の行を本文にも残します。既にある情報欄から、本文へ戻すこともあります。",
    detail:
      "OFFで新しく情報欄を作ると、読んだ見出し行は本文から情報欄へ移ります。ONではその行を本文に残したまま情報欄も付けます。既に情報欄がある文書でONにすると、本文の先頭近くに同じ題名が無い場合だけ、題名や著者を本文へ戻します。既存の情報欄は削除しません。",
    group: "body",
    control: "boolean",
    optionKey: "addHeaderToBody",
  },
  {
    id: "convertTcy",
    apiField: "conversion.convertTcy",
    label: "縦中横をNyoze形式に変換",
    summary:
      "後置の縦中横注記を、Nyozeの縦中横（例: 12 → ｟12｠）へ変換します。表示先がその記法に対応している必要があります。",
    detail:
      "対象は、注記の直前にある半角の英字・数字・!・? の1〜4文字です。例: 12［＃「12」は縦中横］ → ｟12｠。全角文字、ローマ数字、空白、絵文字、5文字以上、空の引用、注記だけの行は変換せず残します。OFFのときは注記のまま残します。",
    group: "decoration",
    control: "boolean",
    optionKey: "convertTcy",
  },
  {
    id: "convertMarkdownEmphasis",
    apiField: "conversion.convertMarkdownEmphasis",
    label: "太字・斜体を変換",
    summary: "「太字」「斜体」の注記を、Markdownの太字・斜体へ変換します。",
    detail:
      "例: 青［＃「青」は太字］ → **青**。斜体は *青* です。対象が一致しない箇所や、* を含むため安全に変換できない箇所は、元の注記のまま残します。すべての強調記法が対象ではありません。",
    group: "decoration",
    control: "boolean",
    optionKey: "convertMarkdownEmphasis",
  },
  {
    id: "convertUnderline",
    apiField: "conversion.convertUnderline",
    label: "傍線を変換",
    summary: "「傍線」の注記を、選んだ形式の傍線へ変換します。",
    detail:
      "Nyoze形式は ||青||、HTML形式は <u>青</u> です。表示先が、その記法に対応している必要があります。既に同じ記法で囲まれている箇所は、重ねて変換しません。",
    group: "decoration",
    control: "boolean",
    optionKey: "convertUnderline",
  },
  {
    id: "underlineOutputFormat",
    apiField: "conversion.underlineOutputFormat",
    label: "傍線の出力形式",
    summary:
      "傍線を Nyoze の ||text|| にするか、HTML の <u>text</u> にするかを選びます。",
    detail:
      "形式の選択であり、元の線の種類まで書き分けるものではありません。親の「傍線を変換」がOFFのときは選べませんが、選んだ値は保持します。",
    group: "decoration",
    control: "select",
    optionKey: "underlineOutputFormat",
    parent: "convertUnderline",
  },
  {
    id: "approximateOtherUnderlineStyles",
    apiField: "conversion.approximateOtherUnderlineStyles",
    label: "特殊傍線を近似",
    summary:
      "二重傍線や波線などの、通常の傍線以外の線種を、通常の傍線として近似します。元の線種の区別は残りません。",
    detail:
      "「二重傍線」「波線」「鎖線」などを、選んだ傍線形式へ寄せます。どの線種だったかは出力に残りません。左に付く線は、「左傍線を近似」もONのときだけ対象です。対応しない形は注記のまま残ります。",
    group: "decoration",
    control: "boolean",
    optionKey: "approximateOtherUnderlineStyles",
    parent: "convertUnderline",
  },
  {
    id: "approximateLeftUnderline",
    apiField: "conversion.approximateLeftUnderline",
    label: "左傍線を近似",
    summary:
      "「左に傍線」などを通常の傍線として近似します。左右の区別は残りません。",
    detail:
      "OFFのときは左に付く傍線を変換せず、注記のまま残します。ONにすると通常の傍線と同じ出力になり、左にあったことは分かりません。",
    group: "decoration",
    control: "boolean",
    optionKey: "approximateLeftUnderline",
    parent: "convertUnderline",
  },
  {
    id: "convertBouten",
    apiField: "conversion.convertBouten",
    label: "傍点をルビ形式に変換",
    summary:
      "傍点の注記を、各文字に記号をルビとして付ける形へ変換します。OFFのときは注記のまま残します。",
    detail:
      "例: 青［＃「青」に傍点］ → ｜青《﹅》。ルビを壊す位置や非対応の形は、ONでも元の注記のまま残します。",
    group: "decoration",
    control: "boolean",
    optionKey: "convertBouten",
  },
  {
    id: "boutenChar",
    apiField: "conversion.boutenChar",
    label: "傍点に使う文字",
    summary:
      "傍点の注記で各文字に付ける記号です。空欄なら既定の「﹅」です。空白も記号として有効です。",
    detail:
      "先頭のUnicode文字だけを使います。後ろの文字は無視します。前後の空白は削除せず、1文字制限で絵文字を分割しません。親の「傍点をルビ形式に変換」がOFFのときは変更できませんが、入力した記号は保持します。",
    group: "decoration",
    control: "text",
    optionKey: "boutenChar",
    parent: "convertBouten",
  },
  {
    id: "convertHeadings",
    apiField: "conversion.convertHeadings",
    label: "見出しを変換",
    summary:
      "大見出し・中見出し・小見出しの注記を、Markdownの # 見出しへ変換します。OFFのときは注記のまま残します。",
    detail:
      "例: 章［＃「章」は大見出し］ → ## 章。対象の文字が一致しない注記や、窓見出しなどの非対応の形は変換しません。字下げ付きの見出しは、# の後に全角空白の字下げを残します。",
    group: "decoration",
    control: "boolean",
    optionKey: "convertHeadings",
  },
  ...(
    [
      ["large", "大見出し", 2],
      ["medium", "中見出し", 3],
      ["small", "小見出し", 4],
    ] as const
  ).map(
    ([key, name, level]): HelpTopic => ({
      id: "headingLevel-" + key,
      apiField: "conversion.headingLevels." + key,
      label: `${name}のレベル`,
      summary: `${name}に付ける # の数（1〜6）です。既定は${level}（${"#".repeat(level)}）です。`,
      detail:
        "大・中・小の順序が逆でも、同じでも、そのまま使います。自動では直しません。親の「見出しを変換」がOFFのときは選べませんが、選んだレベルは保持します。",
      group: "decoration",
      control: "select",
      parent: "convertHeadings",
      levelKey: key,
    }),
  ),
  {
    id: "convertNyozeIndent",
    apiField: "conversion.convertNyozeIndent",
    label: "Nyozeの字下げ記法に変換",
    summary:
      "字下げの注記を、Nyozeの :::indent-N 記法へ変換します。表示先がその記法に対応している必要があります。",
    detail:
      "例: ［＃３字下げ］の行は :::indent-3 で囲みます。対応しない字下げや、コードとして保護された部分は変換しません。",
    group: "nyoze",
    control: "boolean",
    optionKey: "convertNyozeIndent",
  },
  {
    id: "preserveIndentNotes",
    apiField: "conversion.preserveIndentNotes",
    label: "字下げの元注記を保持",
    summary:
      "字下げを変換したあとも、元の注記を残します。意図して残した注記は、未変換注記の一覧から除きます。",
    detail:
      "変換できなかった注記とは別です。保持した注記は、未変換注記としては数えません。親の字下げ変換がOFFのときは変更できませんが、ON/OFFの値は保持します。",
    group: "nyoze",
    control: "boolean",
    optionKey: "preserveIndentNotes",
    parent: "convertNyozeIndent",
  },
  {
    id: "convertNyozeAlignEnd",
    apiField: "conversion.convertNyozeAlignEnd",
    label: "Nyozeの地付き記法に変換",
    summary:
      "地付きの注記を、Nyozeの :::align-end 記法へ変換します。表示先の対応が必要です。",
    detail:
      "「地付き」を行末寄せの記法へ変換します。字数を指定した地付きは、下の近似をONにしない限り対象にしません。",
    group: "nyoze",
    control: "boolean",
    optionKey: "convertNyozeAlignEnd",
  },
  {
    id: "approximateJiage",
    apiField: "conversion.approximateJiage",
    label: "地からN字上げを地付きに近似",
    summary:
      "「地からN字上げ」を、指定の字数を捨てて地付きと同じ記法に近似します。",
    detail:
      "何文字上げたかは出力に残りません。出力は :::align-end です。近似しない場合は元の注記を残します。",
    group: "nyoze",
    control: "boolean",
    optionKey: "approximateJiage",
    parent: "convertNyozeAlignEnd",
  },
  {
    id: "preserveAlignNotes",
    apiField: "conversion.preserveAlignNotes",
    label: "地付きの元注記を保持",
    summary:
      "地付きを変換したあとも元の注記を残します。意図して残した注記は、未変換注記の一覧から除きます。",
    detail:
      "変換できなかった注記とは別です。親の地付き変換がOFFのときは変更できませんが、値は保持します。",
    group: "nyoze",
    control: "boolean",
    optionKey: "preserveAlignNotes",
    parent: "convertNyozeAlignEnd",
  },
  {
    id: "convertNyozePageBreak",
    apiField: "conversion.convertNyozePageBreak",
    label: "Nyozeの改ページ記法に変換",
    summary:
      "改ページの注記を :::page-break、空ページは :::blank-page へ変換します。表示先の対応が必要です。",
    detail:
      "［＃改ページ］と、空行を挟んだ改ページの組が対象です。改丁・改見開きは、下の近似がOFFのときは変換しません。",
    group: "nyoze",
    control: "boolean",
    optionKey: "convertNyozePageBreak",
  },
  {
    id: "approximateSpreadBreaks",
    apiField: "conversion.approximateSpreadBreaks",
    label: "改丁・改見開きを改ページに近似",
    summary: "改丁と改見開きを、区別せず改ページと同じ記法に近似します。",
    detail:
      "出力はどちらも :::page-break です。改丁だったか改見開きだったかは残りません。近似しない場合は元の注記を残します。",
    group: "nyoze",
    control: "boolean",
    optionKey: "approximateSpreadBreaks",
    parent: "convertNyozePageBreak",
  },
  {
    id: "preservePageBreakNotes",
    apiField: "conversion.preservePageBreakNotes",
    label: "改ページの元注記を保持",
    summary:
      "改ページを変換したあとも元の注記を残します。意図して残した注記は、未変換注記の一覧から除きます。",
    detail:
      "変換できなかった注記とは別です。親の改ページ変換がOFFのときは変更できませんが、値は保持します。",
    group: "nyoze",
    control: "boolean",
    optionKey: "preservePageBreakNotes",
    parent: "convertNyozePageBreak",
  },
  {
    id: "pick-files",
    apiField: "ui.files",
    label: "ファイルを選ぶ",
    summary: `${PICKER_FORMATS}。${PICKER_REPLACE}`,
    detail:
      "ボタンから選択画面を開きます。選び直すと、今の一覧を新しい選択で置き換えます。選択画面を取り消すと、今の一覧をそのまま残します。同じファイルを再度選ぶこともできます。",
    group: "action",
    control: "button",
  },
  {
    id: "clear",
    apiField: "ui.clear",
    label: "全クリア",
    summary: "選んだファイルと変換結果を消し、設定は残します。",
    detail:
      "「削除」は一覧の1件だけを外します。「処理を中止」は、進行中の変換や作成を止め、入力一覧は残します。全クリアは入力と結果の両方を消し、設定は戻しません。",
    group: "action",
    control: "button",
  },
  {
    id: "remove-file",
    apiField: "ui.removeFile",
    label: "削除",
    summary: "この1件だけを入力一覧から外します。",
    detail:
      "最後の1件を削除すると未選択に戻ります。他のファイルと設定は残ります。進行中は削除できません。",
    group: "action",
    control: "button",
  },
  {
    id: "reset-settings",
    apiField: "ui.resetSettings",
    label: "設定を初期値に戻す",
    summary: "変換の設定だけを初期値に戻します。選んだファイルは残します。",
    detail:
      "初期値は公開APIの既定と同じです。戻すと、それまでの変換結果は無効になり、もう一度変換が必要です。",
    group: "action",
    control: "button",
  },
  {
    id: "start-import",
    apiField: "ui.startImport",
    label: "変換を開始",
    summary: "選んだファイルを、今の設定で変換します。",
    detail:
      "処理はこのブラウザの中で行い、ファイルを外部へ送りません。変換が終わるまで、受け取り用のファイルは作れません。",
    group: "action",
    control: "button",
  },
  {
    id: "cancel-job",
    apiField: "ui.cancel",
    label: "処理を中止",
    summary: "進行中の変換、または出力ファイルの作成を止めます。",
    detail:
      "変換を止めると、その回の出力はありません。作成を止めたときは、変換結果と選択を保持します。入力一覧は消えません。",
    group: "action",
    control: "button",
  },
  {
    id: "select-all",
    apiField: "ui.selectAll",
    label: "全出力を選択",
    summary: "表示中のページだけでなく、すべての出力を選択します。",
    detail: "受け取り方法は、選んだ件数に合わせて決まり直します。",
    group: "action",
    control: "button",
  },
  {
    id: "select-none",
    apiField: "ui.selectNone",
    label: "選択を解除",
    summary: "すべての出力の選択を外します。変換結果は残ります。",
    detail:
      "作成済みの受け取りファイルは無効になります。変換結果そのものは消えません。",
    group: "action",
    control: "button",
  },
  {
    id: "inspect-output",
    apiField: "ui.inspect",
    label: "警告・注記を確認",
    summary: "その出力に残った警告と注記を開きます。",
    detail:
      "注記の行番号は出力の行です。警告の位置は元の入力の文字位置で、行番号とは別です。",
    group: "action",
    control: "button",
  },
  {
    id: "preview-output",
    apiField: "ui.preview",
    label: "プレビュー",
    summary:
      "変換済みの1件を、ダウンロード前に横書きまたは縦書きで確認します。選択は変わりません。",
    detail:
      "ダウンロードされる内容そのものを読み取って表示し、変換し直しません。「プレビュー」で横書き／縦書きと、本文のゴシック／明朝を切り替えます（このページの間だけ保持し、再読み込みでは横書き・ゴシックに戻ります）。縦書きのときは「縦書きの操作」で読み方を開けます。「出力テキスト」は常に横書き・等幅で、同じ内容を文字のまま確認できます（先頭128 KiBまで）。縦書きは文芸本文の参考表示で、Nyozeなどの組版・禁則とは一致しません。frontmatterとコードは縦書きの中でも横書きの枠で表示し、書体の切替対象にしません。4 MiBを超える出力や、表示の上限を超える出力はプレビューせず、出力テキストとダウンロードで確認します。",
    group: "action",
    control: "button",
  },
  {
    id: "preview-vertical-ops",
    apiField: "ui.preview.verticalOps",
    label: "縦書きの操作",
    summary:
      "縦書きプレビューの読み始め、ホイール、キー、横書きの枠を説明します。",
    detail: VERTICAL_GUIDE_TEXT,
    group: "action",
    control: "button",
  },
  {
    id: "delivery-single",
    apiField: "ui.delivery.single",
    label: "そのままのファイル",
    summary: "選んだ1件を、ファイル名だけの1ファイルとして受け取ります。",
    detail:
      "著者別フォルダは付きません。フォルダごと欲しいときは「ZIPにまとめる」を選んでください。既定はこちらです。",
    group: "output",
    control: "radio",
  },
  {
    id: "delivery-zip",
    apiField: "ui.delivery.zip",
    label: "ZIPにまとめる",
    summary: "選んだ出力を1つのZIPにします。フォルダ構成はZIPの中に残ります。",
    detail:
      "2件以上のときは、この方法だけです。1件でも、著者別フォルダを残して受け取りたいときに選べます。",
    group: "output",
    control: "radio",
  },
  {
    id: "create-output",
    apiField: "ui.createOutput",
    label: "受け取りファイルを作成",
    summary:
      "選んだ受け取り方法でファイルを作ります。作成だけでは保存は始まりません。",
    detail:
      "できたファイル名と容量を確認してから、「ダウンロード」を押してください。1件のときは「ダウンロード用ファイルを作成」、ZIPのときは件数付きの名前になります。",
    group: "output",
    control: "button",
  },
  {
    id: "download",
    apiField: "ui.download",
    label: "ダウンロード",
    summary:
      "作成済みファイルの保存を、ブラウザに依頼します。保存の完了は、この画面では断定しません。",
    detail:
      "開始後の保存状況はブラウザで確認してください。同じ作成結果から、もう一度ダウンロードできます。そのときは新しい受付になります。",
    group: "output",
    control: "button",
  },
];

const byId = new Map(HELP_TOPICS.map((topic) => [topic.id, topic]));

export function helpTopic(id: string): HelpTopic | undefined {
  return byId.get(id);
}

export const GROUP_CONTAINERS = {
  basic: "basic-booleans",
  body: "body-controls",
  decoration: "decoration-controls",
  nyoze: "nyoze-controls",
} as const;
