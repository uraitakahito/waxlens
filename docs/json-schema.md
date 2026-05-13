# `--json` 出力スキーマ

schema は `0.x` ライン中 pin される — 将来の `1.0.0` リリースで break
される可能性はあるが、その場合はそのタグの GitHub Release body に
migration note を付ける。下に書いてある field に対してスクリプトを
書くなら、patch / minor リリースでは引き続き動き続けるはず。

renderer はエンジンが生成するのと同じ `Report` object を消費する。
`--json` はその文字列化であって、別個の "machine view" ではない。
つまりこの doc に載っている field は TUI も使っているし、その逆も成り立つ。

## トップレベル: `WaxlensReport`

```ts
interface WaxlensReport {
  /** Producer version, mirroring `package.json#version`. */
  waxlensVersion: string;
  /** Rule profile the report was evaluated under. See docs/rules.md → Profiles. */
  profile: "spec" | "browserhive" | "lenient";
  /** The path the operator gave to the CLI (verbatim — not resolved). */
  file: string;
  /** Convenience field, equivalent to `summary.failed === 0`. */
  valid: boolean;
  summary: ReportSummary;
  /** Per-rule issues in registration order (see docs/rules.md). */
  issues: Issue[];
  /** Best-effort archive metadata. Absent if the WARC could not be read at all. */
  stats?: ReportStats;
}
```

`profile` 値には `--profile` で選ばれたものがそのまま入る (デフォルト
`spec`)。report ごとに pin されるので、複数 run の report を取り込む
downstream consumer が、それぞれどの severity policy で評価されたかを
out-of-band な metadata なしに判定できる。

## `ReportSummary`

```ts
interface ReportSummary {
  /** Rules that produced no error-severity issue. */
  passed: number;
  /** Error-severity issue count (NOT rule count). Drives exit code 1. */
  failed: number;
  /** Warning-severity issue count. Never affects exit code. */
  warnings: number;
  /** Info-severity issue count. Never affects exit code. */
  info: number;
  /** Wall-clock time the engine spent running the rule set. */
  durationMs: number;
}
```

注: `summary.passed + failingRules = totalRules`。"passed" を issue
ベースではなく rule ベースで数えることで、warning を複数出した rule も
"passed" として数えられる (fail はしていない)。これは operator が期待
する headline と一致する。

## `Issue`

```ts
type Severity = "error" | "warning" | "info";

interface Issue {
  /** Stable `<area>/<short-name>` identifier — see docs/rules.md. */
  rule: string;
  severity: Severity;
  /** One-line human summary. Not localised; not reformatted across versions. */
  message: string;
  location?: IssueLocation;
  /**
   * Structured payload the TUI may render in a specialised view (see below).
   * Always JSON-serialisable. Shape is rule-specific; consumers should
   * narrow by `rule` before deep-reading.
   */
  details?: unknown;
}

interface IssueLocation {
  /** zip entry name where the problem was found, when applicable. */
  entry?: string;
  /** 1-based line number inside a text entry (CDXJ, pages.jsonl). */
  line?: number;
  /** Byte offset inside a binary entry (WARC). */
  offset?: number;
}
```

### 認識される `details` の形

現在の renderer (特に TUI) は下記の key を探して、それぞれ専用 view に
render する。それ以外の key は JSON-pretty ブロックに fallback するので、
field を足しても情報が silent に落ちることはない。

| Key                     | Type        | 利用元                              | レンダリング                       |
| ----------------------- | ----------- | ----------------------------------- | ---------------------------------- |
| `expected` AND `actual` | any         | hash / digest / wacz_version 系 rule | green/red サイドバイサイドの diff |
| `warcHeader`            | `string[]`  | `cdxj/warc-offsets`                 | WARC header の行リスト             |
| `hexPreview`            | `string[]`  | `warc/payload-digest`               | xxd 形式の hex dump                |
| `candidates`            | `unknown[]` | `cdxj/warc-offsets`                 | 近接 member の 1 行 1 件リスト     |

`expected` だけ (または `actual` だけ) は JSON pretty に fallback する
— diff view は両方が要る。これは意図的: どちらかを合成して埋めると、
human view と machine view の信頼性が崩れるため。

## `ReportStats`

```ts
interface ReportStats {
  /** Number of independent gzip members the WARC iterator yielded. */
  warcRecordCount: number;
  /** Byte length of `archive/data.warc.gz` (zip-uncompressed). */
  warcArchiveBytes: number;
  /** Distinct hosts mentioned in CDXJ entries' `url` field (sorted). */
  hosts: string[];
}
```

stats は validation と並列に best-effort で計算される。WARC が壊れて
いる場合、report を fail させるのではなくこの field を省く。renderer
は summary の下に
`<recordCount> records · <archiveBytes> · <hostCount> hosts` の形で
表示する。

## 安定性の約束

`0.x` ライン中:

- **field の追加は non-breaking。** consumer は認識しない field を
  許容する必要がある。
- **field の削除 / リネームは breaking** であり、minor bump
  (0.x → 0.(x+1)) で行う。
- **`rule` 識別子は同じ check に対して変わらない。** rename された
  rule は新しい rule として扱う (古い方は削除され、切り替えタグの
  GitHub Release body に rename が記載される)。
- **severity の downgrade** (error → warning) は minor bump、
  **upgrade** (warning → error) は major bump。
- **`summary.passed` の意味** (rule 単位カウント) は固定。

## 例: valid な WACZ

```json
{
  "waxlensVersion": "0.0.0",
  "file": "/tmp/good.wacz",
  "valid": true,
  "summary": {
    "passed": 11,
    "failed": 0,
    "warnings": 0,
    "info": 0,
    "durationMs": 12
  },
  "issues": [],
  "stats": {
    "warcRecordCount": 1,
    "warcArchiveBytes": 246,
    "hosts": ["example.com"]
  }
}
```

## 例: diff 付きの failure

```json
{
  "waxlensVersion": "0.0.0",
  "file": "/tmp/bad-hash.wacz",
  "valid": false,
  "summary": { "passed": 10, "failed": 1, "warnings": 0, "info": 0, "durationMs": 14 },
  "issues": [
    {
      "rule": "datapackage/resource-hashes",
      "severity": "error",
      "message": "Resource \"archive/data.warc.gz\" hash mismatch",
      "location": { "entry": "archive/data.warc.gz" },
      "details": {
        "expected": "sha256:dead0000…00ff",
        "actual": "sha256:9a8b…c2e1"
      }
    }
  ],
  "stats": { "warcRecordCount": 1, "warcArchiveBytes": 246, "hosts": ["example.com"] }
}
```
