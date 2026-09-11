# @wacz-validator/tui

WACZ validation 用の interactive な terminal UI。

## CLI: `wacz-validator`

```sh
wacz-validator --help
# spec (default) | browserhive | lenient
wacz-validator FILE --profile PROFILE
# version + 短い git SHA(古いプロセスの取り違え防止)
wacz-validator --version   # 例: 0.0.0 (9f3c2a1)
```

## ヘッダのバージョン表示と SHA 不一致の警告

ヘッダ行には TUI 自身のビルドの短い git SHA を出す(未コミット変更があれば
`-dirty`)。起動時に `wacz-validator/ping` で daemon の SHA も取得し、両者が食い違う —
つまり**描画(TUI)か検証(daemon)のどちらかが古いプロセス**のときは
`⚠ daemon ·<sha>` を警告色で添える。

```
wacz-validator 0.0.0 ·9f3c2a1                       … 一致(正常)
wacz-validator 0.0.0 ·9f3c2a1 ⚠ daemon ·1b8e4d0     … 不一致(どちらか古い → 再起動)
```

ビルドしてもプロセスを起動し直すまで古いコードがメモリに残る件は
[`build → quit → relaunch`](https://github.com/uraitakahito/wacz-validator) の運用で回避する。

## 実際の WACZ で試す

Webrecorder が
[`webrecorder/example-webarchive`](https://github.com/webrecorder/example-webarchive)
に小さい example archive を公開していて、これを直接検証できる:

```sh
mkdir -p /tmp/wacz-validator-demo
curl -sL \
  https://raw.githubusercontent.com/webrecorder/example-webarchive/main/items/wikipedia/archive.wacz \
  -o /tmp/wacz-validator-demo/wikipedia.wacz

wacz-validator /tmp/wacz-validator-demo/wikipedia.wacz
```

rule ごとの失敗例や profile 差を試せる WACZ 標本(20 本)は
[wacz-validator-corpus](https://github.com/uraitakahito/wacz-validator-corpus) にある。入手方法と
全標本のカタログは
[事例カタログ](https://uraitakahito.github.io/wacz-validator/ja/corpus/)
を参照。

## License

[Unlicense](https://github.com/uraitakahito/wacz-validator/blob/main/LICENSE).
