# @waxlens/tui

WACZ validation 用の interactive な terminal UI。
[`@waxlens/core`](https://www.npmjs.com/package/@waxlens/core)
(validation engine) をラップして、その report を issue 単位の
expandable な詳細つきで interactive に表示する。stdout または stdin が
TTY でないときは plain-text view に自動 fallback する
(`waxlens foo.wacz | cat` や CI ログでも普通に動く)。

machine-readable な JSON 出力が欲しい場合は `@waxlens/core` の
`waxlens-validate` bin を直接使う。

## CLI: `waxlens`

```
waxlens <file>                    validate; TUI on a TTY, plain text on a pipe
waxlens <file> --no-color         disable ANSI colour escapes in plain output
waxlens <file> --no-tui           force plain output even on a TTY
waxlens <file> --profile <name>   spec (default) | browserhive | lenient
waxlens --version
waxlens --help
```

### キーバインド (TUI モード)

| キー        | 動作                              |
| ----------- | --------------------------------- |
| `↑` / `↓`   | issue 間でカーソル移動            |
| `enter`     | expanded な詳細パネルをトグル     |
| `q` / `Esc` | 終了                              |

expanded な詳細は payload の形に応じて自動整形される: hash mismatch
は `expected` / `actual` の diff、CDXJ↔WARC 系 issue は問題の offset の
実際の WARC record header、payload-digest mismatch は payload 先頭
256 bytes の hex dump。それ以外は JSON-pretty ブロックに fallback する
ので、JSON 出力が持っている情報を human view が失うことは無い。

### Exit codes

`@waxlens/core` と同じ:

| Code | 意味                                                |
| ---- | --------------------------------------------------- |
| `0`  | validation 成功                                     |
| `1`  | validation 失敗 (`error` issue 1 件以上)            |
| `2`  | operational な失敗 (ファイルが開けないなど)         |

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

## License

[Unlicense](https://github.com/uraitakahito/waxlens/blob/main/LICENSE).
