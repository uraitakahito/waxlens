# @waxlens/tui

WACZ validation 用の interactive な terminal UI。

## CLI: `waxlens`

```sh
waxlens --help
# spec (default) | browserhive | lenient
waxlens FILE --profile PROFILE
```

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

rule ごとの失敗例や profile 差を試せる WACZ 標本(20 本)は
[waxlens-corpus](https://github.com/uraitakahito/waxlens-corpus) にある。入手方法と
全標本のカタログは
[`docs/examples.md`](https://github.com/uraitakahito/waxlens/blob/main/docs/examples.md)
を参照。

## License

[Unlicense](https://github.com/uraitakahito/waxlens/blob/main/LICENSE).
