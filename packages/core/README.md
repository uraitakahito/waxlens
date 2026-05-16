# @waxlens/core

WACZ validation engine。machine-readable な JSON report を stdout に出力する。rule は WACZ spec と [wabac.js](https://github.com/webrecorder/wabac.js) replay engine の
実際の loader 挙動から導出されており、既知 producer に対するより厳しい check 用に producer 固有 profile も任意で選べる。

この engine の上で動く interactive な terminal UI が必要なら
[`@waxlens/tui`](https://github.com/uraitakahito/waxlens/tree/main/packages/tui)
を使う。

## CLI: `waxlens-validate`

```sh
# Local file
waxlens-validate <path>
# S3 (AWS credentials は default credential chain — env / shared config / IAM role)
waxlens-validate s3://<bucket>/<key>.wacz
# spec (default) | browserhive | lenient
waxlens-validate <source> --profile <name>
```

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
  parseS3Uri,
} from "@waxlens/core";

// Local file
const reader = await WaczReader.open("/path/to/file.wacz");
// または S3
// const reader = await WaczReader.openFromS3(parseS3Uri("s3://bucket/key.wacz"));
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

default export shape (`@waxlens/tui` が消費するもの一式) は
`src/public.ts` にある。

## License

[Unlicense](https://github.com/uraitakahito/waxlens/blob/main/LICENSE).
