/**
 * Plain-text renderer.
 *
 * Used when stdout is piped, when `--no-color` is passed, and (until M2)
 * for interactive runs as well. The output is intentionally easy to grep:
 *
 *   waxlens 0.0.0  /path/to/file.wacz
 *
 *   [✓] datapackage/profile-required
 *   [✗] cdxj/filename-archive-relative
 *       indexes/index.cdxj:1 — entry "filename" starts with "archive/"
 *
 *   1 passed, 1 failed, 0 warnings, 0 info  · 12ms
 *
 * Color is delegated to picocolors. When the `color` flag is false the
 * library reverts to no-op functions, so the same template renders
 * cleanly in pipes.
 */
import pc from "picocolors";
import type { Issue, Report } from "../validate/types.js";

export interface PlainRenderOptions {
  color: boolean;
}

const ICON = {
  pass: "✓",
  error: "✗",
  warning: "!",
  info: "i",
} as const;

/**
 * Build the full text. Returns the string; the CLI writes it to stdout in
 * one go, which keeps the output atomic in case multiple processes ever
 * write to the same TTY.
 */
export const renderPlain = (report: Report, opts: PlainRenderOptions): string => {
  const c = opts.color ? pc : noColor;
  const lines: string[] = [];

  lines.push(`${c.bold("waxlens")} ${c.dim(report.waxlensVersion)}  ${report.file}`);
  lines.push("");

  // Bucket issues by rule so we can show each rule once. Rules with no
  // issues are listed with a pass icon; rules with any issue show the
  // worst severity and the details below.
  const ruleNames = new Set<string>();
  for (const issue of report.issues) ruleNames.add(issue.rule);

  const rulesWithIssues = Array.from(ruleNames);
  // For M1 we don't have a global rule-name list at render time (the CLI
  // passes only the report), so the renderer infers from the summary:
  // total passes = summary.passed; total failing rules = issued rules.
  // We render the issued rules first, then a single "+N passing rules"
  // tail so the human signal-to-noise stays high.
  for (const ruleName of rulesWithIssues) {
    const ruleIssues = report.issues.filter((i) => i.rule === ruleName);
    const worst = worstSeverity(ruleIssues);
    const headerIcon =
      worst === "error" ? ICON.error : worst === "warning" ? ICON.warning : ICON.info;
    const headerColor = worst === "error" ? c.red : worst === "warning" ? c.yellow : c.cyan;
    lines.push(`${headerColor(`[${headerIcon}]`)} ${c.bold(ruleName)}`);
    for (const issue of ruleIssues) {
      lines.push(`    ${formatIssue(issue, c)}`);
    }
  }

  if (report.summary.passed > 0) {
    lines.push(
      `${c.green(`[${ICON.pass}]`)} ${c.dim(`${String(report.summary.passed)} other rule(s) passed`)}`,
    );
  }

  lines.push("");
  lines.push(formatSummary(report, c));
  if (report.stats) lines.push(formatStats(report.stats, c));

  return lines.join("\n") + "\n";
};

const formatStats = (stats: NonNullable<Report["stats"]>, c: typeof pc): string => {
  const parts = [
    `${String(stats.warcRecordCount)} record${stats.warcRecordCount === 1 ? "" : "s"}`,
    formatBytes(stats.warcArchiveBytes),
    `${String(stats.hosts.length)} host${stats.hosts.length === 1 ? "" : "s"}`,
  ];
  return c.dim(parts.join("  ·  "));
};

const formatBytes = (n: number): string => {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

/**
 * Format a single issue. Location is printed compactly inline; structured
 * details are JSON-stringified on the next indent level so the renderer
 * never lies about the data the JSON consumer would see.
 */
const formatIssue = (issue: Issue, c: typeof pc): string => {
  const where = formatLocation(issue);
  const wherePart = where ? `${c.dim(where)} — ` : "";
  const out = [`${wherePart}${issue.message}`];

  if (issue.details !== undefined) {
    const json = JSON.stringify(issue.details);
    // Cap the detail line at 200 chars so a long hex dump in `details`
    // doesn't ruin the plain layout. Full payload is always available in
    // `--json` output.
    const truncated = json.length > 200 ? `${json.slice(0, 200)}…` : json;
    out.push(`      ${c.dim(truncated)}`);
  }

  return out.join("\n");
};

const formatLocation = (issue: Issue): string => {
  const loc = issue.location;
  if (!loc) return "";
  let result = loc.entry ?? "";
  if (loc.line !== undefined) result += `:${String(loc.line)}`;
  if (loc.offset !== undefined) result += `@${String(loc.offset)}`;
  return result;
};

const formatSummary = (report: Report, c: typeof pc): string => {
  const s = report.summary;
  const parts = [
    c.green(`${String(s.passed)} passed`),
    s.failed > 0 ? c.red(`${String(s.failed)} failed`) : `${String(s.failed)} failed`,
    s.warnings > 0 ? c.yellow(`${String(s.warnings)} warnings`) : `${String(s.warnings)} warnings`,
    `${String(s.info)} info`,
  ];
  return `${parts.join(", ")}  ${c.dim(`· ${String(s.durationMs)}ms`)}`;
};

const worstSeverity = (issues: Issue[]): "error" | "warning" | "info" => {
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return "info";
};

/**
 * Identity-passing picocolors-shaped object. Replaces the real `pc`
 * import when `--no-color` is requested; keeps the call sites identical.
 * Typed via a structural cast because picocolors' `Colors` interface
 * exposes a long list of style functions — we don't need to mirror them
 * here, only to satisfy the few `c.x(...)` calls used above.
 */
const noColor = {
  bold: (s: string) => s,
  dim: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  green: (s: string) => s,
  cyan: (s: string) => s,
} as unknown as typeof pc;
