# Rules リファレンス

`src/validate/rules/` の各 rule は `<area>/<short-name>` という安定した
識別子を持ち、これが `Issue.rule` および (将来の) `--rule` フィルタの
キーになる。下の表が registry 順 (renderer が issue を辿る順序と一致)
の正式な一覧。

severity カラムは、各 rule が profile ごとにどう発火するかを示す。
デフォルト profile は **`spec`** (WACZ spec + wabac.js 互換)。
各カラムの意味の詳細は下の [プロファイル](#プロファイル) を参照。

conformance カラムは、その rule が司る spec の **規範レベル**(RFC 2119 の
MUST / SHOULD / MAY)を示す。severity が「waxlens の影響判断・profile で変わる」
のに対し、conformance は「spec がそう定めている事実・profile に依存しない」
別軸である。1 つの rule が複数レベルに跨る場合は代表レベルを採る。

| #   | Name                                | conformance | spec    | browserhive | lenient | 何を捕まえるか                                                                     |
| --- | ----------------------------------- | ----------- | ------- | ----------- | ------- | ---------------------------------------------------------------------------------- |
| 1   | `wacz/required-files`               | MUST        | error   | error       | error   | WACZ §5.2 の MUST(`datapackage.json` / `pages/pages.jsonl` / `archive/` の WARC / `indexes/` の index)が欠落 |
| 2   | `datapackage/profile-required`      | MUST        | error   | error       | error   | `datapackage.json` の `profile` が `"data-package"` でない / 欠落(不在は #1 が担当) |
| 3   | `datapackage/wacz-version-required` | MUST        | error   | error       | warning | `wacz_version` が欠落 / 空。既知集合外の値は warning                               |
| 4   | `datapackage/resource-hashes`       | MUST        | error   | error       | error   | resource の sha256 hash または byte length が archive と一致しない                 |
| 5   | `datapackage/frictionless-schema`   | SHOULD      | warning | warning     | —       | `datapackage.json` が Frictionless v1 公式スキーマ (draft-04) に非適合 (補助・汎用構造の検査。lenient では除外) |
| 6   | `cdxj/index-recognised-by-wabac`    | MUST        | error   | error       | error   | `indexes/` 配下の index を wabac.js がロードできない(存在は #1、ロード可否はこちら) |
| 7   | `cdxj/index-not-gzipped`            | MAY         | warning | error       | info    | gzip された CDXJ が `.idx` とペアになっていない (browserhive では producer-strict) |
| 8   | `cdxj/filename-archive-relative`    | MUST        | error   | error       | warning | CDXJ の `filename` field が `archive/` で始まっている                              |
| 9   | `warc/storage-store`                | SHOULD      | warning | warning     | info    | `archive/data.warc.gz` が STORE ではなく DEFLATE で ZIP 格納されている             |
| 10  | `warc/members-independent`          | MUST        | error   | error       | error   | `.warc.gz` を独立した gzip member の連結としてデコードできない                     |
| 11  | `cdxj/warc-offsets`                 | MUST        | error   | error       | warning | CDXJ の offset/length が member 境界に当たらない                                   |
| 12  | `cdxj/pages-mainpage`               | SHOULD      | warning | warning     | info    | `datapackage.mainPageURL` が `pages.jsonl` および/または CDXJ に存在しない         |
| 13  | `warc/payload-digest`               | SHOULD      | warning | warning     | warning | `WARC-Payload-Digest` が payload bytes の sha256 と一致しない                      |
| 14  | `fuzzy/valid-json`                  | MAY         | info    | info        | info    | `fuzzy.json` が壊れている (not JSON / not object / `rules` array 欠落)             |
| 15  | `warc/extension-gzip-match`         | MUST        | warning | warning     | info    | archive の WARC の拡張子と中身の gzip 状態が不一致(GZIP なのに `.warc` / 非GZIP なのに `.warc.gz`) |
| 16  | `pages/page-schema`                 | MUST        | warning | warning     | info    | `pages/pages.jsonl` の page 行が valid JSON でない / `url`・`ts` を欠く            |
| 17  | `datapackage/digest`                | SHOULD      | warning | warning     | info    | `datapackage-digest.json` が不在(warning)/ `path`・`hash` 不正・hash 不一致(error) |
| 18  | `wacz/reserved-dirs-clean`          | MUST NOT    | warning | warning     | info    | 予約ディレクトリ `archive/` `indexes/` `pages/` にカスタムファイルがある          |
| 19  | `datapackage/resources-complete`    | MUST        | warning | warning     | info    | ZIP 内のファイルが `datapackage.json` の resources に未宣言(孤児)               |
| 20  | `datapackage/frictionless-structure` | MUST       | error   | error       | —       | Frictionless の構造 MUST 違反: `resources` が空でない配列でない / resource に `name` と `path`(か `data`)が無い(#5 の error 版。lenient では除外) |
| 21  | `cdxj/index-valid-data`             | MUST        | error   | error       | error   | `indexes/` の CDXJ(平文 `.cdxj` / gzip `.cdxj.gz` / `.idx` 経由の `.cdx.gz`)の中身が CDXJ として parse できない / gzip 展開できない(§5.2.2 MUST contain CDXJ data, MAY be gzip compressed) |
| 22  | `warc/recording-complete`           | MAY         | —       | info / warning | —     | **browserhive profile 限定**。WARC の `metadata` レコード(未完了/失敗の記録)の比率を可視化(比率 &gt; 10% で warning)。`spec` / `lenient` では除外 |

## Severity の凡例

- `error` — `valid` を `false` に反転、`summary.failed` に加算、exit code
  `1` を引き起こす。
- `warning` — 既知の producer バグ、または replay を劣化させるミス。
  ただし WACZ 自体はまだ使える可能性が高い。exit code には影響しない。
- `info` — 情報提供。spec が許容する producer の選択肢で、caller が
  知っておきたい類のもの。exit code には影響しない。

## プロファイル

`--profile <name>` で選択する (デフォルト `spec`)。profile は producer
固有 / 様式的な rule の severity を組み替えるためのもので、spec が
要求する check を抑止することはない。

- **`spec`** (デフォルト) — WACZ spec + wabac.js loader 互換。
  この profile で exit 0 になる archive は、
  [ReplayWeb.page](https://replayweb.page/) で正しく replay できる
  ことが期待される (wabac.js 自体のバグを除く)。
- **`browserhive`** — `spec` の上に BrowserHive のより厳しい producer
  慣習を重ねる。BrowserHive 生成の archive を明示的に想定するときに
  使う (例: `indexes/index.cdxj` を plain で、`.idx` とペアでも
  `.cdxj.gz` は許さない、など)。
- **`lenient`** — producer 固有 / 様式的な findings をすべて `info` に
  降格させる。legacy な archive をトリアージしていて、"replay が壊れる"
  類の hard error だけを見たいときに有用。

上の表が公式情報源。rule 単位の根拠は `src/validate/rules/` の各 rule
の `applicability` 宣言に書かれている。

## Rule 詳細

各 rule のソースファイルには、why と inline 参照を含む doc コメントが
ある。下の概要はそれを反映していて、出典は一貫して 3 つの形式で書く。

- **Spec**: 関連する WACZ / WARC / Frictionless-Data 仕様の節
- **Replay engine**: [wabac.js](https://github.com/webrecorder/wabac.js)
  (ReplayWeb.page の中で動くエンジン) が実際にどう扱うか
- **Reference producer**: 既知の producer が code 上でどこにそれを
  commit しているか (現状は
  [BrowserHive](https://github.com/uraitakahito/browserhive)。ただし
  rule の本体はコントラクトであって、特定の producer ではない)

### `wacz/required-files` — error (すべての profile)

WACZ [§5.2 Directories and Files](https://specs.webrecorder.net/wacz/1.1.1/#directories-and-files)
が MUST とするファイル/ディレクトリの **存在** を直接 assert する。
`datapackage.json` の `resources[]` 宣言には依存しないので、宣言が無い /
壊れている WACZ でも構造的な欠落を検出できる(「不在かつ未宣言」のギャップを
埋める)。チェックは 4 つ:

- §5.2.4 `datapackage.json`(root に存在)
- §5.2.3 `pages/pages.jsonl`(存在)
- §5.2.1 `archive/` に WARC を 1 つ以上(`*.warc` / `*.warc.gz`)
- §5.2.2 `indexes/` に index を 1 つ以上(`*.cdx` / `*.cdxj` / `*.idx`、gzip 可)

MUST 欠落は replay-breaking なので全 profile で `error`。`datapackage.json`
の存在はこの rule が担い、`datapackage/profile-required` は値の正しさに専念する。
`indexes/` の「存在」はここ、「wabac がロードできるか」は
`cdxj/index-recognised-by-wabac` が見る(観点が異なるため併存)。

### `datapackage/profile-required` — error

`datapackage.json` が存在するとき、その `profile` は `"data-package"` で
なければならない(不在自体は `wacz/required-files` が報告する)。profile が
無い / 値が違うと wabac.js / ReplayWeb.page が WACZ を invalid と判定して
CDX lookup が走らず、それ以外がすべて正しくても "Archived Page Not Found"
の分かりにくいエラーが出る。

- **Spec**: WACZ 1.1 §datapackage.json (Frictionless Data Package のマーカー)
- **Reference producer**: [browserhive `wacz/datapackage.ts:42-49`](https://github.com/uraitakahito/browserhive/blob/main/src/storage/wacz/datapackage.ts)
  に silent-fail trap が直接書かれている。

### `datapackage/wacz-version-required` — error

`wacz_version` field は空でない文字列である必要がある。認識される値は
`1.0.0` / `1.1.0` / `1.1.1` の 3 つ。それ以外の値は `warning` レベルの
issue として上げて、operator が waxlens を更新するか未知バージョンを
受け入れるかを判断できるようにする。

- **Spec**: [WACZ format specs](https://specs.webrecorder.net/wacz/)

### `datapackage/resource-hashes` — error

`datapackage.json#resources[]` の各エントリは、他のいずれかの ZIP
エントリの `sha256:<hex>` hash と byte length を宣言する。この rule は
両方を実際の bytes から再計算して、ミスマッチを `details` に
expected/actual の hash として上げる (TUI では diff として表示される)。

### `datapackage/frictionless-schema` — warning (補助)

`datapackage.json` を Frictionless Data Package **v1** の公式 JSON Schema
(draft-04、`src/validate/frictionless/data-package.schema.json` に vendoring)
で検証する補助 rule。WACZ 固有 rule (profile / resource-hashes / wacz-version)
が拾わない「汎用 descriptor としての奇形」(`resources` が無い、resource に
`name`/`path` が無い、`name` が `^([-a-z0-9._/])+$` 外、`hash` が
`sha256:<hex>` 形式でない、など) を ajv で検出し、ajv の各エラーを 1 件ずつ
`warning` として上げる (`details` に `instancePath` / `keyword` / `params`)。

公式スキーマは `additionalProperties` を閉じないため `wacz_version` /
`mainPageURL` などの WACZ 拡張は弾かれない。一方 `name` の小文字パターン等
WACZ より厳しい箇所があるので severity は `error` ではなく `warning` とし、
legacy トリアージ用の `lenient` profile では除外する。スキーマ更新は
`scripts/update-frictionless-schema.sh`、改ざん検知は pin テストで担保。

### `datapackage/frictionless-structure` — error

WACZ 1.1.1 は「`datapackage` は FRICTIONLESS-DATA-PACKAGE に **MUST** 準拠」と
定める。そのうち**正当な WACZ なら必ず満たす構造要件だけ**を `error` で見る:

- 最上位 `resources` が**空でない配列**であること
  (<https://specs.frictionlessdata.io/data-package/#required-properties>)
- 各 resource が **`name`** と、**`path`(または `data`)** を持つこと
  (<https://specs.frictionlessdata.io/data-resource/>)

`parseDatapackage` で object に shape できたときだけ動き、`datapackage.json` の
不在 / JSON 不正は #2 `datapackage/profile-required` に委譲する。

補助 rule #5 `frictionless-schema`(warning)との関係: あちらは公式スキーマ全体
(`name` の小文字パターン等、WACZ より厳しい stylistic を含む)を warning で見る
catch-all。こちらは誤検知しない構造 MUST だけを切り出して `error`(= validity を
落とす)にしたもの。構造違反は両方に出るが、`error` = 必ず直す / `warning` =
スキーマ注記、と役割が異なる。legacy トリアージ用の `lenient` では除外する。

### `cdxj/index-recognised-by-wabac` — error (すべての profile)

WACZ は `indexes/` 配下に少なくとも 1 つ、wabac.js が実際にロードできる
エントリを持つ必要がある。loader は 3 つの suffix を認識する — `.cdx`、
`.cdxj`、`.idx` (最後のものは `.idx` 内の
`!meta { format: "cdxj-gzip-1.0", filename }` header で名前指定された
`.cdx.gz` とペアになる)。`.idx` ペアの無い裸の `.cdx.gz` / `.cdxj.gz` は
wabac.js に silent に skip されるため、replay が index を得られず
すべての URL lookup が失敗する。この rule は producer に依存せず
replay-breaking な問題なので、すべての profile で `error` 発火する。

`.idx` が存在するがそれが指すファイルが ZIP に無い場合は `warning` を
発火する (`.idx` 自体はロードされるが、すべての lookup が miss する)。

- **Replay engine**: [wabac.js `multiwacz.ts:loadIndex`](https://github.com/webrecorder/wabac.js/blob/main/src/wacz/multiwacz.ts)
  — 直接ロードは `endsWith(".cdx") || endsWith(".cdxj")`、加えて
  compressed index 用に `endsWith(".idx")`。

### `cdxj/index-valid-data` — error (すべての profile)

WACZ §5.2.2 は「Index files MUST contain CDXJ data and MAY be gzip
compressed」と定める。`indexes/` 配下の CDXJ を `parseCdxj` に通し、
CDXJ として読めない行(`invalid-json` / `json-not-object` /
`missing-fields` / `empty-surt-or-timestamp`)を行ごとに `error` で
報告する。対象は **平文 `.cdxj`**、**gzip された `.cdxj.gz`**、および
**`.idx` が `!meta.format: "cdxj-gzip-1.0"` で名指す `.cdx.gz`**(pywb /
webrecorder layout)で、gzip 系は `gunzipSync` で展開してから検証する。
`.gz` と名乗るのに展開できない場合も `error`(中身を CDXJ として読めない
以上 §5.2.2 違反)。

平文 `.cdx`(`.gz` 無し)は legacy の列指向 CDX で JSON でないため対象外
(誤検知回避)。`.cdx.gz` は `.idx` の宣言があるときだけ CDXJ と確定する。
index の **存在 / ロード可否** は `cdxj/index-recognised-by-wabac`、
**gzip 状態の妥当性** は `cdxj/index-not-gzipped`、**中身が CDXJ か** は
この rule、と観点を分担する。中身が壊れた index は wabac.js が index を
構築できず replay-breaking なので、producer に依存せず全 profile で `error`。

この parse 妥当性チェックは元々 `cdxj/filename-archive-relative` に
併発報告として紛れ込んでいた(ハードコードした `indexes/index.cdxj`
1 本のみ・lenient で warning 降格)。本 rule に集約し、`indexes/` 配下の
CDXJ(平文・gzip 問わず)を全 profile で `error` に統一した。なお pywb の
sparse な block 単位 `.cdx.gz` は entry 全体を `gunzipSync`(単一/連結
member)で展開する実装で、`.idx` の offset による部分展開は将来拡張。

- **Spec**: [§5.2.2 indexes](https://specs.webrecorder.net/wacz/1.1.1/#indexes)
  「Index files MUST contain CDXJ data and MAY be gzip compressed [PYWB-CDXJ]」

### `cdxj/index-not-gzipped` — warning (spec) / error (browserhive) / info (lenient)

wabac-recognition コントラクトの producer-strict バリアント。producer
が plain な `indexes/index.cdxj` を出すことが期待されている場合、この
rule は `.cdxj.gz` / `.cdx.gz` バリアント (または content が gzip magic
で始まる `.cdxj` ファイル) を表面化する。デフォルト profile では
`warning` レベル — spec 準拠の `.cdx.gz` が `.idx` とペアになっていれば
問題ないため。厳格な `browserhive` profile は plain な形を BrowserHive が
commit しているため `error` に escalate する。

- **Replay engine**: [wabac.js `multiwacz.ts:loadIndex`](https://github.com/webrecorder/wabac.js/blob/main/src/wacz/multiwacz.ts)
  — 直接認識されるのは `.cdx`、`.cdxj`、`.idx` の 3 つだけ。
- **Reference producer**: [browserhive `wacz/packager.ts:46-56`](https://github.com/uraitakahito/browserhive/blob/main/src/storage/wacz/packager.ts)
  は plain な `indexes/index.cdxj` を commit している。

### `cdxj/filename-archive-relative` — error

各 CDXJ row の `filename` field は、WACZ の `archive/` ディレクトリから
の **相対** パスで WARC ファイル名を指す必要がある (例: `data.warc.gz`。
`archive/data.warc.gz` ではない)。wabac.js は `archive/` を自分で先頭に
付けるため、フルパスを書くと `archive/archive/data.warc.gz` を探しに
行って全 URL が 404 になる。

CDXJ が **そもそも parse できるか**(§5.2.2 MUST contain CDXJ data)は
`cdxj/index-valid-data` の専任。この rule は parse 済み entry の `filename`
だけを見る。

- **Reference producer**: [browserhive `wacz/packager.ts:36-44`](https://github.com/uraitakahito/browserhive/blob/main/src/storage/wacz/packager.ts)
  で定数名が `WARC_FILENAME_FOR_CDX` で、コメントに同じ落とし穴が説明
  されている。

### `warc/storage-store` — warning

`archive/data.warc.gz` は STORE 方式 (ZIP レベルでは無圧縮) で格納する
べきである。内側の WARC は既に gzip 済みなので、その上から zip 圧縮
すると展開のメリットゼロで size が膨らみ、CDXJ offset を通じて ZIP
の raw bytes に seek する indexer を壊す。エントリ全体をメモリに読む
タイプのツールはまだ動くため、これは `error` ではなく `warning`。
どちらのタイプの downstream consumer が来るか判定できないので、抑止
ではなく表面化する側に倒している。

### `warc/members-independent` — error

WARC spec に従って作られた `.warc.gz` は、独立した gzip member の連結
である (record 1 つにつき 1 member)。これにより CDXJ index の
offset/length ペアを使って、他を decode せずに single record まで seek
できる。この rule は strict-mode decoding でファイルを iterate し、
失敗があれば offending offset と underlying な zlib エラーメッセージを
`details` に上げる。

### `cdxj/warc-offsets` — error

各 CDXJ row の `offset` / `length` は、independent gzip member の
開始位置に必ず当たり、かつその member の compressed length と一致する
必要がある。この rule は CDXJ エントリと WARC の実 member 境界をクロス
チェックして、ミスマッチがあれば「要求された range」と「該当 offset の
candidate に実在する record header」(TUI の WARC-header view) の両方を
expose する。これにより operator は、CDXJ row が間違った record を
指しているのか、WARC 自体が書き換わっているのかを判別できる。

### `cdxj/pages-mainpage` — warning

`datapackage.mainPageURL` は `pages/pages.jsonl` **と** `indexes/index.cdxj`
の両方に出現するべきである。どちらか片方の gap でも、WACZ 構造を
壊さずに replay landing page を silent に壊す。WACZ の他の部分は
deep-link replay 可能でありうるため、severity は `warning`。

### `warc/payload-digest` — warning

`WARC-Payload-Digest` は record の payload に対する新しい sha256 と
一致する必要がある。"Payload" は WARC 1.1 §6.2 に従って record type
ごとに異なる。

- `warcinfo` / `metadata` / `resource` — body をそのまま
- `response` / `request` — HTTP entity body (内側の `\r\n\r\n` 区切りの
  あとの bytes)
- `revisit` — 意図的にチェックしない (revisit record は他 record の
  digest を再記述するだけで、自身に payload を持たない)

非 sha256 アルゴリズム (例: `sha1:`) を出す producer は、warning ではなく
info レベルの note として受け入れる。spec が任意の `algorithm:value` を
許容しており、waxlens は spec-coverage suite ではないため。ミスマッチの
`details` には payload 先頭 256 bytes の hex preview が入っているので、
operator はその record が claim している resource の bytes として
見た目が妥当かを目視確認できる。

### `warc/recording-complete` — info / warning(browserhive profile 限定)

一部の producer(browserhive)は、失敗した / 途中で打ち切った HTTP 取得を
通常の `response` ではなく `WARC-Type: metadata` レコード
(`application/warc-fields` body: `incomplete: true` / `reason: loadingFailed` /
`skipBodyReason: ...`)として記録する。この rule はその metadata を数え、
`response` を分母にした「未完了比率」を可視化する。比率が 10% を超えると
`info` から `warning` に上げ、`details.recording` に内訳(failed / incomplete /
truncated / blocked)とサンプル URL を載せる(TUI の Recording health パネルが描画)。
producer が metadata に `resourceType` / `blockedReason`(案3)を載せていれば、
`details.recording.byResourceType` / `byBlockedReason` に種別ごとの件数も集計し、
TUI は `by type` / `blocked` 行として描く(無ければ行を出さない)。

この metadata 慣習は WARC/WACZ 規格そのものではなく browserhive 固有なので、
`applicability.excludeProfiles` で `spec` / `lenient` を除外し、`--profile browserhive`
のときだけ走る。未完了レコードは「実際に起きた HTTP の正しい記録」で spec 違反では
ないため severity は info/warning(`valid` は落とさない)。動的/状態依存トラフィック
(広告 RTB・解析ビーコン)は記録できても再生で再現できないため、多い場合は収集側で
ブロックすることを検討する。

### `fuzzy/valid-json` — info

`fuzzy.json` は WACZ spec 上 optional だが、browserhive は無条件で emit
する。存在する場合、top-level が object で `rules` array を持つ valid
JSON である必要がある。それ以外は replay engine が silent に無視する —
replay-breaking なバグではなく informational。

### `warc/extension-gzip-match` — warning

archive 内の各 WARC について、中身が gzip かどうか(先頭 2 byte の magic
`1f 8b`)と拡張子の整合を見る。GZIP なのに `.warc.gz` でない、または非 GZIP
なのに `.warc.gz`、を warning で報告する。replay は CDXJ の `filename` 経由で
解決されるため壊れない(命名規約)が、拡張子で圧縮状態を判断するツールが
誤動作しうる。

- **Spec**: [§5.2.1 archive](https://specs.webrecorder.net/wacz/1.1.1/#archive)
  「非 GZIP は `.warc`(SHOULD)、GZIP は `.warc.gz`(MUST)」

### `pages/page-schema` — warning

`pages/pages.jsonl` の各 'Page' 行(1 行目のヘッダを除く)が valid JSON で
`url` と `ts` を持つかを検査する(WACZ §5.2.3 の MUST)。Page 一覧
(ReplayWeb.page の Page 選択)は壊れるが、URL 単位の replay は CDXJ 経由で
動くため severity は warning。

### `datapackage/digest` — warning / error

WACZ §5.2.5 の `datapackage-digest.json`。不在なら warning(SHOULD 存在)。
存在する場合は `path` = `"datapackage.json"` と `hash` を MUST とし、`hash` が
実際の `datapackage.json` の sha256(`datapackage/resource-hashes` と同じ計算)
と一致しなければ error(expected/actual を `details` に出す)。

### `wacz/reserved-dirs-clean` — warning

予約ディレクトリ `archive/` / `indexes/` / `pages/` に、それぞれの想定
(WARC / index / `*.jsonl`)以外の異物ファイルがあれば warning。WACZ は
これらの予約ディレクトリにカスタムファイルを追加してはならない(MUST NOT)。
追加ファイルは root 等に置き resources に列挙する。

### `datapackage/resources-complete` — warning

ZIP 内の実ファイルが、すべて `datapackage.json` の resources に列挙されて
いるかを見る(WACZ MUST)。`datapackage/resource-hashes` が「宣言 → 実体」を
見るのに対し、こちらは逆方向「実体 → 宣言」で未宣言の孤児を検出する。
マニフェスト自身(`datapackage.json` / `datapackage-digest.json`)は対象外。

## 対象外: HTTP 配信要件

WACZ spec の以下は **WACZ ファイルそのもの**ではなく、それを配信する
**web サーバ**の挙動に関する要件であり、ファイルの bytes からは検証できない
(HTTP エンドポイントへの probe が必要)。waxlens は file validator なので
スコープ外とする:

- `Content-Length` ヘッダ(MUST)/ HTTP range requests のサポート(MUST)
- `Accept-Ranges` ヘッダ(SHOULD)/ CORS `access-control-allow-origin`(SHOULD)
- Media Type `application/wacz`(SHOULD)

## 新しい rule を追加する

1. `src/validate/rules/<area>-<short-name>.ts` を作る。`name` がファイル
   名 (kebab-case) と一致する `ValidationRule` object を export する。
2. WACZ spec / wabac.js / browserhive のうち rule の根拠になるものへの
   参照と、severity の根拠を doc コメントに含める。
3. `src/validate/rules/index.ts` の `DEFAULT_RULES` に rule を追加する。
4. `test/fixtures/generator.ts` に fixture バリアントを足し、
   `test/validate.test.ts` で happy path と破損パターンの両方を
   exercise する test を書く。
5. (Optional) TUI 向きの `details` shape を attach して、expanded view
   で具体的に何が起きているかを operator に伝える。利用可能な
   specialised view は以下のとおり: `{ expected, actual }` → diff、
   `{ warcHeader: string[] }` → header preview、
   `{ hexPreview: string[] }` → hex dump、
   `{ candidates: [...] }` → nearby-members list。それ以外は
   JSON-pretty に fallback する。
