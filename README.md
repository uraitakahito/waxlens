# waxlens

**waxlens** の monorepo —
[WACZ](https://specs.webrecorder.net/wacz/1.0.0/) archive 用の
producer 非依存な validator。rule は WACZ spec と
[wabac.js](https://github.com/webrecorder/wabac.js) replay engine の
実際の loader 挙動から導出されており、producer 固有のより厳しい
check 用 profile (`browserhive` など) も任意で選べる。

このプロジェクトは 2 つの package として提供される:

| Package                           | bin                | 目的                                                                                                                                            |
| --------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@waxlens/core`](packages/core/) | `waxlens-validate` | Validation engine。machine-readable な JSON report を出力する。CI / スクリプト用途。                                                            |
| [`@waxlens/tui`](packages/tui/)   | `waxlens`          | Interactive な terminal UI。TTY 上では report を issue 単位の expandable な詳細つきで表示。pipe / 非 TTY な stdout では plain text に自動 fallback。 |

両 package に共通する spec / 詳細 docs:

- [`docs/rules.md`](docs/rules.md) — 各 rule の severity、profile
  matrix、upstream 参照
- [`docs/json-schema.md`](docs/json-schema.md) — `WaxlensReport`
  (`--json` 出力) の wire format

## 開発

npm-workspaces monorepo。ほとんどの操作は root から走らせる:

```sh
nvm use                 # Node 24.15.0, see .nvmrc
npm ci                  # installs all workspace deps + creates symlinks
npm run check           # npm audit + format:check + each workspace's check
npm run build           # builds both packages
```

package ごとのコマンドは `--workspace` 経由:

```sh
npm run check -w @waxlens/core
npm run test:watch -w @waxlens/tui
```

新しい rule を追加したい場合は
[`docs/rules.md` → "新しい rule を追加する"](docs/rules.md) を参照。

## License

[Unlicense](./LICENSE).
