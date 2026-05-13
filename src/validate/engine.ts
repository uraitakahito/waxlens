/**
 * Validation engine.
 *
 * Runs every registered rule against the supplied WACZ in parallel,
 * applies the active profile's severity overrides, and folds the
 * results into a single `Report`. The engine itself never throws —
 * rule failures are returned as `Result<Issue[], never>`.
 *
 * Parallelism: the rules each read 1–2 zip entries. yauzl-promise can
 * service concurrent read streams from a single ZipFile handle, so
 * running rules in parallel is safe and cuts wall-clock for small WACZ
 * files. A future profiler-driven change might serialise rules that
 * dominate the budget — for now, the simple form is correct and fast.
 *
 * Profile dispatch:
 *   1. `excludeProfiles` filters the rule out entirely (no issues).
 *   2. `severityByProfile[profile]` overrides every issue's severity.
 *   3. Otherwise the rule's baseline `severity` field stands.
 *
 * Steps 2/3 are applied per-issue rather than per-rule because an
 * individual issue may already carry a "weaker" severity than the
 * rule's baseline (e.g. `warc/payload-digest` emits some `info`
 * issues for non-sha256 algorithms even when the rule's baseline is
 * `warning`). We treat the per-issue severity as the floor — the
 * profile override only fires when the issue itself matches the
 * rule's baseline. This keeps mixed-severity rules well-behaved.
 */
import type { Result } from "../result.js";
import { ok } from "../result.js";
import type { WaczReader } from "../wacz/reader.js";
import { computeStats } from "./stats.js";
import type {
  Issue,
  Report,
  ReportSummary,
  RuleProfile,
  Severity,
  ValidationRule,
} from "./types.js";

export interface RunOptions {
  file: string;
  waxlensVersion: string;
  rules: readonly ValidationRule[];
  /** Profile selector. Defaults to `"spec"`. */
  profile?: RuleProfile;
}

export const DEFAULT_PROFILE: RuleProfile = "spec";

export const runValidation = async (
  wacz: WaczReader,
  opts: RunOptions,
): Promise<Result<Report, never>> => {
  const startedAt = Date.now();
  const profile: RuleProfile = opts.profile ?? DEFAULT_PROFILE;

  // Filter rules by `excludeProfiles` before running, so a skipped rule
  // doesn't even read its zip entries.
  const activeRules = opts.rules.filter(
    (rule) => !rule.applicability?.excludeProfiles?.includes(profile),
  );

  // Run validation rules and stats extraction in parallel — stats is
  // best-effort (returns undefined on internal failure) and the rules
  // are independent of it, so there's no ordering hazard.
  const [perRule, stats] = await Promise.all([
    Promise.all(
      activeRules.map(async (rule) => {
        const result = await rule.run(wacz);
        // `Result<Issue[], never>` can only be the ok branch — narrowing
        // check is still needed under strict mode. The default is
        // unreachable.
        if (!result.ok) return [];
        return applyProfile(result.value, rule, profile);
      }),
    ),
    computeStats(wacz),
  ]);

  const issues = perRule.flat();
  const summary = summarise(issues, activeRules.length, Date.now() - startedAt);

  const report: Report = {
    waxlensVersion: opts.waxlensVersion,
    profile,
    file: opts.file,
    valid: summary.failed === 0,
    summary,
    issues,
    // Conditional spread keeps `stats` absent rather than
    // explicitly-undefined — required by exactOptionalPropertyTypes.
    ...(stats !== undefined && { stats }),
  };
  return ok(report);
};

/**
 * Apply the active profile's severity override to every issue the rule
 * produced. The override only fires for issues whose severity matches
 * the rule's baseline — see the file header for the floor rationale.
 */
const applyProfile = (issues: Issue[], rule: ValidationRule, profile: RuleProfile): Issue[] => {
  const override: Severity | undefined = rule.applicability?.severityByProfile?.[profile];
  if (override === undefined || override === rule.severity) return issues;
  return issues.map((issue) =>
    issue.severity === rule.severity ? { ...issue, severity: override } : issue,
  );
};

const summarise = (issues: Issue[], ruleCount: number, durationMs: number): ReportSummary => {
  let failed = 0;
  let warnings = 0;
  let info = 0;
  for (const issue of issues) {
    switch (issue.severity) {
      case "error":
        failed += 1;
        break;
      case "warning":
        warnings += 1;
        break;
      case "info":
        info += 1;
        break;
    }
  }
  // `passed` is a per-rule, not per-issue, count: a rule "passes" iff it
  // produced no error-severity issue. Warning/info-only rules still
  // count as passed for the headline — they're not failures.
  const failedRuleNames = new Set(issues.filter((i) => i.severity === "error").map((i) => i.rule));
  const passed = ruleCount - failedRuleNames.size;

  return { passed, failed, warnings, info, durationMs };
};
