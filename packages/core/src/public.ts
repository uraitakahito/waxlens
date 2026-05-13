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
export { ALL_RULES, M1_RULES } from "./validate/rules/index.js";
export { renderJson } from "./render/json.js";
export type {
  Issue,
  IssueLocation,
  Report,
  ReportStats,
  ReportSummary,
  RuleApplicability,
  RuleProfile,
  Severity,
  ValidationRule,
} from "./validate/types.js";
export { ALL_PROFILES } from "./validate/types.js";
