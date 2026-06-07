# waxlens

[WACZ](https://specs.webrecorder.net/wacz/1.0.0/) archive 用のproducer 非依存な validator。

検証ロジックと表示を Language Server のように分離している。**daemon** が
`@waxlens/core` を所有して検証を行い、**tui** は薄いクライアントとして daemon に
WebSocket で問い合わせて結果を描画する。daemon は **stateless**(各リクエストが
source URI を運び `open → validate → close` するだけで状態を持たない)で、将来
browser など別フロントエンドも同じ protocol で繋げる。

```
tui (client) ──WS/JSON-RPC──▶ daemon ──uses──▶ core
browser (将来) ─────────────▶ daemon
```

このプロジェクトは 4 つの package として提供される:

| Package                                     | bin                | 目的                                                                                                                                 |
| ------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`@waxlens/core`](packages/core/)           | `waxlens-validate` | Validation engine。machine-readable な JSON report を出力する。daemon が所有するが、CI / スクリプト用途では直接も使える。            |
| [`@waxlens/daemon`](packages/daemon/)       | `waxlens-daemon`   | stateless な HTTP/WS daemon。core を所有し、tui / 将来の browser に解決済み(message/specUrl/conformance inline)の Report を WS で返す。 |
| [`@waxlens/tui`](packages/tui/)             | `waxlens`          | Interactive な terminal UI(daemon クライアント)。TTY 上では issue を expandable に表示し、Layout で `enter` → ファイル内容を表示。非 TTY では plain text。 |
| [`@waxlens/protocol`](packages/protocol/)   | —                  | tui / daemon / browser が共有する wire 型と CLI 契約(型 + 軽量定数 / `exitCodeFor`。runtime に core 非依存で browser-safe)。 |

`waxlens` は既定で `waxlens-daemon` を子プロセスとして起動して接続する。常駐 daemon に
繋ぐ場合は `waxlens --server ws://127.0.0.1:PORT <file>`(browser から繋ぐ前提の起動も
`waxlens-daemon` 単体で可)。

両 package に共通する spec / 詳細 docs:

- [`docs/rules.md`](docs/rules.md) — 各 rule の severity、profile
  matrix、upstream 参照
- [`docs/json-schema.md`](docs/json-schema.md) — `WaxlensReport`
  (`--json` 出力) の wire format
- [`docs/examples.md`](docs/examples.md) — [waxlens-corpus](https://github.com/uraitakahito/waxlens-corpus)
  を使った rule 別の事例カタログ (失敗例・profile 差)。`manifest.json` から自動生成

package 個別の詳細:

- [`packages/core/README.md`](packages/core/README.md) —
  `waxlens-validate` CLI の使い方 (local / `s3://`)、exit code、
  profile (`spec` / `browserhive` / `lenient`)、環境変数、
  library としての import 例
- [`packages/tui/README.md`](packages/tui/README.md) —
  `waxlens` CLI のフラグ、TUI モードのキーバインド、
  plain-text fallback の挙動、Webrecorder 公開 example archive での
  動作確認手順

## 開発

```sh
# installs all workspace deps + creates symlinks
pnpm install --frozen-lockfile
# pnpm audit + each workspace's check
pnpm check
# builds both packages
pnpm build
```

### `waxlens-validate` / `waxlens` を system-wide で呼ぶ

```sh
# dist/ を最新に
pnpm build
# waxlens-validate
pnpm --dir packages/core add -g .
# waxlens
pnpm --dir packages/tui add -g .
```

登録後は monorepo の外でも waxlens 直下でも、bin 名だけで呼べる:

```sh
# Local file
waxlens-validate samples/wikipedia.wacz
waxlens samples/wikipedia.wacz

# S3 (AWS credential chain で解決)
waxlens-validate s3://my-bucket/captures/abc.wacz
waxlens s3://my-bucket/captures/abc.wacz
```

元に戻すときは `pnpm remove -g @waxlens/core @waxlens/tui`。

## Docker Compose stack (bundled SeaweedFS)

`waxlens-validate s3://...` を試したい場合は、bundled SeaweedFS を含む
compose stack を使う。**chromium-server や BrowserHive は含まない** ので、
waxlens 単体で完結する (loose coupling)。

```sh
./setup.sh
docker compose -f compose.dev.yaml up -d --build
docker compose -f compose.dev.yaml exec waxlens bash
# 以下 container 内で:
pnpm install && pnpm --filter @waxlens/core build
aws --endpoint-url http://seaweedfs:8333 s3 cp samples/wikipedia.wacz s3://waxlens/wikipedia.wacz
./packages/core/dist/cli.js s3://waxlens/wikipedia.wacz
```

Prod stack は one-shot validation 用 (waxlens 自身は `--profile run` で
明示的に走らせる):

```sh
docker compose -f compose.prod.yaml up -d
# host から sidecar AWS CLI で WACZ を upload:
docker run --rm --network waxlens-network \
  -v $(pwd)/samples:/samples:ro \
  -e AWS_ACCESS_KEY_ID=waxlens -e AWS_SECRET_ACCESS_KEY=waxlens \
  -e AWS_REGION=us-east-1 -e AWS_ENDPOINT_URL_S3=http://seaweedfs:8333 \
  amazon/aws-cli s3 cp /samples/wikipedia.wacz s3://waxlens/wikipedia.wacz
# 1 回 validate:
docker compose -f compose.prod.yaml --profile run run --rm waxlens s3://waxlens/wikipedia.wacz
docker compose -f compose.prod.yaml down
```

bundled SeaweedFS 専用の構成で、AWS / R2 / 他の S3 互換 service への
切り替えは現状想定していない。


## License

[Unlicense](./LICENSE).
