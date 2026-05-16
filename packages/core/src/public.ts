/**
 * @waxlens/core の public API。
 *
 * `@waxlens/tui` (および他の downstream consumer) が in-process で
 * validation を駆動するのに必要なものを一通り export する。この
 * module をインポートすると `commander` が推移的に入るが、rendering
 * 系のライブラリは入らない — CLI bin (`waxlens-validate`) は別
 * entry で、呼ばない限りロードされない。human-readable な rendering
 * は @waxlens/tui 側に置いてある。
 */
export { WaczReader } from "./wacz/reader.js";
export { DEFAULT_PROFILE, runValidation } from "./validate/engine.js";
export { DEFAULT_RULES } from "./validate/rules/index.js";
export { renderJson } from "./render/json.js";
export type {
  AbsolutePath,
  Issue,
  IssueLocation,
  Report,
  ReportSource,
  ReportStats,
  ReportSummary,
  RuleApplicability,
  RuleProfile,
  S3Uri,
  Severity,
  ValidationRule,
} from "./validate/types.js";
export {
  ALL_PROFILES,
  asAbsolutePath,
  parseS3Uri,
  s3UriToBucketKey,
} from "./validate/types.js";
// CLI outcome は @waxlens/tui の bin (`waxlens`) が core の bin
// (`waxlens-validate`) と同じ exit-code mapping を再利用するために
// public surface に置く。純型 + 純関数なので runtime コストは無く、
// 純粋に validation を library として使う consumer は無視できる。
export type { CliOutcome } from "./cli-outcome.js";
export { exitCodeFor } from "./cli-outcome.js";
