# Rules リファレンス

`src/validate/rules/` の各 rule は `<area>/<short-name>` という安定した
識別子を持ち、これが `Issue.rule` および (将来の) `--rule` フィルタの
キーになる。下の表が registry 順 (renderer が issue を辿る順序と一致)
の正式な一覧。

severity カラムは、各 rule が profile ごとにどう発火するかを示す。
デフォルト profile は **`spec`** (WACZ spec + wabac.js 互換)。
各カラムの意味の詳細は下の [プロファイル](#プロファイル) を参照。

| #   | Name                                | spec    | browserhive | lenient | 何を捕まえるか                                                                     |
| --- | ----------------------------------- | ------- | ----------- | ------- | ---------------------------------------------------------------------------------- |
| 1   | `datapackage/profile-required`      | error   | error       | error   | `datapackage.json` の欠落、または `profile: "data-package"` 違反                   |
| 2   | `datapackage/wacz-version-required` | error   | error       | warning | `wacz_version` が欠落 / 空。既知集合外の値は warning                               |
| 3   | `datapackage/resource-hashes`       | error   | error       | error   | resource の sha256 hash または byte length が archive と一致しない                 |
| 4   | `cdxj/index-recognised-by-wabac`    | error   | error       | error   | `indexes/` 配下に `.cdx` / `.cdxj` / `.idx` が無く、wabac.js が何もロードできない  |
| 5   | `cdxj/index-not-gzipped`            | warning | error       | info    | gzip された CDXJ が `.idx` とペアになっていない (browserhive では producer-strict) |
| 6   | `cdxj/filename-archive-relative`    | error   | error       | warning | CDXJ の `filename` field が `archive/` で始まっている                              |
| 7   | `warc/storage-store`                | warning | warning     | info    | `archive/data.warc.gz` が STORE ではなく DEFLATE で zip 格納されている             |
| 8   | `warc/members-independent`          | error   | error       | error   | `.warc.gz` を独立した gzip member の連結としてデコードできない                     |
| 9   | `cdxj/warc-offsets`                 | error   | error       | warning | CDXJ の offset/length が member 境界に当たらない                                   |
| 10  | `cdxj/pages-mainpage`               | warning | warning     | info    | `datapackage.mainPageURL` が `pages.jsonl` および/または CDXJ に存在しない         |
| 11  | `warc/payload-digest`               | warning | warning     | warning | `WARC-Payload-Digest` が payload bytes の sha256 と一致しない                      |
| 12  | `fuzzy/valid-json`                  | info    | info        | info    | `fuzzy.json` が壊れている (not JSON / not object / `rules` array 欠落)             |

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

### `datapackage/profile-required` — error

`datapackage.json` は `profile: "data-package"` を必ず指定する必要が
ある。これが無いと wabac.js / ReplayWeb.page が WACZ を invalid と
判定して CDX lookup が走らず、それ以外がすべて正しくても "Archived Page
Not Found" の分かりにくいエラーが出る。

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

`datapackage.json#resources[]` の各エントリは、他のいずれかの zip
エントリの `sha256:<hex>` hash と byte length を宣言する。この rule は
両方を実際の bytes から再計算して、ミスマッチを `details` に
expected/actual の hash として上げる (TUI では diff として表示される)。

### `cdxj/index-recognised-by-wabac` — error (すべての profile)

WACZ は `indexes/` 配下に少なくとも 1 つ、wabac.js が実際にロードできる
エントリを持つ必要がある。loader は 3 つの suffix を認識する — `.cdx`、
`.cdxj`、`.idx` (最後のものは `.idx` 内の
`!meta { format: "cdxj-gzip-1.0", filename }` header で名前指定された
`.cdx.gz` とペアになる)。`.idx` ペアの無い裸の `.cdx.gz` / `.cdxj.gz` は
wabac.js に silent に skip されるため、replay が index を得られず
すべての URL lookup が失敗する。この rule は producer に依存せず
replay-breaking な問題なので、すべての profile で `error` 発火する。

`.idx` が存在するがそれが指すファイルが zip に無い場合は `warning` を
発火する (`.idx` 自体はロードされるが、すべての lookup が miss する)。

- **Replay engine**: [wabac.js `multiwacz.ts:loadIndex`](https://github.com/webrecorder/wabac.js/blob/main/src/wacz/multiwacz.ts)
  — 直接ロードは `endsWith(".cdx") || endsWith(".cdxj")`、加えて
  compressed index 用に `endsWith(".idx")`。

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

- **Reference producer**: [browserhive `wacz/packager.ts:36-44`](https://github.com/uraitakahito/browserhive/blob/main/src/storage/wacz/packager.ts)
  で定数名が `WARC_FILENAME_FOR_CDX` で、コメントに同じ落とし穴が説明
  されている。

### `warc/storage-store` — warning

`archive/data.warc.gz` は STORE 方式 (zip レベルでは無圧縮) で格納する
べきである。内側の WARC は既に gzip 済みなので、その上から zip 圧縮
すると展開のメリットゼロで size が膨らみ、CDXJ offset を通じて zip
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

### `fuzzy/valid-json` — info

`fuzzy.json` は WACZ spec 上 optional だが、browserhive は無条件で emit
する。存在する場合、top-level が object で `rules` array を持つ valid
JSON である必要がある。それ以外は replay engine が silent に無視する —
replay-breaking なバグではなく informational。

## 新しい rule を追加する

1. `src/validate/rules/<area>-<short-name>.ts` を作る。`name` がファイル
   名 (kebab-case) と一致する `ValidationRule` object を export する。
2. WACZ spec / wabac.js / browserhive のうち rule の根拠になるものへの
   参照と、severity の根拠を doc コメントに含める。
3. `src/validate/rules/index.ts` の `ALL_RULES` に rule を追加する。
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
