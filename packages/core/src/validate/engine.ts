/**
 * Validation engine。
 *
 * 登録されている全 rule を与えられた WACZ に対して並列に走らせ、
 * 有効な profile の severity override を適用し、結果を 1 つの `Report`
 * に畳み込む。engine 自体は throw しない — rule の失敗は
 * `Result<Issue[], never>` として返る。
 *
 * 並列性: 各 rule は 1 〜 2 個の zip entry を読む。yauzl-promise は
 * 単一の ZipFile handle から並行 read stream を提供できるので、rule
 * を並列に走らせるのは安全であり、小さい WACZ では実時間も短くなる。
 * 将来 profiler ベースで予算を支配する rule を直列化することはあり
 * うる — 現状はシンプルな形が正しく速い。
 *
 * Profile dispatch:
 *   1. `excludeProfiles` に当たれば rule を完全に除外する (issue なし)。
 *   2. `severityByProfile[profile]` があれば各 issue の severity を上書き。
 *   3. それ以外なら rule のベースライン `severity` field をそのまま使う。
 *
 * Step 2/3 は rule 単位ではなく issue 単位で適用される。これは、ある
 * issue が rule のベースラインより既に "弱い" severity を持っている
 * ことがあるため (例: `warc/payload-digest` は rule のベースラインが
 * `warning` でも非 sha256 アルゴリズムの場合は `info` issue を出す)。
 * 個別 issue の severity は floor として扱い、profile override は
 * 当該 issue が rule のベースラインに一致する場合のみ発火する。これに
 * よって mixed-severity な rule が綺麗に振る舞う。
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

  // 実行前に `excludeProfiles` で rule をフィルタしておく。skip 対象の
  // rule は zip entry の読み込みすら走らせない。
  const activeRules = opts.rules.filter(
    (rule) => !rule.applicability?.excludeProfiles?.includes(profile),
  );

  // validation rule と stats 抽出を並列に走らせる — stats は
  // best-effort (内部失敗時は undefined を返す) で rule とは独立なので、
  // 順序ハザードは無い。
  const [perRule, stats] = await Promise.all([
    Promise.all(
      activeRules.map(async (rule) => {
        const result = await rule.run(wacz);
        // `Result<Issue[], never>` は ok 分岐しか取りえないが、strict
        // mode では narrowing check が必要。default 分岐は到達不能。
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
    // 条件付き spread にすることで `stats` を "明示的に undefined" で
    // はなく「不在」として表現できる — exactOptionalPropertyTypes が
    // これを要求する。
    ...(stats !== undefined && { stats }),
  };
  return ok(report);
};

/**
 * rule が生成した各 issue に、現在 profile の severity override を
 * 適用する。override は issue の severity が rule のベースラインに
 * 一致するときのみ発火する — floor の根拠はファイルヘッダ参照。
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
  // `passed` は issue 単位ではなく rule 単位のカウント: rule が
  // "passed" になるのは error severity の issue を 1 件も出さなかった
  // 場合のみ。warning / info しか出さない rule も headline では
  // passed としてカウントする — fail ではないから。
  const failedRuleNames = new Set(issues.filter((i) => i.severity === "error").map((i) => i.rule));
  const passed = ruleCount - failedRuleNames.size;

  return { passed, failed, warnings, info, durationMs };
};
