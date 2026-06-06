# @waxlens/tui

WACZ validation 用の interactive な terminal UI。

machine-readable な JSON 出力が欲しい場合は `@waxlens/core` の
`waxlens-validate` bin を直接使う。

## CLI: `waxlens`

```sh
waxlens --help
# spec (default) | browserhive | lenient
waxlens <file> --profile <name>
```

### Exit codes

`@waxlens/core` と同じ:

| Code | 意味                                        |
| ---- | ------------------------------------------- |
| `0`  | validation 成功                             |
| `1`  | validation 失敗 (`error` issue 1 件以上)    |
| `2`  | operational な失敗 (ファイルが開けないなど) |

## 実際の WACZ で試す

Webrecorder が
[`webrecorder/example-webarchive`](https://github.com/webrecorder/example-webarchive)
に小さい example archive を公開していて、これを直接検証できる:

```sh
mkdir -p /tmp/waxlens-demo
curl -sL \
  https://raw.githubusercontent.com/webrecorder/example-webarchive/main/items/wikipedia/archive.wacz \
  -o /tmp/waxlens-demo/wikipedia.wacz

waxlens /tmp/waxlens-demo/wikipedia.wacz
```

デフォルトの `--profile spec` では exit 0 になり、Webrecorder 流の
gzip 済み CDXJ に対する informational な warning が 1 件出る — `.idx`
がペアになっているので archive は wabac.js でロード可能。同じコマンドを
`--profile browserhive` で動かすと exit 1 になる。これは BrowserHive の
plain な `.cdxj` 慣習を強制する profile のため。

その他様々なパターンのwaczファイルは[waxlens-corpus](https://github.com/uraitakahito/waxlens-corpus)で確認できます。

## License

[Unlicense](https://github.com/uraitakahito/waxlens/blob/main/LICENSE).
