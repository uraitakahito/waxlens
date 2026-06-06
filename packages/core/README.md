# @waxlens/core

WACZ validation engine。machine-readable な JSON report を stdout に出力する。rule は WACZ spec と [wabac.js](https://github.com/webrecorder/wabac.js) replay engine の実際の loader 挙動から導出されており、既知 producer に対するより厳しい check 用に producer 固有 profile も任意で選べる。

この engine の上で動く interactive な terminal UI が必要なら
[`@waxlens/tui`](https://github.com/uraitakahito/waxlens/tree/main/packages/tui)
を使う。

## CLI: `waxlens-validate`

サンプル WACZ で試したい場合は Webrecorder 公開の
[`webrecorder/example-webarchive`](https://github.com/webrecorder/example-webarchive)
から小さい archive を取得できる:

```sh
mkdir -p /tmp/waxlens-demo
curl -sL \
  https://raw.githubusercontent.com/webrecorder/example-webarchive/main/items/wikipedia/archive.wacz \
  -o /tmp/waxlens-demo/wikipedia.wacz
```

以降の例の `<path>` はこの `/tmp/waxlens-demo/wikipedia.wacz` に
読み替えると動かせる:

```sh
# Local file
waxlens-validate <path>
# S3 (AWS credentials は default credential chain — env / shared config / IAM role)
waxlens-validate s3://<bucket>/<key>.wacz
# spec (default) | browserhive | lenient
waxlens-validate <source> --profile <name>
```

rule 別の失敗例や profile 差を試したい場合は、20 標本を揃えた
[waxlens-corpus](https://github.com/uraitakahito/waxlens-corpus) を使う —
入手方法とカタログは
[`docs/examples.md`](https://github.com/uraitakahito/waxlens/blob/main/docs/examples.md)。

### Exit codes

| Code | 意味                                             |
| ---- | ------------------------------------------------ |
| `0`  | validation 成功 — `error` severity の issue なし |
| `1`  | validation 失敗 — `error` issue が 1 件以上      |
| `2`  | operational な失敗 (ファイルが開けないなど)      |

warning / info レベルの issue が exit code を反転させることは無い。

### 出力 schema

stdout には `WaxlensReport` が出力される。full schema は
[`docs/json-schema.md`](https://github.com/uraitakahito/waxlens/blob/main/docs/json-schema.md)
を参照。短い例:

```json
{
  "waxlensVersion": "0.0.0",
  "profile": "spec",
  "source": { "kind": "file", "path": "/tmp/good.wacz" },
  "valid": true,
  "summary": { "passed": 12, "failed": 0, "warnings": 0, "info": 0, "durationMs": 12 },
  "issues": [],
  "stats": { "warcRecordCount": 1, "warcArchiveBytes": 246, "hosts": ["example.com"] }
}
```

### プロファイル

| Profile             | こういうときに使う                                                                  |
| ------------------- | ----------------------------------------------------------------------------------- |
| `spec` (デフォルト) | WACZ-spec + wabac.js 互換を求めたい。ほとんどの consumer はこれ。                   |
| `browserhive`       | BrowserHive capture を検証する。producer-strict な check を有効化。                 |
| `lenient`           | legacy archive をトリアージしたい。"replay が壊れる" 系の hard error だけが欲しい。 |

### 環境変数

| Env                                                          | 用途                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | SDK 標準 — credentials / region。SDK の default chain がそのまま読む。                            |
| `AWS_ENDPOINT_URL_S3`                                        | SDK 標準 (v3.395+) — bundled SeaweedFS のような非 AWS endpoint を向くときに。                     |
| `WAXLENS_S3_FORCE_PATH_STYLE`                                | `"true"` のときだけ `forcePathStyle: true` を立てる。SeaweedFS / MinIO 等の path-style addressing 用。 |

bundled SeaweedFS の compose stack は repo root の `compose.{dev,prod}.yaml`
を参照。

rule 単位の profile 別 severity matrix は
[`docs/rules.md`](https://github.com/uraitakahito/waxlens/blob/main/docs/rules.md)
を参照。

## ライブラリとしての使い方

```ts
import {
  runValidation,
  WaczReader,
  DEFAULT_RULES,
  parseReportSource,
  fileTransport,
  s3Transport,
} from "@waxlens/core";

// Local file でも s3:// URI でも、`parseReportSource` が transport を
// 判定して `Result<ReportSource, …>` を返す。`source.kind` で
// `fileTransport` / `s3Transport` を選び、`WaczReader.open` に渡す。
// s3 は接続設定 `forcePathStyle` を足した ResolvedS3Source を渡す。
const parsed = parseReportSource("/path/to/file.wacz");
// または: parseReportSource("s3://bucket/key.wacz");
if (!parsed.ok) throw new Error(parsed.error.kind);
const source = parsed.value;

const transport =
  source.kind === "s3"
    ? s3Transport({ ...source, forcePathStyle: false })
    : fileTransport(source.path);

const reader = await WaczReader.open(transport);
try {
  const result = await runValidation(reader, {
    waxlensVersion: "0.0.0",
    rules: DEFAULT_RULES,
    profile: "spec",
  });
  if (result.ok) console.log(JSON.stringify(result.value, null, 2));
} finally {
  await reader.close();
}
```

`WaczReader.source` が `Report.source` の唯一の入力経路。`runValidation`
は reader から自動で取るので caller が path を二度渡す必要はない。
`forcePathStyle` は `ResolvedS3Source` で指定する (SeaweedFS / MinIO 等の
S3 互換 endpoint 向け)。これは接続設定なので `Report.source` の wire
format (`{ kind, uri }`) には出ない。さらに細かい transport 制御が必要なら
`WaczTransport` interface を自前実装すればよい。

default export shape (`@waxlens/tui` が消費するもの一式) は
`src/public.ts` にある。
