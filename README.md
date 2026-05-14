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

package ごとのコマンドは `--filter` (略記: `-F`) 経由:

```sh
pnpm --filter @waxlens/core check
pnpm --filter @waxlens/tui test:watch
```

### `waxlens-validate` / `waxlens` を system-wide で呼ぶ

publish 前の workspace package を任意のディレクトリから bin 名で
叩きたいときは `pnpm link --global` を使う:

```sh
pnpm build                                        # dist/ を最新に
pnpm --filter @waxlens/core link --global         # waxlens-validate
pnpm --filter @waxlens/tui link --global          # waxlens
```

これで `waxlens-validate file.wacz` / `waxlens file.wacz` がどこから
でも叩ける。元に戻すときは `pnpm uninstall --global @waxlens/core
@waxlens/tui`。

(publish 後にエンドユーザが入れる方法は `pnpm add -g @waxlens/core`
あるいは `pnpm add -g @waxlens/tui`。)

### 新しい rule を追加する

[`docs/rules.md` → "新しい rule を追加する"](docs/rules.md) を参照。

## License

[Unlicense](./LICENSE).
