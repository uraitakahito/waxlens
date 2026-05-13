# @waxlens/core

WACZ validation engine. Emits a machine-readable JSON report (default)
or a colour-aware plain-text summary. Rules are derived from the WACZ
spec and the [wabac.js](https://github.com/webrecorder/wabac.js)
replay engine's actual loader behaviour, with optional
producer-specific profiles for stricter checks against a known
producer.

For the interactive terminal UI on top of this engine, use
[`@waxlens/tui`](https://github.com/uraitakahito/waxlens/tree/main/packages/tui).

## CLI: `waxlens-validate`

```
waxlens-validate <file>                    validate the WACZ; emit JSON to stdout
waxlens-validate <file> --plain            emit a colour-aware human summary instead
waxlens-validate <file> --no-color         disable ANSI colour escapes in --plain
waxlens-validate <file> --profile <name>   spec (default) | browserhive | lenient
waxlens-validate --version
waxlens-validate --help
```

### Exit codes

| Code | Meaning                                          |
| ---- | ------------------------------------------------ |
| `0`  | validation passed — no `error`-severity issues   |
| `1`  | validation failed — one or more `error` issues   |
| `2`  | operational failure (cannot open the file, etc.) |

Warnings and info-level issues never flip the exit code on their own.

### Output schema

`--json` (the default) emits a `WaxlensReport`. Full schema in
[`docs/json-schema.md`](https://github.com/uraitakahito/waxlens/blob/main/docs/json-schema.md);
short example:

```json
{
  "waxlensVersion": "0.0.0",
  "profile": "spec",
  "file": "/tmp/good.wacz",
  "valid": true,
  "summary": { "passed": 12, "failed": 0, "warnings": 0, "info": 0, "durationMs": 12 },
  "issues": [],
  "stats": { "warcRecordCount": 1, "warcArchiveBytes": 246, "hosts": ["example.com"] }
}
```

### Profiles

| Profile       | Use when                                                        |
| ------------- | --------------------------------------------------------------- |
| `spec` (def)  | You want WACZ-spec + wabac.js compatibility. Most consumers.    |
| `browserhive` | Validating a BrowserHive capture; producer-strict checks.       |
| `lenient`     | Triaging legacy archives; only the hard "replay broken" errors. |

See
[`docs/rules.md`](https://github.com/uraitakahito/waxlens/blob/main/docs/rules.md)
for the per-rule profile severity matrix.

## Library usage

```ts
import { runValidation, WaczReader, M1_RULES } from "@waxlens/core";

const reader = await WaczReader.open("/path/to/file.wacz");
try {
  const result = await runValidation(reader, {
    file: "/path/to/file.wacz",
    waxlensVersion: "0.0.0",
    rules: M1_RULES,
    profile: "spec",
  });
  if (result.ok) console.log(JSON.stringify(result.value, null, 2));
} finally {
  await reader.close();
}
```

The default export shape (everything `@waxlens/tui` consumes) is in
`src/public.ts`.

## License

[Unlicense](https://github.com/uraitakahito/waxlens/blob/main/LICENSE).
