# Python Reference Analysis — 観測資料（非規範）

この文書は初回解析時のPython原本の観測を保存した資料です。**TypeScript版の要求仕様ではありません。** 文中の「維持」「変更しない」「互換要件」等は旧方針における説明であり、実装指示として使用しないでください。現行APIは[API](../API.md)、KEEP/FIX NOW/DEFERの判断は[改良判断](./improvement-decisions.md)、v3差分は[互換性差分](./compatibility-v3.md)を参照してください。

原本: aozora_zip_batch_gui.py（2,957行）、SHA-256: 4c45c5e777718e88815117e49db85ccb13e1dd4e35eba858e3eae958bd2f2cc0。CPython 3.12.8での観測。ここに記載された不具合は修正済みという意味ではありません。

## 2. Python Reference Implementation Analysis

### 2.1 構造

| 原本範囲 | 内容 | 移植先責務 |
| --- | --- | --- |
| L51–122 | 対象拡張子、パス検証、decode、UTF-8書込、同一パス、生成物名判定 | adapter / encoding |
| L124–307 | 外字、JIS codec呼び出し | core + generated data |
| L309–852 | 太字斜体、傍線 | core |
| L854–1109 | 見出し、傍点 | core |
| L1111–1712 | 字下げ、内部marker、地付き、改ページ | core |
| L1714–1922 | ヘッダー、定型注釈削除、footer | core |
| L1925–2185 | 残存scan/log、frontmatter、名前sanitize | core / pure naming policy |
| L2187–2220 | Options、JobStats | core options / batch statsに分割 |
| L2224–2639 | Worker: 順序、ログ、ZIP、読書き、batch進行 | pure pipeline + job adapter |
| L2643–2957 | PySide6画面・widget連動・QThread起動・結果表示 | 対象外。値と意味論のみ抽出 |

GUIを動かす必要はない。原本の関数群とWorkerをそのまま実行する[ハーネス](./reference_oracle.py)を用意した。過去のportable/tkinter派生版は今回の正本ではない。

本書の説明をregexの全境界条件の代わりにしない。[regex inventory](./fixtures/regex-inventory.json)には原本の55 compiled patternsとflagsをそのまま採取した。`_is_close_fence`の動的pattern等は原本関数を併読する。

### 2.2 正確な文書pipeline

各段階の出力文字列が次段階の入力。Markdown判定は`is_md OR (is_txt AND rename_to_md)`。既存MDはrename OFFでもMarkdown処理される。原本コメントの「見出し・傍点は外字直後」より、以下の実行順を優先する（L2307–2614）。

| 順 | 入力→出力 / 関数 | 条件 | TXT出力 | 後続依存 |
| --- | --- | --- | --- | --- |
| 1 | file bytes→Unicode text, encoding label / detect_and_read_text | 全文書 | 適用 | codec成功経路のみuniversal newline変換 |
| 2 | text→外字置換後text + C/U | 常時 | 適用 | metadata、filename、全converterへ影響 |
| 3 | suffix + rename→target extension / Markdown分岐 | 常時 | 判定のみ | `.TXT`→`.md`、既存拡張子は基本保持 |
| 4 | text→太字/斜体変換後text + 4 count | Markdownかつemphasis ON | 非適用 | 後続引用一致や安全判定へ影響 |
| 5 | text→傍線変換後text + 3 count | Markdownかつunderline ON | 非適用 | Nyoze/HTML記号が後続へ渡る |
| 6 | text→傍点ruby後text + C/U | Markdownで常時 | 非適用 | 見出しより先。OFF optionなし |
| 7 | text→ATX見出し後text + C/unsupported | Markdownで常時 | 非適用 | 見出し直前字下げはここで消費 |
| 8 | text→indent directive + C/U + optional markers | Markdownかつindent ON | 非適用 | 新規indent内部を後のalign/pageが保護 |
| 9 | text→align-end + C/A/U + markers | Markdownかつalign ON | 非適用 | 新規align内部を後のpageが保護 |
| 10 | text→page/blank directives + 5 count + markers | Markdownかつpage ON | 非適用 | blank pairが先、通常pageが後 |
| 11 | この時点のtext→命名metadata→target path | organize ON。OFFは元stem | 適用 | **footer/定型削除/frontmatter追加より前**のsnapshot |
| 12 | 各stage count→processing_log項目 | count非zero | 外字など | 表示順は一部処理順と異なる |
| 13 | text→footer削除後text + removed bool | remove_aozora_footer | 適用 | 定型block削除より先 |
| 14 | text→`-----`block削除後text | remove_annotations | 適用 | ONなら変更なしでも「注釈削除」をlogへ追加 |
| 15 | text→既存frontmatterの有無 | 全文書でparseを呼ぶ | 呼ぶ | 単に`---`があるだけでは認定しない |
| 16 | text→frontmatter追加/本文header保持・復元 | Markdownのみ、詳細3.M | 非適用 | scanの行番号はこの結果を基準 |
| 17 | marked final text→残存注記list | Markdownのみ | 非適用 | marker付き出現、fence、inline codeを除外 |
| 18 | text→exact marker wrapper除去 | Markdownのみ | 非適用 | 書込内容確定。scan後に行う |
| 19 | 残存list→JobStatsの注記file/count加算 | Markdown、残存あり | 非適用 | **write成功前**に加算 |
| 20 | options/log/path→need_write | 常時 | 適用 | 単純text equality判定ではない |
| 21 | target→同一source回避→UTF-8出力 | need_write | 適用 | 既存出力collision一般回避はしない |
| 22 | 成功/失敗/skip→JobStats・[OK]/[ERROR]/[SKIP]・残存[WARN] | 結果ごと | 適用 | 残存WARN行はwrite成功時だけemit |

`need_write = convert_utf8 OR is_md OR processing_logが非空 OR target_path != source（resolve比較）`。gaiji未変換だけではprocessing_logに入らず、他条件がすべてOFFならTXTはSKIP。UTF-8 OFFは出力encoding選択ではなく、この判定と成功ログの表示を変えるだけ。

stage統計は変換実行時点の値を保持する。後でfooter/定型注釈ごと削除されても減算しない。final residual countとは独立。

### 2.3 GUIから渡る全Optionsと既定値

以下は`Options`と`MainWindow.start_work`を照合済み。core名は提案名。

| Python option | default | 提案名/責務 |
| --- | --- | --- |
| convert_utf8 | true | adapter.convertUtf8: need_write/logだけ。writeは常にUTF-8 |
| rename_to_md | true | core.renameToMd + adapter拡張子決定 |
| process_loose_txt | true | adapter.processLooseText。実際はTXTとMD両方 |
| add_frontmatter | true | core.addFrontmatter |
| remove_annotations | true | core.removeAnnotationBlocks |
| remove_aozora_footer | true | core.removeAozoraFooter |
| add_header_to_body | false | core.addHeaderToBody |
| organize_by_author | false | adapter.organizeByAuthor + early metadata projection |
| bouten_char | `﹅` | core.boutenChar。GUI候補は`﹅`と`•` |
| convert_nyoze_indent | false | core.convertNyozeIndent |
| preserve_aozora_indent_notes | false | core.preserveIndentNotes |
| convert_nyoze_align_end | false | core.convertNyozeAlignEnd |
| approximate_aozora_jiage_as_align_end | false | core.approximateJiage |
| preserve_aozora_align_notes | false | core.preserveAlignNotes |
| convert_nyoze_page_break | false | core.convertNyozePageBreak |
| approximate_aozora_spread_breaks | false | core.approximateSpreadBreaks |
| preserve_aozora_page_break_notes | false | core.preservePageBreakNotes |
| convert_markdown_emphasis | true | core.convertMarkdownEmphasis |
| convert_aozora_underline | true | core.convertUnderline |
| underline_output_format | `nyoze` | core.underlineOutputFormat: `nyoze` / `html` |
| approximate_other_underline_styles | false | core.approximateOtherUnderlineStyles |
| approximate_left_underline | false | core.approximateLeftUnderline |

GUIは子項目をdisabledにしてもcheck値をクリアしない。start_workは`isChecked()`をそのまま渡す。したがってUI状態から「親OFFなら子値もfalse」と正規化しない。converter呼出しのgateが効く。一方既存MDのfrontmatter処理はrename OFFでも実行できる。既存FMからのheader復元はadd_frontmatter OFFでもadd_header_to_body ONなら実行する。

### 2.4 Batch、停止、ログ

JobStatsの7項目は`zips_found/zips_processed/files_converted/files_skipped/errors/files_with_remaining_notes/remaining_notes`。converterのC/Uはここには保存されずprocessing_logへ表示される。

folder: ZIPを先に`rglob('*.zip')`で採取し、looseは`*.txt`のlist + `*.md`のlistを採取。両listは処理開始前に確定。sortなし。ZIP→loose順。looseの`_converted\d*$` stemを除外するが、この除外はfiles_skippedを増やさずINFOだけ。出力directory、既存author directory、過去ZIPの平坦化出力は一律除外しない。単一ファイルの明示選択はprocess_loose_txtと`_converted`除外に関係なく処理する。

progressはZIP単位/loose file単位で、ZIP内file数ではない。開始時(0,max(1,total))、各jobの**処理前**にstepを増やす。単一入力は(0,1)→(1,1)。stopはdirectory job境界で見る。現在処理中のZIP内loopやtext converterは中断しない。run最外側例外はerrors++して終了、finallyでfinishedをemitする。

processing_log順: 外字→bold→italic→both→emphasis未変換→下線→傍線近似→傍線未変換→見出し→未対応見出し→傍点→傍点未変換→字下げ→字下げ未変換→地付き→近似→未変換→page→blank→spread→page未変換→改段→footer削除→注釈削除→FM/header操作。**傍点と見出しのログ順は実行順の逆**。外字未変換は成功logの最後に追加、またはSKIP文へ付記。近似/未変換stage countを勝手にerrorや[WARN]へ格上げしない。

## 3. Observable Behavior Specification

以下のCはconverted、Uはunconverted、Aはapproximated。名前は同じでも母数はconverterごとに違う。対象外の構文が残っても専用Uに入らない場合があり、最終scanが安全網になる。単体関数はI/Oもwarning emitもしない。

### A. Pipelineと共通非要件

2.2の順を固定。青空rubyそのものの一般変換、挿絵注記の画像取り込み、Markdown構文解析、任意のHTMLサニタイズ、見出し番号生成、改行全体の整形は実装されていない。追加しない。テキスト全体にconverterをかけるため、header/frontmatter/fenceの内側も各converterの独自条件で変換され得る。

### B. 外字（L124–307）

1. substitute形式を先に走査: `［＃「quoted」はinner］`、quotedは空でない。innerにU+か面区点らしい指定がなければ対象外、C/Uとも増やさない。
2. 次に`※［＃([^］]*)］`を置換。中身は改行も許容する。一般の`［＃…］`へ広げない。
3. inner中の全角数字0–9のみASCIIへtranslate。NFKCなどはしない。
4. 最初の`U+`/`u+` + 1～6 hex桁（後続hex境界付き）を試す。制御値U+0000–001F、007F、0080–009F、surrogate D800–DFFF、10FFFF超は不可。U+0020、PUA、noncharacterは許可。不正U+ならJISへfallbackするが、2番目のU+は探さない。
5. `第[34]水準(?:漢字)?plane-row-cell`を最初の1つ検索。各群はPythonの`\d{1,3}`、separatorは`-`か`－`。ここで見つかれば変換失敗しても結果を返し、後のbare形式は試さない。第3/第4という名称とplane値の整合検証はしない。
6. 前項がなければbare `[12]-row-cell`を検索。前後の数字境界は`[0-9]`のみ。説明中の日付の一部などへの食い込みを抑えるが、一般的な日付検証ではない。
7. plane 1/2、row/cell 1..94を許容。plane1のbytesはrow+0xA0,cell+0xA0、plane2は先頭0x8F追加。`euc_jis_2004`strict decode、例外/空/U+FFFDがあれば不可。結果は**文字列**で、2 code pointsもあり得る。
8. substituteは現在の`text[pos:match.start()]`の末尾がquotedと一致する場合だけ、その末尾と注記をUnicode結果で置換。全文先頭まで逆探索しない。前のmatchで区切ったsegmentを越えない。コード指定ありの不一致/変換不可はU++し原文保持。
9. `※`形式は成功C++、失敗U++。削除、`?`、replacement characterへの置換はない。fence/inline code/既存rubyの保護はない。

実測例: `※［＃第3水準1-84-77］`→`挘`、`※［＃第4水準2-12-11］`→`𢌞`、`１［＃「１」はローマ数字、1-13-21］`→`Ⅰ`、`※［＃1-4-87］`→U+304B U+309A（`か゚`）、`※［＃2-2-15］`→`˘`（JIS X 0212 fallback）。未知外字はそのままU=1。

### C. 文字コード（L70–91）

順は`cp932`→`shift_jis`→`utf-8-sig`→`utf-8`、すべてread_textのstrict。各段でdecodeだけでなくI/O例外もcatchして次へ進む。すべて失敗ならread_bytesを`cp932(errors='ignore')`でdecodeしlabelを`cp932(ignore)`にする。それも失敗なら(None,None)。

strict read_textはCRLF/CRをLFへ変換する。最後のraw bytes fallbackは**改行変換しない**。BOMを明示優先する処理はない。UTF-8 BOMなしもutf-8-sigが成功すればlabelはutf-8-sig。ASCIIはcp932となる。

実測: UTF-8の`あい`（hex `e38182e38184`）をCP932として先に読めるため`縺ゅ＞`になる。hex `813081`はfallbackで`0`、`81300d0a0d`は`0\r\n\r`。既存MarkdownもZIP内TXTも同じdecoderを使う。

coreはdecoded stringをそのまま受け取り、勝手な改行正規化をしない。adapterの`decodeReferenceBytes`がencoding labelとnewline経路を再現する。BrowserのFile.textやVault.read済みstringだけではこのbyte互換を保証できない（4.2）。

### D. Markdown emphasis（L309–565）

種類: forwardは`太字`、`斜体`、`斜体字`。inline/blockは`太字`と`斜体`のみ。

非fence行で、(1)同一quotedへ隣接する相補的な2注記→`***…***`、(2)単独forward→`**…**`/`*…*`、(3)異種nested inline→`***…***`、(4)bold range、(5)italic rangeの順。forwardはsegment直前一致、空でなく`*`を含まないことが必要。

rangeは`［＃太字］body［＃太字終わり］`等。通常rangeのbodyに`［＃`、LF、CR、`*`、空文字があれば保持。nestedは開始2個と逆順end2個が直接隣接し異種である場合だけ対応。bodyの`［＃`をregexで除外。Pythonの`.`はCRを含むため**nestedだけはbodyのCRを排除していない**。同種nested、交差、部分重複は汎用入れ子構文として扱わない。

block開始/終了は独立行の`ここから太字/斜体`と`ここで…終わり`。次のfence開始様行、最初のemphasis終了行まで探し、終了kind一致を必要とする。bodyに別`［＃`がある、非空行に`*`がある、対応endがないなら安全側に保持。endが見つかってunsafeならblock全体を保持し内側を追加変換しない。end不成立なら開始行だけ保持し、後続行は通常loopで処理され得る。成功は非空行ごとに元の空白込みでwrap、空行は維持、開始/終了行を除去。Cは行数でなくblockごと1（空blockでも1）。

件数注意: 不一致の相補2注記はboth passでU=1、one passでU=2となり合計3。通常range未変換は最終的なinline開始注記の数で加算する。終了だけは数えない。block失敗は1。fence内はC/Uとも0。

例: `青空［＃「青空」は太字］`→`**青空**`。`別［＃「青空」は太字］［＃「青空」は斜体］`は原文維持でU=3。`a*b`は保持。`a_b`やbacktick/HTML/underscoreを含むtargetは`*`以外の一般的なMarkdown危険判定をしない。inline codeは保護しない。

### E. 傍線（L567–852）

通常`傍線`→Nyoze `||text||`（default）またはHTML `<u>text</u>`。二重傍線・鎖線・破線・波線はapproximate_other_styles ONで通常下線に近似。左通常はapproximate_left ON。左かつ特殊線種は**両方ON**。近似はCではなくAに1加算。invalid output_formatはnyozeへfallback。

forwardは`text［＃「text」に傍線］`、左は`「text」の左に…`。引用のsegment直前一致を検証。rangeは`［＃傍線］…［＃傍線終わり］`、左は`左に傍線`等のheadがendと完全一致。rangeのbodyに`［＃`/LF/CRがある、空なら保持。forward→range順。

既存wrapper判定は厳密で狭い。forward対象の直前/注記の直後、またはrange全体の直前/直後が`||`と`||`、あるいは大文字小文字無視の`<u>`と`</u>`なら保持。Nyoze出力ではtarget中の`||`を拒否。HTML出力ではtarget中の`<u>`/`</u>`を拒否。**反対形式を含むbodyの一般的な二重wrap防止ではない**。属性付き`<u class=…>`も認識しない。HTML escapeはしない。

blockは独立行の`ここからhead`/`ここでhead終わり`。emphasisと同じ短絡探索だが、内部`［＃`、対応endなし、kind対象外、非空行をwrap不能のいずれかなら保持。対応endがある場合はblock全体を保持。成功は非空行ごとwrap、空行保持、C/Aはblock単位1。

Uは残ったforwardとinline**開始**注記の数、block失敗は1。終了単独はUに含めない。`||青［＃「青」に傍線］||`は保持(U=1)。`<u>青</u>［＃「<u>青</u>」に傍線］`をnyoze出力すると外に`||`を追加する現行挙動を保持する。

### F. 傍点（L967–1109）

対応9種: `白ゴマ傍点`、`白丸傍点`、`黒三角傍点`、`白三角傍点`、`二重丸傍点`、`蛇の目傍点`、`ばつ傍点`、`丸傍点`、`傍点`。種類別に別markは維持せず、選択markへ正規化する。空markは`﹅`、複数code pointsなら**最初の1 code point**。

rangeを先に、forwardを後に処理。range regex自体はDOTALLだがbodyにLF/CR、既存ruby記号`｜《》`のいずれか、`［＃`があればU++して保持。body空/空白のみなど、適用結果が元bodyと同じでもU++で注記も保持。複数行blockの`ここから…`には対応せず、専用Uにも入らない。

forward `quoted［＃「quoted」に種別］`はquotedが空でなく直前segment末尾一致、quoted内にruby記号がないことを検証。rangeと異なり空白だけのquotedにもC++して注記を除去する。quotedを囲む外側のruby文脈、quoted中の他注記や改行を同じ基準で検証する処理はない。

適用はPythonの1文字=Unicode code pointごとに`｜字《mark》`。`isspace()`がtrueならその文字をそのまま残す。結合濁点やvariation selectorも独立した非空白code pointとしてrubyを付ける。JSでは`for…of`/`Array.from`を用い、grapheme segmentationは使わない。`𠀀`は1 ruby、`か`+U+3099は2 ruby。

左forward/左range開始はそのままU++。左終了単独、未知種、閉じ忘れ通常開始は専用Uに入らない場合がある。最終scanで検出する。fence保護なし。

既存ruby保護は対象文字列内に限る。`｜青［＃「青」に傍点］《あお》`→`｜｜青《﹅》《あお》`となることを実測。保護を拡張するのはfuture improvement。

### G. 見出し（L854–965）

大→`##`、中→`###`、小→`####`。H1は生成しない。全行に合致するblock→range→forwardの順。block/rangeはMULTILINE|DOTALLなので複数行bodyに対応し、冒頭と末尾は空白以外を許さない。前置きに任意の`［＃N字下げ］`を1つ許容し、Nを0..40へclampした数の全角空白としてATX記号の後へ挿入する。1..6のNyoze制約とは別。

bodyはPython splitlinesで分割、各行strip、空行を落としASCII spaceで連結。空のtitleなら変換しない。rubyは本文側の文字列を使う。forwardのquotedは**一致検証に使用されない**。`本文［＃「不一致」は大見出し］`→`## 本文`。bodyに全角`［`を許さないregexだが、block/range内の一般注記を一律unsafeとはしていない。

窓/同行大中小見出しは未対応で保持。unsupported countはそれらのforward/開始注記（`ここから`を含む）の数。空の通常見出しや壊れた通常注記はこのcountでは拾わない。fence/inline code保護なし。

### H. 字下げ（L1111–1316）

`［＃N字下げ］本文`は行頭（半角space/tab/全角spaceのleadは可）。NはASCII/全角数字のみで1..6。bodyが非空白、current blockなしの場合だけ`:::indent-N\nbody\n:::`。leadは出力bodyには移さない。preserve時はlead+注記だけの行をrstripしてmarked出力。

独立行`［＃ここからN字下げ］`でopen、`［＃ここで字下げ終わり］`でclose。currentがある開始は先に閉じ、必要ならpreserved noteを外側へ出し、新しい絶対levelを開く。**入れ子にせず付け替える**。Cはopen回数。同じlevel再指定もclose/openする。block内の**1行型**指定は切替ではなく原文保持でUも加算しない。

不正levelのblock開始はcurrentを閉じ、U++、原文保持。bodyのない1行型はlevel検証前に原文保持しU=0。standalone endでcurrentなしはそのまま、U=0。数字付き字下げhintがその他の位置にありcurrentなしなら行ごとU++。修飾付き注記や漢数字等は専用hintに一致する範囲だけ数える。

EOFでcurrentをauto-closeする。入力末尾LFによる最後の空要素はblock内に残り、最終`:::`の後にLFが付くとは限らない。fence境界でもcurrentを閉じる。後で元blockを再openしない。

既存保護は`:::indent-[1-6]`だけ。currentなしのとき入って最初の`:::`までpass through。一般directiveやnested depthの解析はない。block開始注記の次の非空行が既存indent openなら変換をskip（注記はunmarked、Uも増えない）。preserve成功開始/終了だけmarker付与。

### I. 地付き / 地からN字上げ（L1318–1546）

地付きblock: `ここから地付き`→`:::align-end`、対応する`ここで地付き終わり`→`:::`。未閉じはEOF/fenceで閉じる。current中の再startは原文保持。end kindが違えば原文保持。

inline: `prefix［＃地付き］body`でbodyに非空白が必要。prefixに本文があればrstripして前の独立行へ、bodyをalign-end内へ。prefixが空白だけならpreserve OFFでは捨てる。bodyはrstrip('\r')のみ。行中複数の地付き/数字jiage指定はU++で保持。地付きのbody空、またはcurrent中では通常Uを増やさず（同じ行にjiage hintがあればその分の規則で加算）、原文保持。

地からN字上げのNはASCII/全角数字かつ1以上。上限なし。approximate_jiage OFFなら変換しない。ONならN情報を捨ててalign-endへA++。0、不正、複数指定、body空、current中は保持。preserve ONなら元N注記も出すが、directive自体の再現能力は近似のまま。

block jiageを近似しない/不正NならU++し、対応`ここで字上げ終わり`までpass-through状態となる。内部の地付きも処理しない。fence判定が先に走る点に注意。既存一般directive `:::[A-Za-z][A-Za-z0-9_-]*`から最初の`:::`まで保護。block開始の次の非空行が`:::align-end`ならskip、注記はunmarkedで残る。現在の変換block内で既存directiveを一般的に再解析する仕組みはない。

### J. 改ページ（L1548–1712）

独立行の`［＃改ページ］`→`:::page-break\n:::`。最初に**改ページ行 + 1行以上のstrip-empty行 + 改ページ行**を1組として`:::blank-page\n:::`へ変換（blank count=1、page count=0）。preserve OFFなら間の空行も消費、ONなら元の2注記と全間隔行をmarkedで残してからdirectiveを出す。

改ページ2行が直続する場合は通常page 2件。3つを空行でつないだ場合は左から最初の2つをblankにし、3つ目をpageにする。空白ページの一般枚数推定や`blank-page-N`生成はしない。`改丁/改見開き`の組はblank検出対象外。

独立行の改丁/改見開きはapproximate_spread_breaks ONならpageへA++、OFFならU++で保持。左右/見開き情報を捨てる。改段は常に保持し専用kaidan countに入れる。行中注記は変換しない。その他の行では改段hintがあればkaidanを**行あたり1**、なければpage/spread hintをUに行あたり1。両方ある行はelifのためpage Uは増えない。

既存一般directive内を保護。次の非空行が`:::page-break`なら対応元注記をskip。blank pairの後が`:::blank-page`または`:::blank-page-[0-9]+`ならpairをskip。こうして残る注記はmarkerなし、C/Uとも増えなくても残存scanでは警告となる。preserveで成功して出した注記だけscanから除外する。

### K. footer削除（L1813–1922）

1. `text.split('\n')`の末尾400要素以内だけを**開始候補の探索範囲**とする。末尾LFも空要素として数える。
2. 左の半角space/tab/全角spaceだけを取り除いた行頭が`底本：`または`底本:`なら候補。`底本の親本：`は候補ではない。
3. 候補からEOFまでに、行頭（同じ限定lstrip）の`青空文庫作成ファイル：`/`:`が必要。
4. 同じ残り区間に、行頭`入力：`/`:`または`校正：`/`:`、あるいは日付regexのどれかが必要。日付はASCII/全角の4桁年、1～2桁月日、`年/月/日`、任意のspace/tab/全角space、`作成|修正`。**行途中search可、実在日付検証なし**。
5. 上記strong signalsを満たす**最後の底本候補**を採用。底本候補が1つも安全でない場合だけ、独立行`［＃本文終わり］`について同じ条件を満たす最後の候補を探す。コードはcandidate自身を含むsliceを検査する。
6. 選んだ開始行からEOFまで全部を削除。前に残る末尾strip-empty行も削除し、残り本文が非空ならLFを**1つ追加**、空なら空文字。候補なしなら入力と末尾改行を完全維持、removed=false。

`底本の親本`から単独では削除しないが、採用された底本の後にあれば一緒に削除される。本文終わりより後に安全な底本があると底本が優先され、本文終わり注記は残る。本文中のラベル言及だけ、作成file signal不足、person/date不足を削除しない。位置・signals以上の文学的本文判定はなく、fence内のラベルも対象。安全条件を満たす引用例が末尾にあるfalse positiveは起こり得る。

### L. `-----`定型注釈block削除（L1785–1811）

各行をstripし、`startswith('-----')`ならin_annotationを反転し、そのdelimiter行自体は出さない。5本以上だけの行という制限ではなく、`-----abc`もdelimiter。insideの行はすべて捨てる。未閉じならEOFまで捨てる。入れ子・内容確認・fence保護なし。footerの**後**、frontmatterの**前**でTXTにも適用する。

通常のYAML delimiter `---`は5本未満なので直接該当しないが、Markdownの区切り線やcode例を削除し得る。ONなら実際の削除がなくても「注釈削除」eventを生成し、need_writeに影響する。

### M. Frontmatter / metadata（L1714–1783, L1999–2185, L2424–2577）

**Aozora header抽出**: 最初のstrip-empty行を探す。見つからない場合と最初の行が空の場合はheader_end=0のため`{}, 元text`。その他は空行前のstrip済み行をheaderにし、空行以降をjoinして先頭LFだけlstrip。空白を含むseparator行はbodyに残る。

- 1行: titleのみ。
- 2行: title + author。末尾「訳」でもこの早期returnではauthor。
- 3行以上、2行目以降に「訳」で終わる行あり: すべてをtranslator(s)、最初の訳者の直前をauthor。訳者index>2なら2行目～author直前を改行joinしてraw_header。その他の行は回収されない場合がある。訳者が2行目ならauthorにtitleが入る。
- 3行以上、訳なし: 2行目がraw_header、3行目以降がauthorまたはauthors。

**YAML生成**: 固定順title→author→authors配列→translator→translators配列→raw_header。scalarは`key: value`を無escapeで出し、配列は`  - value`、raw_headerは`|`と2-space各行。`---`で囲むが関数単体末尾LFなし。未知keyは生成しない。一般YAML serializerを採用してquoteを加えると互換出力が変わる。

**既存FM認定**: 第1行stripが`---`、次のstrip `---`が存在し、簡易parse結果が非空dictの場合のみmetadataが存在。先頭空白1行やBOMを特別処理しない。非space開始でcolonを含む行を最初のcolonでkey/valueへ分離しstrip。非空valueを**文字列そのまま**採用。quote/comment/inline arrayをparseしない。空valueのauthors/translatorsだけ直続する厳密`  - `行を配列としてparse。raw_header `|`は文字列`|`となり、続くインデント行は読まない。空dict/閉じなしはNone。任意top-level keyは保持し、duplicate keyは最後の値。

**既存FMがある場合**: add_frontmatterにかかわらず既存FMを維持。add_header_to_body ONなら、FM後bodyを先頭LFだけ落とし、その先頭10行にstrip完全一致のtitleがあるか確認。なければtitle→raw_header→authors（なければauthor）→translators（なければtranslator）を改行連結し、最後にLF2個を付けて本文前に挿入。FMとheaderの間はLF1個。titleが空ならheaderなし判定。authorだけ不足等を補修する機能はない。既にtitleがあればheader追加もbodyの再構築もしない。

**既存FMがない場合**: Markdownかつadd_frontmatter ONならheader解析。metadata非空時だけFM追加。add_header_to_body ONはFM+LF+元processed_text、OFFはFM+LF+抽出body。FMを追加しない場合に単独でheaderを追加する処理はない。TXTはFM生成/復元なし。

**命名metadata**: 変換器適用直後のsnapshotからget_metadata_from_text。簡易FMが非空ならそこからtitle/author(s)だけ、なければAozora headerから同項目。authorsがあれば先頭を代表authorにする。空配列の先頭accessはIndexError。Worker organize branchではcatchしWARNを出し、通常stem出力へfallback。その他metadataも残すcontent FMと、命名投影を混同しない。

**命名**: title不在は元stem、author不在は`unknown_author`。空文字が存在する場合はfallback値でなくsanitize→`untitled`。sanitizeは`/ \\ : * ? " < > |`を`_`へ、code point<32除去、Python strip→strip('.')、100 code points超なら先頭100後rstrip、空ならuntitled。DEL、予約名CON、拡張子重複、Unicode正規化、衝突解決はしない。`'. .'`→space1個にもなり得る。

author/title.extで保存。元parent.nameとstemがsanitized author/titleに一致すれば、指定out_dirより元parentを優先して入れ子を避ける。その後same-fileなら_converted。これらはpure naming policy + adapter責務で、coreにPathを持ち込まない。

### N. remaining Aozora note scan（L1153–1164, L1925–1997）

regexは`※?［＃[^］\r\n]*］`。空内容も対象。`※`があれば注記textに含める。複数行注記、閉じ忘れは拾わない。lineは**最終出力の1-based LF行番号**、入力行番号ではない。全件listを返す。frontmatter、通常directive内もscanする。

fence/inline code除外はPに従う。preserved markerが注記の直前直後にある出現は除外。完全一致文字列でgroup化し、初出順（sortなし）。出現数を数え、同じ行の重複も別出現。ログの行番号はgroup内の最初の3**出現**でありunique lineではない。4件以上なら`, ...`。表示するgroupは最初の50種類、超過は`... 他 N種類`。総件数は表示上限にかかわらず全件。

先頭log: `[WARN] 未変換の青空文庫注記: N件 — filename`。後続は`    N件  note  (行 1, 2, 3, ...)`。Workerがさらに5 spacesを付ける。専用[fixture](./fixtures/warning-format-fixture.json)で正確な空白も比較する。

呼出しはMarkdownのみ。unknown/unsupportedはfatal errorではない。files_with_remaining_notesとremaining_notesをwrite前に加算、成功write後にwarning logを出す。write失敗でも残存JobStatsだけは増え、WARN logは出ない。GUI完了warning dialogはremaining_notes>0で決まり、errorsだけで同じwarning分岐には入らない。

### O. Preserve annotation internal marker（L1150–1191）

OPEN=`\uE000`、CLOSE=`\uE001`。indent/align/pageで**成功した変換の元注記をpreserve出力する時だけ**`_mark_preserved_aozora_notes`が適用される。生成directive、未対応で残した注記、既存directive検出でskipした注記へは付けない。preserve行中の上記note regexに合致する各出現を包む。

mark→後続変換→footer削除→定型block削除→FM操作→scan→stripの順。scanは注記のexact前後1文字がmarkerかを判定。stripは`OPEN + (exact単一AOZORA_NOTE_RE) + CLOSE`だけを元注記へ戻す。全文からPUAを無条件にreplaceしない。PUAを含む普通の本文、片側marker、不完全wrapper、複数注記をまとめたwrapperを破壊しないため。

**stale suppression防止**: 「この注記文字列をpreserveした」というglobal set/countに頼らない。削除されたmarker付き出現はscan対象textから消え、同じ文字列の別の未変換出現はmarkerがないので検出される。`preserve-deleted-no-stale-suppression`がそのintegration fixture。

markerが入力にもともと存在する場合のエスケープはない。入力由来のexact wrapperも意図的保持と見なされ、scanで除外・stripされ得る。これはconcernとして記録し、互換モードでrandom markerや一般的なPUA除去へ勝手に変更しない。再実行時は前回markerが除去済みなので、前回preserve注記の残存警告が復活する場合もある。

### P. Code fence / inline code / directive保護の差

| 処理 | backtick fence | tilde fence | inline code | 既存directive |
| --- | --- | --- | --- | --- |
| gaiji | 保護なし | なし | なし | なし |
| emphasis / underline | strip後startsWith(```` ``` ````)でbool反転 | なし | なし | なし |
| bouten / headings | 保護なし | なし | なし | なし |
| indent | 同じbool反転、open indentをその場でclose | なし | なし | indent-1..6だけ |
| align | 同じbool反転、open alignをその場でclose | なし | なし | 一般directiveを最初のcloseまで |
| page | 同じbool反転 | なし | なし | 一般directiveを最初のcloseまで |
| footer / annotation block / metadata | 保護なし | なし | なし | なし |
| final residual scan | charとlengthを記録、厳密close判定 | 同様に対応 | 狭いregexでmask | 保護なし |

bool反転は開閉の長さ一致を見ず、` ```suffix`様の行でも反転。Python stripの広い空白を認識する。block emphasis/underline探索もこのprefixで停止。既存directiveとfenceが重なる時はfence判定が先で、汎用stackを持たない。

final scannerのopenは行頭のspace/tab/全角spaceに続くbacktick3個以上またはtilde3個以上。suffixは何でもよい。closeは同じ文字、open以上の長さで、前後に限定空白しかない独立行（末尾CRは除去）。close行もscanしない。unclosed fenceはEOFまで除外する。inline regexは`` `[^`\n]+` ``（1 backtick組、空不可）を同長のspacesへ置換。multi-backtick構文も部分的にこのregexへ合致し得るが、CommonMark準拠のcode span解析ではない。

変換器はtilde/inline code内を変更したのにscannerはそこを除外することがある。保護範囲の統一はoptional future improvementであり、この移植には入れない。

### Q. Source file safety / ZIP / folder（L93–122, L2255–2330, L2424–2464, L2594–2639）

same fileは`Path.resolve()`文字列比較、OSError時だけ元Path比較。inode/hardlink同一判定ではない。unique_output_pathはdesiredがsourceと違えば既存fileでもそのまま。等しければ**sourceのparent/stem/suffix**で`stem_converted.ext`を選ぶ。candidateがsourceとsameの場合だけ`_converted2`以降へ進むので、空き番号探索ではない。

TXT→MDでdesired MDがsourceへのsymlinkなら、回避先はsourceの`.txt`を使うため`work_converted.txt`へMarkdown内容を書き得る。hardlinkは見逃す。隔離probeで既存別MD、既存_convertedの上書き、hardlink sourceの改行変化を確認した。

ZIPは`zipfile.ZipFile`→infolist→一意な`TemporaryDirectory(prefix='aozora_zip_')`→extractall→zips_processed++→infolist順でtextだけ処理→context exitでtemp削除。ZIP名directoryへ永続展開はしない（冒頭Featuresの記述と不一致）。nontextを含め全部temp展開するが、結果として保存するのはTXT/MD変換のみ。内側ZIPを再帰解凍しない。CRC/圧縮方式/filename decodeはPython zipfile依存、アプリ独自のsize制限なし。

ZIP output_baseはout_dirまたは元ZIP.parent。内部subdir構造は通常stem/nameで**平坦化**される。同名textが別subdirなら後が上書き。duplicate entryはextractall後の最終内容をentry回数だけ処理し得る。`extracted`引数は本体で使われない。text writeエラーはtext側でcountして続行、extract/それ以外の例外はZIP errorとして処理される。

ZIP filenameはUTF-8 flagが立てばUTF-8、なければ標準CP437のPython既定で、TXT本文のCP932とは別。原本はmetadata_encodingを指定しない。Browser adapterでもCP932 filename自動推測を互換既定に追加しない。[Python zipfile仕様](https://docs.python.org/3.12/library/zipfile.html)

**危険箇所**: extractallのpath sanitizationと、その後の`temp_extraction / Path(info.filename)`が別である。後者はraw名を再使用し、absolute/traversal名がtemp外へ解決され得る。これをTypeScriptでtemp外読み出し可能な機能として移植しない。read-only仮想ZIP entriesと書込計画を使う（8）。

