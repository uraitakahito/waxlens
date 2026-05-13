# waxlens

TUI validator for [WACZ](https://specs.webrecorder.net/wacz/1.0.0/) archives —
one-shot validation with expandable details on failures. Rules are derived
from the WACZ spec plus the [wabac.js](https://github.com/webrecorder/wabac.js)
replay engine's actual loader behaviour, with optional producer-specific
profiles (`browserhive`, etc.) for stricter checks against a known producer.

## Quickstart

```sh
npm ci && npm run build
node dist/cli.js path/to/captured.wacz
```

## Trying it with a real WACZ

Webrecorder publishes a small example archive in
[`webrecorder/example-webarchive`](https://github.com/webrecorder/example-webarchive)
that you can validate directly:

```sh
mkdir -p samples
curl -sL \
  https://raw.githubusercontent.com/webrecorder/example-webarchive/main/items/wikipedia/archive.wacz \
  -o samples/wikipedia.wacz

node dist/cli.js samples/wikipedia.wacz --no-tui
```

Under the default `--profile spec` this exits 0 with a single
informational `warning` about the Webrecorder-style gzipped CDXJ —
the archive itself is wabac.js-loadable because the paired `.idx` is
present. The same command with `--profile browserhive` exits 1
because that profile enforces BrowserHive's plain-`.cdxj` convention.

The `samples/` directory is in `.gitignore` so the downloaded blobs
never land in commits. The repo also ships two more sample archives
at `items/birth-web/archive.wacz` and `items/www-talk/archive.wacz`
if Wikipedia isn't enough.

## CLI

```
waxlens <file>                    validate the WACZ; TUI on a TTY, plain text on a pipe
waxlens <file> --json             emit a machine-readable JSON report
waxlens <file> --no-color         disable ANSI escapes in the plain output
waxlens <file> --no-tui           force plain output even on a TTY
waxlens <file> --profile <name>   spec (default) | browserhive | lenient
waxlens --version
waxlens --help
```

### Profiles

A profile reshapes the severity of producer-specific or stylistic
rules; it never silences a spec-mandated check.

| Profile       | Use when                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| `spec` (def)  | You want WACZ-spec + wabac.js compatibility. Most consumers.             |
| `browserhive` | You're validating a BrowserHive capture and want producer-strict checks. |
| `lenient`     | Triaging legacy archives; you only want hard "replay broken" errors.     |

See [`docs/rules.md`](docs/rules.md) for the per-rule profile severity
matrix.

### Exit codes

| Code | Meaning                                          |
| ---- | ------------------------------------------------ |
| `0`  | validation passed — no `error`-severity issues   |
| `1`  | validation failed — one or more `error` issues   |
| `2`  | operational failure (cannot open the file, etc.) |

Warnings and info-level issues never flip the exit code on their own.

### `--json` output

The JSON shape is documented in [`docs/json-schema.md`](docs/json-schema.md).
A minimal example for a valid WACZ:

```json
{
  "waxlensVersion": "0.0.0",
  "profile": "spec",
  "file": "/tmp/good.wacz",
  "valid": true,
  "summary": {
    "passed": 11,
    "failed": 0,
    "warnings": 0,
    "info": 0,
    "durationMs": 12
  },
  "issues": [],
  "stats": {
    "warcRecordCount": 1,
    "warcArchiveBytes": 246,
    "hosts": ["example.com"]
  }
}
```

For a failure (missing `profile` in `datapackage.json`):

```json
{
  "valid": false,
  "summary": { "passed": 10, "failed": 1, "warnings": 0, "info": 0, "durationMs": 9 },
  "issues": [
    {
      "rule": "datapackage/profile-required",
      "severity": "error",
      "message": "datapackage.json is missing the \"profile\" field",
      "location": { "entry": "datapackage.json" },
      "details": { "expected": "data-package" }
    }
  ]
}
```

## Rules

12 rules are wired in, grouped by area. Full reference with rationale,
upstream-spec links, and the per-profile severity matrix lives in
[`docs/rules.md`](docs/rules.md). Severities below are the default
(`--profile spec`).

| Rule                                | Severity | Catches                                                                        |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `datapackage/profile-required`      | error    | missing/wrong `profile: "data-package"`                                        |
| `datapackage/wacz-version-required` | error    | missing `wacz_version` (warns on unknown)                                      |
| `datapackage/resource-hashes`       | error    | sha256 / byte-length mismatch                                                  |
| `cdxj/index-recognised-by-wabac`    | error    | no `.cdx` / `.cdxj` / `.idx` in `indexes/` (wabac.js can't load anything)      |
| `cdxj/index-not-gzipped`            | warning  | `index.cdxj.gz` without paired `.idx` (browserhive profile escalates to error) |
| `cdxj/filename-archive-relative`    | error    | `filename: "archive/..."` double-prefix bug                                    |
| `warc/storage-store`                | warning  | WARC zip-stored as DEFLATE instead of STORE                                    |
| `warc/members-independent`          | error    | broken concatenated gzip-member layout                                         |
| `cdxj/warc-offsets`                 | error    | offset/length doesn't land on a member                                         |
| `cdxj/pages-mainpage`               | warning  | `mainPageURL` not covered by pages.jsonl/CDXJ                                  |
| `warc/payload-digest`               | warning  | `WARC-Payload-Digest` sha256 mismatch                                          |
| `fuzzy/valid-json`                  | info     | malformed `fuzzy.json`                                                         |

## TUI key bindings

| Key         | Action                            |
| ----------- | --------------------------------- |
| `↑` / `↓`   | move the cursor between issues    |
| `enter`     | toggle the expanded details panel |
| `q` / `Esc` | exit                              |

Expanded details auto-format by payload shape: hash mismatches show an
`expected`/`actual` diff, CDXJ↔WARC issues show the actual WARC record
header at the contested offset, payload-digest mismatches show a hex dump
of the first 256 bytes of the payload. Anything else falls back to a
JSON-pretty block so the human view never loses information the
`--json` output would carry.

## Development

```sh
nvm use                          # Node 24.14.1, see .nvmrc
npm ci
npm run check                    # typecheck + lint + format:check + vitest
npm run build                    # emit dist/
node dist/cli.js path/to.wacz    # local run
```

Tests are in `test/`; the WACZ fixture generator (`test/fixtures/generator.ts`)
builds spec-conformant archives in memory with `archiver`. Adding a new rule
is a one-file change in `src/validate/rules/` plus a registry entry in
`src/validate/rules/index.ts` — every other layer (engine, renderers, CLI)
reads `ValidationRule.name` only.

## License

[Unlicense](./LICENSE).
