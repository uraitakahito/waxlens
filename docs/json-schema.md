# `--json` output schema

The schema is pinned for the `0.x` line — a future `1.0.0` release may
break it, but only with a migration note in the GitHub Release body
for that tag. Anything you script against the fields below should keep
working across patch and minor releases until then.

Renderers consume the same `Report` object that the engine produces;
`--json` is a stringification of it, not a separate "machine view". So
if a field is documented here, the TUI uses it too — and vice versa.

## Top level: `WaxlensReport`

```ts
interface WaxlensReport {
  /** Producer version, mirroring `package.json#version`. */
  waxlensVersion: string;
  /** The path the operator gave to the CLI (verbatim — not resolved). */
  file: string;
  /** Convenience field, equivalent to `summary.failed === 0`. */
  valid: boolean;
  summary: ReportSummary;
  /** Per-rule issues in registration order (see docs/rules.md). */
  issues: Issue[];
  /** Best-effort archive metadata. Absent if the WARC could not be read at all. */
  stats?: ReportStats;
}
```

## `ReportSummary`

```ts
interface ReportSummary {
  /** Rules that produced no error-severity issue. */
  passed: number;
  /** Error-severity issue count (NOT rule count). Drives exit code 1. */
  failed: number;
  /** Warning-severity issue count. Never affects exit code. */
  warnings: number;
  /** Info-severity issue count. Never affects exit code. */
  info: number;
  /** Wall-clock time the engine spent running the rule set. */
  durationMs: number;
}
```

Note: `summary.passed + failingRules = totalRules`. Counting "passed"
by rule (rather than by issue) lets a rule that produces several
warnings still count as having passed (it didn't fail), which matches
the headline operators expect.

## `Issue`

```ts
type Severity = "error" | "warning" | "info";

interface Issue {
  /** Stable `<area>/<short-name>` identifier — see docs/rules.md. */
  rule: string;
  severity: Severity;
  /** One-line human summary. Not localised; not reformatted across versions. */
  message: string;
  location?: IssueLocation;
  /**
   * Structured payload the TUI may render in a specialised view (see below).
   * Always JSON-serialisable. Shape is rule-specific; consumers should
   * narrow by `rule` before deep-reading.
   */
  details?: unknown;
}

interface IssueLocation {
  /** zip entry name where the problem was found, when applicable. */
  entry?: string;
  /** 1-based line number inside a text entry (CDXJ, pages.jsonl). */
  line?: number;
  /** Byte offset inside a binary entry (WARC). */
  offset?: number;
}
```

### Recognised `details` shapes

Today's renderers (TUI especially) look for the following keys and
render them in dedicated views. Other keys fall through to a
JSON-pretty block, so adding fields never silently drops information.

| Key                     | Type        | Used by                            | Rendered as                 |
| ----------------------- | ----------- | ---------------------------------- | --------------------------- |
| `expected` AND `actual` | any         | hash / digest / wacz_version rules | green/red side-by-side diff |
| `warcHeader`            | `string[]`  | `cdxj/warc-offsets`                | WARC header line list       |
| `hexPreview`            | `string[]`  | `warc/payload-digest`              | xxd-style hex dump          |
| `candidates`            | `unknown[]` | `cdxj/warc-offsets`                | nearby-members one-per-line |

`expected` without `actual` (or vice versa) falls through to JSON
pretty — the diff view requires both. This is intentional: we don't
synthesise either side, so the human and machine views stay
trustworthy.

## `ReportStats`

```ts
interface ReportStats {
  /** Number of independent gzip members the WARC iterator yielded. */
  warcRecordCount: number;
  /** Byte length of `archive/data.warc.gz` (zip-uncompressed). */
  warcArchiveBytes: number;
  /** Distinct hosts mentioned in CDXJ entries' `url` field (sorted). */
  hosts: string[];
}
```

Stats are computed best-effort alongside validation. A malformed WARC
omits the field rather than failing the report. Renderers display it
below the summary as
`<recordCount> records · <archiveBytes> · <hostCount> hosts`.

## Stability promise

Within the `0.x` line:

- **Added fields are non-breaking.** Consumers must tolerate fields
  they don't recognise.
- **Removed or renamed fields are breaking** and ride a minor bump
  (0.x → 0.(x+1)).
- **`rule` identifiers never change** for a given check; a renamed
  rule is a new rule (the old one is removed, with the rename noted
  in the GitHub Release body for the cutting tag).
- **Severity downgrades** (error → warning) ride a minor bump;
  upgrades (warning → error) ride a major.
- **`summary.passed` semantics** (per-rule count) are fixed.

## Example: valid WACZ

```json
{
  "waxlensVersion": "0.0.0",
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

## Example: failure with diff

```json
{
  "waxlensVersion": "0.0.0",
  "file": "/tmp/bad-hash.wacz",
  "valid": false,
  "summary": { "passed": 10, "failed": 1, "warnings": 0, "info": 0, "durationMs": 14 },
  "issues": [
    {
      "rule": "datapackage/resource-hashes",
      "severity": "error",
      "message": "Resource \"archive/data.warc.gz\" hash mismatch",
      "location": { "entry": "archive/data.warc.gz" },
      "details": {
        "expected": "sha256:dead0000…00ff",
        "actual": "sha256:9a8b…c2e1"
      }
    }
  ],
  "stats": { "warcRecordCount": 1, "warcArchiveBytes": 246, "hosts": ["example.com"] }
}
```
