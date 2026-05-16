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
