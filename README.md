# waxlens

Monorepo for **waxlens** — a producer-agnostic validator for
[WACZ](https://specs.webrecorder.net/wacz/1.0.0/) archives. Rules are
derived from the WACZ spec and the
[wabac.js](https://github.com/webrecorder/wabac.js) replay engine's
actual loader behaviour, with optional producer-specific profiles
(`browserhive`, etc.) for stricter checks.

The project ships as two packages:

| Package                           | bin                | Purpose                                                                                                                                          |
| --------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@waxlens/core`](packages/core/) | `waxlens-validate` | Validation engine. Emits a machine-readable JSON report. CI and scripting target.                                                                |
| [`@waxlens/tui`](packages/tui/)   | `waxlens`          | Interactive terminal UI. Renders the report with expandable per-issue details on a TTY; auto-falls-back to plain text on pipes / non-TTY stdout. |

Spec / detail docs that apply to both packages:

- [`docs/rules.md`](docs/rules.md) — every rule with severity, profile
  matrix, and upstream-source references
- [`docs/json-schema.md`](docs/json-schema.md) — `WaxlensReport` (the
  `--json` output) wire format

## Development

This is an npm-workspaces monorepo. Most operations run from the root:

```sh
nvm use                 # Node 24.15.0, see .nvmrc
npm ci                  # installs all workspace deps + creates symlinks
npm run check           # npm audit + format:check + each workspace's check
npm run build           # builds both packages
```

Per-package commands work via `--workspace`:

```sh
npm run check -w @waxlens/core
npm run test:watch -w @waxlens/tui
```

Adding a new rule? See [`docs/rules.md` → "Adding a new rule"](docs/rules.md).

## License

[Unlicense](./LICENSE).
