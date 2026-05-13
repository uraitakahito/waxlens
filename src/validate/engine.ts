/**
 * Validation engine.
 *
 * Runs every registered rule against the supplied WACZ in parallel and
 * folds the results into a single `Report`. The engine itself never
 * throws — rule failures are returned as `Result<Issue[], never>` so a
 * `Promise.allSettled` is unnecessary; we can use `Promise.all` and let
 * any genuinely-unexpected throw propagate (that would indicate a bug in
 * a rule, not a validation failure).
 *
 * Parallelism: the M1 rules each read 1–2 zip entries. yauzl-promise can
 * service concurrent read streams from a single ZipFile handle, so
 * running rules in parallel is safe and cuts wall-clock for small WACZ
 * files. A future profiler-driven change might serialise rules that
 * dominate the budget — for now, the simple form is correct and fast.
 */
import type { Result } from "../result.js";
import { ok } from "../result.js";
import type { WaczReader } from "../wacz/reader.js";
import type { Issue, Report, ReportSummary, ValidationRule } from "./types.js";

export interface RunOptions {
  file: string;
  waxlensVersion: string;
  rules: readonly ValidationRule[];
}

export const runValidation = async (
  wacz: WaczReader,
  opts: RunOptions,
): Promise<Result<Report, never>> => {
  const startedAt = Date.now();

  const perRule = await Promise.all(
    opts.rules.map(async (rule) => {
      const result = await rule.run(wacz);
      // `Result<Issue[], never>` can only be the ok branch — the err
      // branch's `error` is typed as `never`, which is uninhabited — but
      // we still need a narrowing check to access `value` under
      // strict mode. The default below is unreachable.
      return result.ok ? result.value : [];
    }),
  );

  const issues = perRule.flat();
  const summary = summarise(issues, opts.rules.length, Date.now() - startedAt);

  const report: Report = {
    waxlensVersion: opts.waxlensVersion,
    file: opts.file,
    valid: summary.failed === 0,
    summary,
    issues,
  };
  return ok(report);
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
