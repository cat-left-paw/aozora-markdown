# Improvement Decisions — 改良移植仕様 v2

2026-09-22 / decision set `aozora-ts-v2`。ユーザーの今回の「明確な欠陥を改善する」指示に基づく設計判断。本書のFIX NOWは採用する改善仕様であり、単なる検討候補ではない。**実装・実機検証が完了したという意味ではない。** 本書にない変更を理由IDだけ流用して承認済みにしてはならない。

Product behaviorは継承する。Accidental implementation behaviorとBug/unsafe behaviorは以下の境界で改める。Pythonの観測そのものは[旧解析](./python-reference-analysis.md)と変更しないoracleに残す。

## 1. R01〜R18決定一覧

| ID | 分類 | 主分類 | 採用する境界 / 初回実装責務 |
| --- | --- | --- | --- |
| R01 | FIX NOW | Bug | BOM→strict UTF-8→CP932→Shift_JIS。decode失敗時の黙った欠落を廃止。pure byte entry |
| R02 | KEEP | Product | 出力はUTF-8。legacy convert_utf8のUI/skip判定は新APIの互換対象外、出力encodingを偽らない |
| R03 | FIX NOW | Unsafe | pure出力計画で全入力・既存出力・同batch予約を保護。hostの排他的新規作成は別gate |
| R04 | FIX NOW | Unsafe | 同一path以外のalias/raceを含め上書き禁止。初回はidentity/capability契約とfake-store試験 |
| R05 | FIX NOW | Unsafe | ZIP entry identityと階層を保持。平坦化/organize時も衝突を解決。初回はpure entry計画 |
| R06 | FIX NOW | Unsafe | raw ZIP名を検証してから扱い、temp外参照を禁止。初回はpure validator |
| R07 | DEFER | Unsafe / adapter | streaming展開量の実測制限、abort、ZIP実runtime。ZIP adapter公開前の必須gateとする |
| R08 | FIX NOW | Bug | 正しいYAML生成、既存FM原文保持、型付き読取とlegacy fallbackの分離 |
| R09 | FIX NOW | Bug | headerの未分類行を失わない。titleをauthorに流用しない。空authorsは正常fallback |
| R10 | FIX NOW | Accidental / Bug | forward見出しは本文基底文字との一致を検証。正常ruby/先行変換を壊さない |
| R11 | FIX NOW | Bug | 傍点targetの外側ruby文脈も検査し、交差/内部への適用を拒否 |
| R12 | FIX NOW | Accidental | emphasisの同一失敗をpass間で重複countしない。二つの失敗forward注記は2件 |
| R13 | FIX NOW | Accidental | Markdown経路の全converter/削除/scannerで共通のfence・inline-code保護 |
| R14 | FIX NOW | Unsafe | 厳密かつ閉じた`-----`pairだけ削除。footer条件を狭め、曖昧な削除を保持 |
| R15 | FIX NOW | Accidental / Bug | PUAの文字列sentinelを廃止、call内の出現rangeでpreserve provenanceを管理 |
| R16 | FIX NOW | Bug | JobStatsの成功出力集計はcommit成功後。初回はpure job reducer |
| R17 | KEEP | Product / conservative | generated/既存directive内の後続align/page抑制を維持。入れ子変換を新規追加しない |
| R18 | FIX NOW | Unsafe | portable filename proposalを安全化。予約名・空名・byte長・衝突を分離して検査 |

**KEEP 2 / FIX NOW 15 / DEFER 1**。R03〜R06/R16のFIX NOWは「初回にpure policyと契約testを完成」、実ファイルの保証はhost実装後に別途合格が必要。これをhostの安全性修正済みという報告に置き換えない。R15等の未解決の小範囲は各項目の限界に明記する。

## 2. FIX NOWの正式仕様

各項目の8欄は、Python現行→問題→新仕様→理由→正常影響→fixture→regression→両host影響を表す。改善reasonは[fixture policy](./fixture-policy.md)と対応する。

### R01 — `ENCODING_UTF8_FIRST_STRICT`

1. **現行**: CP932→Shift_JIS→UTF-8-sig→UTF-8、最後はCP932-ignore。UTF-8 `あい`が`縺ゅ＞`となり、不正byteは通知なく消える。
2. **問題**: 正常Unicode文書を壊し、decode不能をデータ欠落へ変える。
3. **新仕様**: `decodeTextBytes(bytes, {encoding:'auto'|'utf-8'|'cp932'|'shift_jis'})`をcoreとは別entryにする。autoはUTF-8 BOMを認識して除去しUTF-8 strict（失敗時は他codecへ再解釈しない）、BOMなしはUTF-8 strict→CP932 strict→Shift_JIS strict。UTF-16/32 BOMは`UNSUPPORTED_ENCODING`で明示的に拒否（機能追加はしない）。UTF-32 BOMをUTF-16 prefixとして誤分類しない。全失敗は`DECODE_FAILED`、textを返さない。明示指定は指定codecだけを試す。UTF-8 BOMと非UTF8指定が競合すれば`ENCODING_BOM_CONFLICT`。全成功経路でCRLF/CR→LF、labelは`utf-8`/`cp932`/`shift_jis`、BOM有無は別field。lossy ignore modeは初回に作らない。
4. **理由**: Unicode入力を優先し、曖昧時は理由を隠さず明示指定で回避できる。codec mapping自体はPythonのCP932/Shift_JISを基礎として別検証する。
5. **正常影響**: 通常のCP932青空TXTはUTF8 strict失敗後に従来どおり読める。ASCIIは同じtextでlabelだけutf-8へ。両方のcodecで有効なbyte列の真のencodingは自動判定不能であり、UTF8優先というpolicyを公開する。BOMなしデータに100%正解を保証しない。
6. **fixture**: `encoding/utf8-ambiguous`→`あい`、`ascii` label変更、UTF8-sig label正規化、`invalid`/`ignore-newline`→明示失敗。元10件は変更せずoverrideを別保存。
7. **regression**: CP932の日本語/①/髙、全単独/2-byte mapping、BOM+破損UTF8、truncated lead、UTF8不正surrogate/overlong、両valid列の明示CP932指定。byte未検証をUnicode core testで代用しない。
8. **Browser/Obsidian**: File.arrayBuffer/Vault.readBinaryに同じdecoderを適用。すでにdecodedなstringを受け取る場合はこのgateを通ったとは主張しない。encoding選択UI自体は後続。

### R03 — `OUTPUT_CREATE_ONLY_COLLISION_PLAN`

1. **現行**: desired!=sourceなら既存fileを上書き。`_converted`も空き名探索にならない。
2. **問題**: 別の入力・過去の結果が失われる。
3. **新仕様**: `planOutputs(requests, snapshot)`は全入力identity、既存destination、同batch予約を先に集合化する。入力順はrequestに明示された順。desiredが空いていれば使用、使用済みなら`stem_converted.ext`、`stem_converted2.ext`…の最初の空き名を選ぶ。既にstem末尾が_convertedでも正規表現で削らずliteral stemへsuffixを追加。target拡張子を常に維持。占有比較はR18のkeyとhostのより強いidentityで行う。writeはcreate-only、overwrite optionは初回に提供しない。計画後の新collisionは再計画または失敗で、既存fileを削除/置換してretryしない。既存の通常directoryは安全な親として再利用できるが、fileとdirectoryの同名衝突は占有扱い。同一author groupのdirectoryをfileごとに別名へ変えない。
4. **理由**: 非衝突時の出力名を維持し、衝突時だけ安全な新規名を割り当てる。
5. **正常影響**: 空destinationへの通常author/titleやstem出力は同じ。同名入力/既存_converted時だけsuffixが変わる。
6. **fixture**: `io/txt-overwrites-existing-md`/`md-overwrites-existing-converted`は元既存bytes不変、別名出力へ。oracleは「危険挙動の再現資料」のまま保存。
7. **regression**: 同batch同名3件、入力TXT+MD、preexisting converted2、case/Unicode normalization alias、plan後collision、renameToMd時のtarget suffix。
8. **両host**: Browserは出力ZIP内/ダウンロード提案名の重複を防ぐ（ユーザーのdownload folder内部は見えず保証外）。ObsidianはVault既存名をsnapshotし、保存直前にも確認してcreate-only契約を守る。

### R04 — `SOURCE_IDENTITY_AND_EXCLUSIVE_CREATE`

1. **現行**: resolve文字列比較だけなのでhardlinkを見逃し、symlink回避で元TXT suffixに戻る。
2. **問題**: 元file改変、path検査とwrite間のrace。
3. **新仕様**: R03のcreate-onlyに加え、hostの`DestinationCapabilities`にroot内検証・既存path/alias確認・排他的新規作成の保証有無を宣言させる。Native filesystemを扱うhostはsymlink parent/leafとhardlink inodeを確認し、安全なroot内で競合に負けたwriteを拒否する。既存destinationはsame-fileでなくても開いてtruncateしない。保証できないhostはその保存操作を`UNSAFE_DESTINATION`/`EXCLUSIVE_CREATE_UNAVAILABLE`として実行せず、Browser download artifact等の別経路を使う。単なるexists-check→writeを排他的作成と称しない。
4. **理由**: coreへOS APIを持ち込まず、能力のない境界で安全性を偽らない。
5. **正常影響**: 安全な空pathの新規作成は変わらない。symlink/hardlink先への上書きは拒否/別名。
6. **fixture**: `io/hardlink-alias`はsource bytes不変、`symlink-alias`はtarget extensionを維持。初回はfake hostで既存alias/race/capability不足の実行拒否を確認。
7. **regression**: check後symlink挿入、parent symlink、同inode別path、permission失敗、create競合、再試行でsource削除しない。実filesystem試験はhost sliceの必須gate。
8. **両host**: Browserの入力Fileはread-onlyとして保持。Obsidian APIだけで競合/alias保証できる範囲を実機監査する。保証不足を純粋関数testの成功で埋めない。

### R05 — `ZIP_ENTRY_IDENTITY_NO_SILENT_FLATTEN`

1. **現行**: 内部階層を平坦化し、同名は後勝ち。duplicate entryは最終解凍内容を複数回読む場合がある。
2. **問題**: 別作品消失、entryと処理したbytesの対応が崩れる。
3. **新仕様**: entryは`archiveId + centralDirectoryIndex`で識別し、各entry自身のbytesを読む。標準出力proposalは`sanitize(archiveStem)/validated entry directories/converted basename`。directory segmentはR18でsanitizeし、その結果のcollisionもR03へ渡す。organizeByAuthor ON時は従来のauthor/title提案を優先するが、R03で全entryの衝突を回避する。duplicate raw nameも別entryとして保持し、後のものへsuffixを割り当てる。duplicate mapへ上書きしてからcoreへ渡すことは禁止。archive wrapper名自体のcollisionも解決する。directoryは同じ論理groupに一度だけ名を割り当てる。異なるraw directoryがsanitize後に同名となる場合は安定した別名を予約し、子entryすべてに同じprefixを適用する。
4. **理由**: ZIP階層とentry identityを保つことで、個々の入力の追跡と無損失出力を可能にする。
5. **正常影響**: 本文変換結果は同じ。ZIP出力directoryは従来のflat配置から変わるという**明示的な正常ケース差分**。loose fileの配置は変えない。
6. **fixture**: `io/zip-flatten`のFIRST/SECONDを両方保存、`zip-duplicate`は各entry元bytesを1回ずつ使用。pure `planZipEntries` test vectorsを追加。
7. **regression**: 同stem複数ZIP、duplicate中央entry、異なる階層の同basename、sanitize後衝突、organize合流、順序安定、画像/nontext非変換、nested ZIPを再帰解凍しない。
8. **両host**: Browserの結果ZIPとObsidian folderに同じrelative planを使う。実ZIP libraryのentry別read確認はhost/ZIP sliceに残る。

### R06 — `ZIP_PATH_VALIDATION_BEFORE_USE`

1. **現行**: extractallのsanitize後にraw info.filenameでpathを組み直し、temp外を参照し得る。
2. **問題**: 入力archiveを使った意図しない読取/書込。
3. **新仕様**: 展開先filesystemを作らず、まずentry metadataを検証。raw nameのNUL/C0制御、先頭slash/backslash、drive prefix（drive-relative含む）、UNC、`..` segment、symlink entryを拒否。segment境界の判定時はslash/backslash両方をseparatorとして扱う。`.`と空segmentは正規化で除くが、**..を解決して救済しない**。percent encodingをURL decodeしない。非UTF8 filenameはUTF8 flag/CP437を基本にlibrary挙動を別監査する。raw/decoded名を記録し、後からより危険な別decodeを採用しない。1つでも危険entryがあるarchiveはwrite前にarchive単位で拒否。validated relative entry名だけをR05へ渡す。
4. **理由**: 正規化と検証の食い違いを防ぎ、外部pathを参照できる情報をwriterへ渡さない。
5. **正常影響**: 通常relative namesは同じ。拒否archiveの部分だけ黙って成功扱いしない。
6. **fixture**: `../x.txt`, `a\\..\\x.txt`, `/x`, `C:x`, `C:\\x`, UNC, NUL, symlink metadataのreject、正常`a/b.txt`とliteral `%2e%2e`の扱いを固定。
7. **regression**: 二重separator、mixed separator、directory entry、sanitize前の危険をsanitizeで隠さない、後続writerへraw path非露出。
8. **両host**: 同一pure validatorを共有。Browserでも出力ZIPに危険名を再梱包しない。ObsidianではVault root内検証をさらに行う。

### R08 — `YAML_SAFE_GENERATION_AND_READ`

1. **現行**: 無escape scalar生成、quote/comment未解釈、raw_headerが`|`として復元される。
2. **問題**: titleがYAML構造/別型になり、metadataや本文復元が壊れる。
3. **新仕様**: `parseLegacyFrontmatter`は旧戻り値を診断/比較用に維持する。productの`readFrontmatter`は単一YAML mappingを安全にparseし、既知keyだけstring/string[]として投影する。YAML failsafe schema、custom tagsなし、aliasを解決せず拒否、duplicate keyはエラー、object prototypeへmergeしない。失敗時はFM raw bytesを保持し、`FRONTMATTER_PARSE_FAILED`を返してheader復元/命名への利用を止める。legacy fallbackはliteral値を失わないread-only診断projectionに限定し、quoteを勝手に剥がして修復/再保存しない。

   既存FM envelopeは文書先頭の独立`---`から、YAMLのliteral/folded block scalarおよびsingle/double-quoted scalarの外にある最初の独立`---`までを全変換・削除から原文保持する。開始・終端候補の外側space/tabと末尾CRは許容するが、scalar内の字下げされた`---`はdataであり終端にしない。標準のcolumn-0終端は、閉じたquoted scalarの後またはblock scalarからdedentした位置で認識する。空白付き終端はscalar外だけで認識し、scalar本文との曖昧さがある場合はscalarを優先する。旧space/tab拡張はplain scalarの継続より独立delimiterを優先する規則として維持する。したがってliteral/quoted payloadの`---`を保存するためにこの拡張へ依存せず、writerはcolumn-0 delimiterを生成する。境界判定はYAML構文tokenのsource範囲だけを利用し、alias/tagの解決やmetadataの意味処理を前倒ししない。stage0で境界を認識するだけで、意味的metadata処理順はstage9/12のまま。閉じないenvelopeは境界が不明なためEOFまでreadonlyとし、本文を削除せず、stage12で`FRONTMATTER_PARSE_FAILED`を返してFM追加/復元を行わない。新規生成は固定key順を保ち、各scalarを元文字列へ正確にround-tripできるYAMLにする。safeな旧plain scalarは維持し、危険/別型/コメント解釈される値はdouble-quote escape。改行/controlはescapeし実dataに戻るようにする。配列も各要素へ同じ規則。raw_headerはliteral blockの末尾LF数に合うchompingを選ぶ。ただしYAML literal内で不正となる制御文字、およびspace/tabを含む空白・LFだけの値はdouble-quote escapeへ切り替え、意味値を失わない。LFだけの値はkeep chomping、空文字は空literalとして保持できる。 その他のraw_headerも、生成したliteral候補をYAML core schemaでparseし、エラー／警告なし・scalar意味値が元stringと完全一致する場合だけ採用する。不一致なら、文字を含む場合もdouble-quote escapeへ切り替える。破棄したliteralのplacementをescape後へ流用せず、FM全体の最終round-trip検査も維持する。新FMは生成直後に独立parseして等値確認。既存FMの書式全体を書き直さない。

   `addHeaderToBody`でraw_headerを復元する際は実際の複数行を用いる。末尾LFを1個だけfieldの終端として除いて他fieldとLFで結合し、それ以外の内部/末尾空行は保持する。例えばtitle=題、raw_header=`副題\n`、author=著者なら`題\n副題\n著者\n\n本文`とし、literal `|`や余分な空行を挿入しない。文書先頭FMを保護するのはMarkdown経路だけで、TXT出力へYAML推測を拡張しない。
4. **理由**: 旧入力の原文を残しながら、新規出力を正しいYAMLにできる。reader/writerを分けてquote round-tripを保証する。
5. **正常影響**: 単純な`title: 題`/`author: 著者`は同一。colon/#/bool様/number様/quote/control等、raw_header末尾LF、既存FM内注記の変換有無には承認差分がある。既存FMのquote付きtitleはquoteを含まない意味値として読む。これは旧parserのstrict testとproduct reader testを別にする。
6. **fixture**: `yaml-unescaped`に新正規YAML、`header-restore`の`|`を`副題\n`の実内容へ、`frontmatter-quoted`はlegacy test維持＋product reader新期待値。新生成→再入力→命名/復元のround-tripを追加。
7. **regression**: `a: b # c`, `true`, `001`, `[人]`, `---`, backslash/quote/LF、空配列、unknown key、malformed YAML、alias、duplicate keys、既存FM内の青空注記を変えない。読み取れないFMをAozora headerとして二重FMにしない。
8. **両host**: 同じYAMLをWeb download/Obsidian metadataが読める。libraryはbrowser対応`yaml`を候補とし、API/出力profileを固定して独立testする。初回pure sliceでは`yaml@2.9.1`を導入し、出力profileをアプリ側で固定した。[公式yaml文書](https://eemeli.org/yaml/)、[YAML 1.2.2](https://yaml.org/spec/1.2.2/)

### R09 — `HEADER_METADATA_NO_DATA_LOSS`

1. **現行**: 3行以上の訳者分岐で未分類行が消え、訳者2行目ならtitleをauthorへ流用。空authorsで例外。
2. **問題**: metadata/bodyの欠落と誤命名。
3. **新仕様**: headerの通常1/2/3+行heuristicは維持し、各header行に「title/author/translator/raw」の所有先を1つ記録する。訳者直前のauthor採用はindex>=1かつtitle行ではない時だけ。未採用の全header行は原順序でraw_headerへ収集し、生成FM/保持本文のいずれかで必ず残す。既知のnormal raw_headerと追加行は重複しない。`authors=[]`/空要素のみはfirst accessをせず、有効authorがあればそれ、なければ未指定としてunknown_author命名。parse失敗ではない。文字列を作者配列として1文字ずつ扱わない（R08のtyped reader）。
4. **理由**: 著者同定を全面再設計せず、情報消失/明白な自己参照だけを止める。
5. **正常影響**: 通常title/author/訳者は変えない。未分類lineが増える場合はraw_headerが増え、title authorの誤りは欠損authorとして扱う。訳なし3+行の推定精度向上は対象外。
6. **fixture**: `header-translation-second`はtitle=題、translator=甲訳、authorなし、raw_header=失われる行。`metadata-empty-array`のIndexErrorを正常metadataへ変更。
7. **regression**: 訳者後の補足、複数訳者と間の補足、2行ケース維持、未分類行順・重複なし、空authors+author fallback、addHeaderToBodyの両値。
8. **両host**: 共通metadata。Browser名/Obsidian folderに誤authorを流用しない。

### R10 — `HEADING_TARGET_VALIDATED`

1. **現行**: forward quotedと本文が不一致でも変換する。
2. **問題**: 誤った範囲を見出し化し、注記を消す。
3. **新仕様**: forwardの行全体body（前置字下げと外側空白を除く）がquotedそのもの、または**一意に得られる基底文字列**と一致する場合だけ変換。基底文字列は明確な青空rubyのreading/開始記号を除いたbase、およびこのcallでemphasis/underline/boutenが生成したmarkupのtarget payloadから構成する。生成markupを外側の生成markupで包む際は、完全に含まれる内側regionの基底を合成して継承する（例: 太字→傍線→見出し）。入力由来の同じ字面のmarkupにはこの継承を適用しない。任意の既存Markdown/HTMLをstripして一致させない。未解析/曖昧rubyは一致不明として保持。引用文字そのものはNFKCや部分一致にしない。block/range headingにはquotedがないのでこの条件を追加しない。失敗は出力原文、heading C=0、窓/同行unsupportedとは別の`HEADING_TARGET_MISMATCH`diagnostic。
4. **理由**: 不一致を拒否しつつ、先行bouten等との既知の正常pipelineを守る。
5. **正常影響**: `章`、`｜章《しょう》`、生成`｜青《﹅》｜空《﹅》`とquoted=青空は従来どおり。誤quotedだけ保持する。
6. **fixture**: `heading-quote-not-checked`は原文維持。`heading-ruby`/`bouten-before-heading`はstrict期待を維持。
7. **regression**: quote空、前後余分本文、部分suffixだけ一致、ruby/結合文字/補助面、先行bold/underline、任意既存HTML偽一致、行頭indent。
8. **両host**: 同じ変換結果と残存警告。render結果を見てquote一致を判定せず、pure coreで完了する。

### R11 — `BOUTEN_RUBY_CONTEXT_PROTECTED`

1. **現行**: quoted内部だけruby記号を調べ、`｜青［＃「青」に傍点］《あお》`を二重rubyへ壊す。
2. **問題**: targetの外側にあるruby構造を破壊する。
3. **新仕様**: 同一非code行に対し、明示`｜base《reading》`と、青空注記を除いた直後の`《reading》`を持つtarget候補を保守的に検査。targetがbase/readingに内包・交差、または対象注記を飛ばした直後にreadingがあるなら傍点を適用せず注記を保持。対象前に未閉じ`｜`/`《`があり対応が一意に決まらない場合も保持。行の無関係な先行rubyが正しく閉じている場合は後続targetを拒否しない。一般ruby変換機能は追加しない。
4. **理由**: 文脈を限定して見るだけで既知の破壊を防ぎ、全面ASTを不要にする。
5. **正常影響**: 普通の非ruby target、code pointごとのmark/空白処理は同じ。曖昧ruby周辺は変換数が減る安全側差分。
6. **fixture**: `bouten-ruby-context`は入力不変、C=0/U=1。明示/implicit ruby、reading内部、交差の新fixture。
7. **regression**: 閉じたrubyの後の別targetは変換、左/未知種保持、supplementary、既存ruby全体引用の旧拒否、malformed delimiters。
8. **両host**: 共通stringロジックで保護し、Obsidian/Nyozeのrender差に依存しない。

### R12 — `DUPLICATE_DIAGNOSTIC_COUNT_FIXED`

1. **現行**: 相補的なforward2注記の失敗をboth passとone passで重複計上しU=3。
2. **問題**: 2個の未変換注記なのに3件と表示される。
3. **新仕様**: emphasisの失敗判定は元の注記出現ID（source range）をkeyに集約する。both passが失敗した時は同じ2つのforward出現にfailureを紐付け、one passが再確認しても増やさない。最終的に成功で消費された出現はfailureから除外。forwardは1出現1件、range/blockは開始を代表とする既存の1構造1件、nested未対応は残る開始ごとという母数を維持。閉じ注記単独や他converterのcounterを一括再定義しない。
4. **理由**: 出力文字列を変えず、既存counterの意味を最小範囲で修正できる。
5. **正常影響**: 成功bold/italic/both件数は同じ。重複failureだけ減る。final remaining scanは引き続き実注記出現を数え、stage Uとの一致を全構文で要求しない。
6. **fixture**: `emphasis-both-unsafe-count`のU 3→2、textはstrict。同じtextの別位置2注記を1件へまとめない。
7. **regression**: complementary不一致、star unsafe、同種隣接、片方のみ成功、同文言複数位置、block失敗、複数pass後のstale failure。
8. **両host**: UIへ渡す同一stats/diagnosticsが直感的になる。ログ表示回数と注記countを混同しない。

### R13 — `UNIFIED_LITERAL_PROTECTION`

1. **現行**: gaiji/bouten/headingsはfence無保護、他converterはbacktickのみ、scannerはtilde/inlineを除外。
2. **問題**: コード例を変換/削除するのに残存scanで見えない。
3. **新仕様**: Markdown出力経路の前に**非破壊の保護range索引**を作り、全converter・metadata header抽出・footer/定型削除・scannerが同じ保護情報を使う。backtick/tildeのopenは原本scanner同様、行頭のspace/tab/全角spaceを0個以上許容し、その後同じ記号が3個以上（後続infoの制限は追加しない）。closeは同じ行頭空白、同じ記号がopen長以上、後ろspace/tab/全角spaceのみ（末尾CRは原本同様除外して判定）。unclosed fenceはEOFまで。inline codeは同一LF行でmaximal backtick runを左から読み、同長runの最初のcloseまで、closeなしならliteral。異長runはcloseとしない。連続backtickだけのrunを空spanの開閉へ分割しない。backslashでdelimiterをescapeするMarkdown全面解釈は導入せず、この限定規則を公開する。範囲に交差する注記変換は構造全体を保持し、codeを除いてtargetを連結しない。新生成textにも同じ規則を適用し、offset更新と再索引を行う。既存FMはR08の独立readonly範囲。TXT出力はMarkdown保護を導入しない。

   単体converterの通常public APIはMarkdown contextをdefaultにし、TXT pipelineのgaiji等は明示context=textで呼ぶ。blockのopen stateがfence境界に達した時のindent/align auto-closeは従来どおり境界の手前に出す。fence内を跨いでblockをwrap/deleteしない。
4. **理由**: boundedな字句保護だけで矛盾を解消し、CommonMark parser全面導入を避ける。
5. **正常影響**: code外の正常青空構文は維持。code例内は意図的に未変換・無警告になる。Markdownで文字として書かれた単なるtilde/backtick runがこの規則へ合致する場合も保護する。TXT出力では旧通常変換を維持する。
6. **fixture**: `gaiji-fence`, `bouten-fence`, `heading-fence`, `emphasis-tilde/inline-code`, 各`protection-*`を個別再判定。既存の正しいscanner fence例はstrictを維持。
7. **regression**: backtick3/4、tilde、suffix付き偽close、inline单双/異長、内容なしの孤立run、不閉じ、同じ注記のcode内外混在、range跨ぎ、footer/annotation内code、既存FM、TXT gating。少なくとも各converterで「内は不変/外は変換」を同文書で確認。
8. **両host**: 共通coreで保護。Browser/Obsidianの表示parserに合わせて別挙動を作らない。複数行inline codeや任意HTML block等の全面Markdown一致はDEFERした拡張範囲。

### R14 — `CONSERVATIVE_DELETION_BOUNDARIES`

1. **現行**: `-----suffix`もtoggle、閉じ忘れはEOFまで削除。footerはfence/引用/説明中signalsも採用。
2. **問題**: 本文の誤削除は復元困難。
3. **新仕様**: 定型block delimiterは外側space/tab/全角spaceを除いた`^-{5,}$`のみ。非保護の独立delimiterを出現順にpair化し、**閉じたpair**だけ削除する。delimiter総数が奇数ならこの削除pass全体を取り消して入力全体を維持し、`UNCLOSED_ANNOTATION_BLOCK`を1件返す。偶数でも保護rangeを跨ぐpairは削除せず、他の安全なpairだけ削除できる。閉じpairの内容の文学的判別まではしない。

   footerは原本の末尾400行/最後のsafe底本優先/honbun fallback/作成file AND(person/date)を維持し、以下だけ狭める。開始candidateと強いsignalは非保護の独立行に限定し、Markdown blockquote prefix `>`（先頭半角space0..3を許容）の行はcandidate/signalに使わない。日付は限定空白後の行頭から始まり、原本どおり4桁の年（値1..9999）と1〜2桁の月日をGregorian実日付として検証する（全角数字可、年100を越えないDate実装の罠は算術で回避）。削除candidate〜EOFがcode/FM保護rangeまたは非保護の厳密5ハイフンdelimiterを含む場合は削除せず保持。signalsが揃わない/境界が曖昧なら`FOOTER_CANDIDATE_PRESERVED`を返し、removed=false。単に底本の文字が出ただけの文書をwarningだらけにしないため、この診断は旧strong-signal条件を満たすcandidateを新条件で拒否した時だけ。
4. **理由**: よくある正常footerは維持し、既知の過剰削除条件を限定して塞ぐ。原文削除の手前で不明を保持側へ倒す。
5. **正常影響**: 通常safe footerの本文+LFは同じ。偽日付、quote/code内、delimiterを含む末尾は保持される場合が増える。閉じた厳密`-----` pairに通常本文を入れる曖昧性、通常本文が本物同様のfooter構造を持つ場合の完全判別は未解決。
6. **fixture**: `annotation-suffix/unclosed/code`は入力維持、`footer-date-not-validated`はremoved=false、`footer-in-code`は保持。`footer-before-annotation`はfooterが厳密delimiter跨ぎを拒否し、その後の定型削除で`本文\n末尾`が残る。順序は変更しない。
7. **regression**: 正常closed pair、4/5ハイフン、odd/even pairs、codeを跨ぐpair、400行/末尾LF、親本だけ、日付閏年、blockquote、signal行途中、削除を拒否した時の本文bytes保持。
8. **両host**: 自動import時に削除を減らす。診断をpreviewできるが、preview UI自体は今回作らない。

### R15 — `PRESERVE_PROVENANCE_NO_SENTINEL`

1. **現行**: U+E000/1で囲まれた入力注記を意図的保持と誤認して警告抑制/marker除去する。
2. **問題**: 正当なPUA本文の変更と、入力からの診断抑制。
3. **新仕様**: 文書内へsentinelを一切挿入しない。`TrackedText{text, regions}`のcall-local regionに`preserved-note`とsource occurrence IDを登録する。成功変換でpreserve出力する注記だけ登録、未変換/既存directive skip/入力由来PUAは登録しない。後続editはrangeを移動し、削除/文字列が変化した部分のprovenanceを無効化する。同文言global set不可。exact noteがそのまま別の出力位置へcopyされた場合だけprovenanceをcopyできるが、普通の同文字列を検索して再attachしてはならない。final scannerはこれらの生存regionだけ除外。最終段14は「region情報をpublic文字列から分離するfinalize」とし、PUA strip操作は廃止する。普通のPUAは一切消さない。
4. **理由**: offset範囲の小さなside channelでcollisionを根本的になくせる。random sentinelや入力全体のescapeは不要。
5. **正常影響**: public最終text/preserve警告は正常ケースで同じ。単体converterの旧marker付き中間戻り値は新APIでは存在しないので、textとregionsへprojectionして比較する。前回保存したpreserve注記の再importではprovenanceがないため警告が復活し得る点は、永続sidecarを新規追加せず今回は維持する。
6. **fixture**: `scan-preserved`の生PUA入力は2件検出、`strip-preserved`相当のfinalizeは入力不変。各preserve converter fixtureは旧markerを期待するtestを「同じ注記text+正しいregion」へ移す。stale suppression integrationは維持する。
7. **regression**: PUA exact/partial/孤立、code内PUA、inputがgaijiからPUAを生成、同じ注記の別出現、footer/block削除後、FM移動/escapeでのregion無効化、supplementary前後offset、二回呼出しのstate漏れ。
8. **両host**: UTF8出力やVaultへ内部markerを渡さない。Workerには最終resultだけ送るかregionsをstructured-clone可能なplain dataとして送る。

### R16 — `JOB_STATS_COMMIT_ONLY`

1. **現行**: write前にremaining集計され、write失敗でも「未変換注記ありfile」へ加算される。
2. **問題**: 実際に作成できた成果物数と診断集計が食い違う。
3. **新仕様**: 文書ごとのConversionResultにはwriteと無関係にremainingを保持。JobStatsの`filesConverted/filesWithRemainingNotes/remainingNotes`は`WriteCommitted(fileId,result)`でだけ加算。`WriteFailed(fileId,error)`はerrorsだけ、失敗fileのresultは`failedResults`として別に参照可能。`Skipped`はfilesSkipped。eventはfileId＋attemptIdを持ち、同じ成功イベント再配送を二重加算しない。失敗後retry成功はfileを1度だけsuccess集計し、errorsは失敗attempt数として残す。cancelはerrorsでなくcancelledFiles。旧stats互換projectionにcancelledを混ぜない。
4. **理由**: 変換結果の診断と、保存済み成果物の集計を明確に分ける。
5. **正常影響**: 成功writeだけのbatchは従来と同じ。write失敗時のremaining batch countが0へ減る。conversion resultの警告を捨てない。
6. **fixture**: `pipeline/write-failure-stats`は文書remaining=1、JobStats errors=1、filesConverted/filesWithRemainingNotes/remainingNotes=0。raw Python JobStatsは変更しない。
7. **regression**: 成功/失敗/skip混在、重複commit event、failure→retry、cancel、archive-level error。pure reducerにfake eventを入力し検証。
8. **両host**: ObsidianはVault保存完了時にcommit。BrowserはdownloadのOS完了を観測できないため「artifact生成済み」をcommit境界にするか別delivery stateを使い、保存済みと表示しない。UI表現はhost contractに一致させる。

### R18 — `PORTABLE_FILENAME_AND_COLLISION_KEYS`

1. **現行**: CON等の予約名、DEL/space-only、OS byte長、Unicode/case衝突を十分に扱わない。
2. **問題**: 保存失敗、別作品への衝突、環境ごとに違う出力。
3. **新仕様**: basename/各directory segmentだけを受けるpure `sanitizeFilename`。従来の`/\\:*?"<>|`→`_`を維持、C0/C1制御（U+0000..001F,007F..009F）除去、外側のPython isspace相当の空白（全角spaceを含む）とdotを**一括して**trim、空/`.`/`..`はuntitled。Windows予約stem `CON/PRN/AUX/NUL/COM1..9/LPT1..9`（拡張子付き、大文字小文字違い、¹²³を含む該当COM/LPT）には先頭`_`を付与。元の正常Unicode名自体はnormalizeしない。max100 code pointsに加え、実際のsegment全体がUTF8 240bytes以内となるようcode point境界で切る。collision suffixとextensionのbytesを先に予約してbaseを縮め、縮めた結果の末尾trim/reserved/emptyを再検証。異常に長いextensionは許容拡張子md/txtのpolicy境界で拒否する。

   portable比較keyはsegmentごとにNFC＋Unicode lowercaseし、末尾space/dot除去後に比較する（表示名は元のまま）。casefold等でさらに広いaliasを持つhostは追加canonical identityを提供する。このkeyだけで全OS identityを証明しない。collision決定はR03、実保存保証はR04が担当。
4. **理由**: 一般名の見た目を維持して保存できない名前と衝突を安全に扱う。
5. **正常影響**: 通常短い作品名/著者名は同一。予約名、制御文字、space-only、長い補助面名は変わる。100文字ちょうどでもbyte予算で短くなることを明示する。
6. **fixture**: `filename-reserved`→`_CON`、`filename-dot-space`→`untitled`、`filename-control`→`ab`、`filename-unicode-length`→𠀀60個（extensionなし240bytes）。実拡張子/suffix込みは別test。
7. **regression**: CON.txt、com¹、normal「conical」、NFC/NFD同名、case違い、240byte境界、supplementary切断なし、suffix追加後再衝突、先頭dot/全角space、同名作者作品。
8. **両host**: Browser ZIPとObsidianへ同じproposalを渡し、host固有制約はさらに強める。[Windows公式の命名制約](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)

## 3. KEEPの範囲

### R02 — UTF-8出力

UTF-8出力はWeb/Obsidian共用に適したproduct behaviorとしてKEEP。**strict対象は「同じtextをUTF-8/LF方針で書く」結果であり、GUI option名や旧need_write/logの偶然の分岐ではない**。新APIに`convertUtf8`は置かず`outputEncoding:'utf-8'`を固定契約とする。UTF8をOFFにした旧Optionsを読み込む互換bridgeを将来作る場合は、無視せず「出力UTF8固定」を明示する。このbridge自体は今回のscope外。旧skip fixtureは変換coreのtext比較とadapter policyの比較を分離し、勝手に原本JobStatsを再現しない。

### R17 — directive内部の保守的保持

indent生成後、その内部の地付き/改ページが変換されない挙動をKEEP。無制限なdirective入れ子を作らないための保守的policyとして価値がある。`indent-protects-align-page`はtext/stats/remainingのstrict期待を維持する。残存注記は実際に未対応であり、誤警告として抑制しない。nested directive変換を必要とする場合は別設計・別承認とする。

## 4. DEFERと後続release gate

### R07 — 実ZIP runtimeの展開資源・中断

初回はZIP library/展開/host writerを作らないためDEFER。**無制限ZIP実装を暫定公開してよい、という意味ではない。** 後続ZIP adapterの完了条件を先に固定する。

- compressed input 64 MiB、全entry数2,000、単entry展開16 MiB、合計展開128 MiBを初期default policy値とする。これはPython互換値でも性能実測値でもない、保守的な製品設定。hostで小さくでき、上げる場合は明示設定と検証を必要とする。
- metadata宣言値だけでなく**実際に取り出したbytes**へlimitを適用し、不正宣言/zip bombも途中停止。nontextを含む全entry数/metadataを検証し、text以外のbytesは原則展開しない。ネストZIPは再帰処理しない。
- limit/cancel時はarchiveの新規write開始前なら0書込。streaming/先行commitを採用する場合は部分成功をmanifestで明示し、他fileやユーザーsourceをrollback削除しない。
- AbortSignal等をentry間・読出chunk間で検査。core同期変換の細粒度中断は別問題で、Worker停止と結果不採用の境界を示す。
- UTF8/CP932 decode単体も巨大inputでメモリを使うため、host input budgetとWorker実行を検証する。初回pure coreに本文を黙って切り捨てるlimitは入れない。

その他の限定DEFER: 全CommonMark互換、複数行inline code、文学的なheader/footer完全判別、preserve provenanceのファイル間永続化、host実filesystem raceの検証。この範囲は今回承認したFIXを広げる口実にしない。

## 5. Pipeline差分の監査

1〜13の変換順は維持。stage0はR13/R08のreadonly保護索引作成だけで本文を書き換えない。stage14はPUA stripからprovenance finalizeへ置き換える（R15）。これ以外の順序変更は未承認。

| 差 | 理由 | 主なfixture | risk / 防止 |
| --- | --- | --- | --- |
| stage0の字句索引 | code/FM本文を先に保護する必要 | protection-*、既存FM | 範囲を広げすぎない、code外正常例を必ず併記 |
| metadata reader/generator | 正規YAMLと無損失header | header-restore等 | 生FMは再serializeしない、round-tripとlegacyを分離 |
| stage14 finalize | PUA collision除去 | strip/scan/preserve | range移動/削除テスト、全入力PUA不変 |
| commit後JobStats | 書込結果の意味を正す | write-failure-stats | ConversionResultからwarningを消さない |

詳細な差分の許可はfixtureごと・fieldごとに限定する。IDがFIX NOWでも、そのmodule内の任意の挙動変更を許可するものではない。

## 出力境界の補足

F01はR08のenvelope境界規則の不備も含むため、上記のscalar優先と外側空白delimiterの扱いを明文化した。F03はraw_header空白値の出力profileを補完した。F02はR10の生成markup合成を明文化した。F04は全19 optional optionについて、省略／明示undefinedを既定値、明示falseをOFFとして扱うAPI契約を補完した。旧oracleや承認済み90 exact期待値を変更して失敗を許容していない。

## 空白を含むYAML値の補足

文字行のindentと末尾space/tab行・LFの組合せでもliteralが意味値を失う場合がある。R08の元文字列保持を実行時の候補parseで確認し、不一致の候補だけ安全なquoted形式へ切り替える。正常literal／既存期待値は維持する。
