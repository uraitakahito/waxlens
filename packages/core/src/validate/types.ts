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

/**
 * Rule-set selectors. Picking a profile reshapes the severity of
 * producer-specific rules (e.g. `cdxj/index-not-gzipped`) but never
 * silences a spec-mandated check. Default is `spec`.
 *
 * - `spec` — WACZ spec + wabac.js loader compatibility. The
 *   default; what most consumers want.
 * - `browserhive` — Add BrowserHive's producer conventions on top
 *   of `spec` (e.g. plain `indexes/index.cdxj` required, no
 *   `index.cdxj.gz` even when paired with `.idx`).
 * - `lenient` — Demote all producer-specific or stylistic
 *   findings to `info`. Useful when triaging legacy archives
 *   where you only want the hard "replay broken" errors.
 */
export type RuleProfile = "spec" | "browserhive" | "lenient";

export const ALL_PROFILES: readonly RuleProfile[] = ["spec", "browserhive", "lenient"];

/**
 * How a rule reacts to each profile. `severityByProfile` lets a rule
 * sit in the registry once and tune its severity; `excludeProfiles`
 * silences it entirely for a profile (rare — used when a check is
 * meaningless outside one producer's conventions).
 */
export interface RuleApplicability {
  /** Per-profile severity override. Omitted profile falls back to `ValidationRule.severity`. */
  severityByProfile?: Partial<Record<RuleProfile, Severity>>;
  /** Profiles where the rule is skipped entirely (no issues emitted). */
  excludeProfiles?: readonly RuleProfile[];
}

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
  /**
   * Baseline severity, used when no profile-specific override applies.
   * The engine still routes this through profile logic: a rule with
   * baseline `error` can be demoted to `warning` under the `lenient`
   * profile via `applicability.severityByProfile`.
   */
  severity: Severity;
  /**
   * Per-profile overrides. Omitted = the rule applies in every profile
   * at its baseline severity.
   */
  applicability?: RuleApplicability;
  run: (wacz: WaczReader) => Promise<Result<Issue[], never>>;
}

export interface ReportSummary {
  passed: number;
  failed: number;
  warnings: number;
  info: number;
  durationMs: number;
}

/**
 * Informational metadata about the WACZ that's useful to humans but
 * doesn't fit the issue model — record count, distinct host count, etc.
 * Renderers display this below the summary line. Optional because the
 * engine computes it best-effort: a malformed WARC won't block the
 * report just to extract stats.
 */
export interface ReportStats {
  /** Number of independent gzip members the WARC iterator yielded. */
  warcRecordCount: number;
  /** Byte length of `archive/data.warc.gz` (zip-uncompressed). */
  warcArchiveBytes: number;
  /** Distinct hosts mentioned in CDXJ entries' `url` field. */
  hosts: string[];
}

export interface Report {
  waxlensVersion: string;
  /** Rule profile used to evaluate the report. See {@link RuleProfile}. */
  profile: RuleProfile;
  file: string;
  /** `true` iff `summary.failed === 0`. Cached so the JSON consumer doesn't recompute. */
  valid: boolean;
  summary: ReportSummary;
  issues: Issue[];
  /** Best-effort metadata — see {@link ReportStats}. */
  stats?: ReportStats;
}
