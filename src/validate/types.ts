/**
 * Validation domain types.
 *
 * Every rule produces an `Issue[]`. The engine merges per-rule outputs into
 * a `Report`. The HTTP / CLI / TUI rendering layers consume only `Report`,
 * so a new rule plugs in by exporting a `ValidationRule` and adding it to
 * the registry — no other layer needs to change.
 *
 * The wire format (`Report`) is what `--json` emits and what `tasks/todo.md`
 * pins as the M1-stable schema. Future-proofing notes:
 *   - `waxlensVersion` lets a downstream consumer detect schema drift.
 *   - `summary.durationMs` is included from the start so CI dashboards can
 *     trend regression in cost.
 *   - `Issue.details` is `unknown` on purpose — rules attach hash diffs,
 *     hex dumps, etc. The renderer formats per-rule; the JSON schema is
 *     "anything serialisable".
 */
import type { Result } from "../result.js";
import type { WaczReader } from "../wacz/reader.js";

export type Severity = "error" | "warning" | "info";

export interface IssueLocation {
  /** zip entry name where the problem was found, when applicable. */
  entry?: string;
  /** 1-based line number inside a text entry (CDXJ, pages.jsonl). */
  line?: number;
  /** Byte offset inside a binary entry (WARC). */
  offset?: number;
}

export interface Issue {
  /**
   * Stable rule identifier in `<area>/<short-name>` form. Used by the
   * future `--rule` filter (M3) and by humans grepping logs. Never
   * localised; never reformatted across versions.
   */
  rule: string;
  severity: Severity;
  /** One-line human summary. The renderer may colour by severity. */
  message: string;
  location?: IssueLocation;
  /**
   * Structured payload the renderer can expand on demand. Keep
   * JSON-serialisable (numbers, strings, plain objects, arrays). The TUI
   * (M2+) renders this for the "expand" key; the JSON renderer round-trips.
   */
  details?: unknown;
}

export interface ValidationRule {
  /** Same value that ends up in `Issue.rule`. */
  name: string;
  /** One-sentence rationale. Surfaced by `--help` and docs/rules.md. */
  description: string;
  severity: Severity;
  run: (wacz: WaczReader) => Promise<Result<Issue[], never>>;
}

export interface ReportSummary {
  passed: number;
  failed: number;
  warnings: number;
  info: number;
  durationMs: number;
}

export interface Report {
  waxlensVersion: string;
  file: string;
  /** `true` iff `summary.failed === 0`. Cached so the JSON consumer doesn't recompute. */
  valid: boolean;
  summary: ReportSummary;
  issues: Issue[];
}
