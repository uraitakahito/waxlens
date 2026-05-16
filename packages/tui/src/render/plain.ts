/**
 * Plain-text renderer (tui 内部用)。
 *
 * `waxlens` (@waxlens/tui の bin) が TUI を抑止しているとき
 * (`--no-tui`、または stdout/stdin が TTY でないとき) に使う。
 * @waxlens/tui の public API ではない — この package が library として
 * export しているのは `app.tsx` の `App` コンポーネントのみ。
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
 * Color は picocolors に委譲する。`color` フラグが false のとき
 * picocolors は no-op 関数群に切り替わるので、同じテンプレートで
 * pipe でも綺麗に render できる。picocolors 自身も、stdout が TTY
 * で無い (または `NO_COLOR` が設定されている) ときには自動で抑止
 * するので、明示的なフラグは belt-and-braces な保証を求めるスクリプト
 * のためにある。
 */
import pc from "picocolors";
import type { Issue, Report } from "@waxlens/core";

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
 * 一気に書く。これによって複数 process が同じ TTY に書いたときの
 * 出力 atomic 性が保たれる。
 */
export const renderPlain = (report: Report, opts: PlainRenderOptions): string => {
  const c = opts.color ? pc : noColor;
  const lines: string[] = [];

  const sourceLabel = report.source.kind === "file" ? report.source.path : report.source.uri;
  lines.push(`${c.bold("waxlens")} ${c.dim(report.waxlensVersion)}  ${sourceLabel}`);
  lines.push("");

  // issue を rule で bucket して、各 rule を 1 度だけ表示できるよう
  // にする。issue が無い rule は pass アイコン付きで列挙、issue がある
  // rule は worst severity をヘッダに出してから詳細を下に並べる。
  const ruleNames = new Set<string>();
  for (const issue of report.issues) ruleNames.add(issue.rule);

  const rulesWithIssues = Array.from(ruleNames);
  // renderer は summary から推論する: total passes = summary.passed;
  // failing rule = issue を出した rule。issue を出した rule を先に
  // render し、その後に "+N passing rules" を 1 行だけ末尾に置く —
  // 人間にとっての信号雑音比を高く保つため。
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
 * 単一の issue を整形する。location はインラインに簡潔に出し、
 * 構造化された details は 1 段インデントを下げて JSON 化する。これに
 * よって renderer が JSON consumer に見えるデータについて嘘をつかない。
 */
const formatIssue = (issue: Issue, c: typeof pc): string => {
  const where = formatLocation(issue);
  const wherePart = where ? `${c.dim(where)} — ` : "";
  const out = [`${wherePart}${issue.message}`];

  if (issue.details !== undefined) {
    const json = JSON.stringify(issue.details);
    // `details` の中の長い hex dump が plain layout を壊さないよう
    // detail 行は 200 文字で切る。完全な payload は @waxlens/core の
    // JSON 出力でいつでも見られる。
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
 * Identity を返す picocolors 形のオブジェクト。`--no-color` のとき
 * 本物の `pc` import の代わりに使う。call site は同一のままに保てる。
 * picocolors の `Colors` interface は多数の style 関数を持つが、
 * ここではすべてミラーする必要は無く、上で使う `c.x(...)` 呼び出しを
 * 満たせばよいので、structural な cast で型付けする。
 */
const noColor = {
  bold: (s: string) => s,
  dim: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  green: (s: string) => s,
  cyan: (s: string) => s,
} as unknown as typeof pc;
