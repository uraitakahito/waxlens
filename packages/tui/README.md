# @waxlens/tui

Interactive terminal UI for WACZ validation. Wraps
[`@waxlens/core`](https://www.npmjs.com/package/@waxlens/core) (the
validation engine) and renders its report interactively, with
expandable per-issue details. Auto-falls-back to a plain-text view
when stdout or stdin isn't a TTY (so `waxlens foo.wacz | cat` and CI
logs Just Work).

For machine-readable JSON output, use `@waxlens/core`'s
`waxlens-validate` bin directly.

## CLI: `waxlens`

```
waxlens <file>                    validate; TUI on a TTY, plain text on a pipe
waxlens <file> --no-color         disable ANSI colour escapes in plain output
waxlens <file> --no-tui           force plain output even on a TTY
waxlens <file> --profile <name>   spec (default) | browserhive | lenient
waxlens --version
waxlens --help
```

### Key bindings (TUI mode)

| Key         | Action                            |
| ----------- | --------------------------------- |
| `↑` / `↓`   | move the cursor between issues    |
| `enter`     | toggle the expanded details panel |
| `q` / `Esc` | exit                              |

Expanded details auto-format by payload shape: hash mismatches show
an `expected`/`actual` diff, CDXJ↔WARC issues show the actual WARC
record header at the contested offset, payload-digest mismatches
show a hex dump of the first 256 bytes of the payload. Anything else
falls back to a JSON-pretty block so the human view never loses
information the JSON output would carry.

### Exit codes

Same as `@waxlens/core`:

| Code | Meaning                                          |
| ---- | ------------------------------------------------ |
| `0`  | validation passed                                |
| `1`  | validation failed (one or more `error` issues)   |
| `2`  | operational failure (cannot open the file, etc.) |

## Trying it with a real WACZ

Webrecorder publishes a small example archive in
[`webrecorder/example-webarchive`](https://github.com/webrecorder/example-webarchive)
that you can validate directly:

```sh
mkdir -p /tmp/waxlens-demo
curl -sL \
  https://raw.githubusercontent.com/webrecorder/example-webarchive/main/items/wikipedia/archive.wacz \
  -o /tmp/waxlens-demo/wikipedia.wacz

waxlens /tmp/waxlens-demo/wikipedia.wacz
```

Under the default `--profile spec` this exits 0 with a single
informational warning about the Webrecorder-style gzipped CDXJ — the
archive is wabac.js-loadable because the paired `.idx` is present.
The same command with `--profile browserhive` exits 1 because that
profile enforces BrowserHive's plain-`.cdxj` convention.

## License

[Unlicense](https://github.com/uraitakahito/waxlens/blob/main/LICENSE).
