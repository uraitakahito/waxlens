# waxlens

[WACZ](https://specs.webrecorder.net/wacz/1.0.0/) archive 用のproducer 非依存な validator。

このプロジェクトは 2 つの package として提供される:

| Package                           | bin                | 目的                                                                                                                                                 |
| --------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@waxlens/core`](packages/core/) | `waxlens-validate` | Validation engine。machine-readable な JSON report を出力する。CI / スクリプト用途。                                                                 |
| [`@waxlens/tui`](packages/tui/)   | `waxlens`          | Interactive な terminal UI。TTY 上では report を issue 単位の expandable な詳細つきで表示。pipe / 非 TTY な stdout では plain text に自動 fallback。 |

両 package に共通する spec / 詳細 docs:

- [`docs/rules.md`](docs/rules.md) — 各 rule の severity、profile
  matrix、upstream 参照
- [`docs/json-schema.md`](docs/json-schema.md) — `WaxlensReport`
  (`--json` 出力) の wire format

## 開発

```sh
# installs all workspace deps + creates symlinks
pnpm install --frozen-lockfile
# pnpm audit + each workspace's check
pnpm check
# builds both packages
pnpm build
```

### Docker Compose stack (bundled SeaweedFS)

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

### 新しい rule を追加する

[`docs/rules.md` → "新しい rule を追加する"](docs/rules.md) を参照。

## License

[Unlicense](./LICENSE).
