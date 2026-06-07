/**
 * Plain-text renderer (tui 内部用)。
 *
 * `waxlens` (@waxlens/tui の bin) が TUI を抑止しているとき
 * (`--no-tui`、または stdout/stdin が TTY でないとき) に使う。
 *
 * daemon が message / specUrl / conformance まで解決した {@link WireReport} を
 * 渡してくるので、ここでは core の i18n も lookup も呼ばず解決済みフィールドを
 * そのまま出す(`@waxlens/core` を import しない)。
 *
 * 出力形:
 *
 *   waxlens 0.0.0  /path/to/file.wacz
 *
 *   [✓] datapackage/profile-required
 *   [✗] cdxj/filename-archive-relative
 *       indexes/index.cdxj:1 — entry "filename" starts with "archive/"
 *
 *   1 passed, 1 failed, 0 warnings, 0 info  · 12ms
 *
 * Color は picocolors に委譲する。`color` フラグが false のとき picocolors は
 * no-op 関数群に切り替わる。
 */
import pc from "picocolors";
import type { WireIssue, WireReport } from "@waxlens/protocol";
import { buildEntryTree, entryMarker, flattenTree } from "./tree.js";

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
 * 全テキストを組み立てる。返り値は文字列で、CLI がそれを stdout に
 * 一気に書く(複数 process が同じ TTY に書いたときの atomic 性のため)。
 */
export const renderPlain = (report: WireReport, opts: PlainRenderOptions): string => {
  const c = opts.color ? pc : noColor;
  const lines: string[] = [];

  const sourceLabel = report.source.kind === "file" ? report.source.path : report.source.uri;
  lines.push(`${c.bold("waxlens")} ${c.dim(report.waxlensVersion)}  ${sourceLabel}`);
  lines.push("");

  const ruleNames = new Set<string>();
  for (const issue of report.issues) ruleNames.add(issue.rule);

  for (const ruleName of ruleNames) {
    const ruleIssues = report.issues.filter((i) => i.rule === ruleName);
    const worst = worstSeverity(ruleIssues);
    const headerIcon =
      worst === "error" ? ICON.error : worst === "warning" ? ICON.warning : ICON.info;
    const headerColor = worst === "error" ? c.red : worst === "warning" ? c.yellow : c.cyan;
    // spec の規範レベル(MUST/SHOULD/MAY)を rule 名の後に併記。同 rule の issue は
    // 同じ conformance を持つので先頭から取る。severity とは別軸。
    const conformance = ruleIssues[0]?.conformance;
    const conformanceBadge = conformance !== undefined ? `  ${c.dim(conformance)}` : "";
    lines.push(`${headerColor(`[${headerIcon}]`)} ${c.bold(ruleName)}${conformanceBadge}`);
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

  if (report.entries.length > 0) {
    lines.push("");
    lines.push(c.bold("Layout"));
    lines.push(...formatLayout(report, c));
  }

  return lines.join("\n") + "\n";
};

const identity = (s: string): string => s;

const formatLayout = (report: WireReport, c: typeof pc): string[] =>
  flattenTree(buildEntryTree(report.entries)).map((row) => {
    const mk = entryMarker(row.entry);
    const tone = mk.tone === "error" ? c.red : mk.tone === "warning" ? c.yellow : identity;
    const size =
      row.entry?.present === true && row.entry.uncompressedSize !== undefined
        ? c.dim(`  ${formatBytes(row.entry.uncompressedSize)}`)
        : "";
    const rules = mk.rules.length > 0 ? tone(` ${mk.rules.join(", ")}`) : "";
    const marker = mk.glyph ? `  ${tone(mk.glyph)}${rules}` : "";
    return `${row.connector}${row.name}${size}${marker}`;
  });

const formatStats = (stats: NonNullable<WireReport["stats"]>, c: typeof pc): string => {
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
 * 単一の issue を整形する。location はインラインに簡潔に出し、structured な
 * details は 1 段下げて JSON 化する。message / specUrl は daemon が解決済み。
 */
const formatIssue = (issue: WireIssue, c: typeof pc): string => {
  const where = formatLocation(issue);
  const wherePart = where ? `${c.dim(where)} — ` : "";
  const out = [`${wherePart}${issue.message}`];

  if (issue.specUrl !== undefined) out.push(`      ${c.dim(`spec ${issue.specUrl}`)}`);

  if (issue.details !== undefined) {
    const json = JSON.stringify(issue.details);
    const truncated = json.length > 200 ? `${json.slice(0, 200)}…` : json;
    out.push(`      ${c.dim(truncated)}`);
  }

  return out.join("\n");
};

const formatLocation = (issue: WireIssue): string => {
  const loc = issue.location;
  if (!loc) return "";
  let result = loc.entry ?? "";
  if (loc.line !== undefined) result += `:${String(loc.line)}`;
  if (loc.offset !== undefined) result += `@${String(loc.offset)}`;
  return result;
};

const formatSummary = (report: WireReport, c: typeof pc): string => {
  const s = report.summary;
  const parts = [
    c.green(`${String(s.passed)} passed`),
    s.failed > 0 ? c.red(`${String(s.failed)} failed`) : `${String(s.failed)} failed`,
    s.warnings > 0 ? c.yellow(`${String(s.warnings)} warnings`) : `${String(s.warnings)} warnings`,
    `${String(s.info)} info`,
  ];
  return `${parts.join(", ")}  ${c.dim(`· ${String(s.durationMs)}ms`)}`;
};

const worstSeverity = (issues: WireIssue[]): "error" | "warning" | "info" => {
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  return "info";
};

/**
 * Identity を返す picocolors 形のオブジェクト。`--no-color` のとき本物の `pc`
 * の代わりに使う(call site は同一のまま)。structural cast で型付けする。
 */
const noColor = {
  bold: (s: string) => s,
  dim: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  green: (s: string) => s,
  cyan: (s: string) => s,
} as unknown as typeof pc;
