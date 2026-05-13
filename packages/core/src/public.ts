/**
 * @waxlens/core public API.
 *
 * Everything `@waxlens/tui` (and any other downstream consumer) needs
 * to drive validation in-process. Importing this module pulls in
 * `commander` transitively, but never `ink`/`react`; the CLI bin
 * (`waxlens-validate`) is a separate entry that doesn't get loaded
 * unless callers reach for it.
 */
export { WaczReader } from "./wacz/reader.js";
export { DEFAULT_PROFILE, runValidation } from "./validate/engine.js";
export { ALL_RULES, M1_RULES } from "./validate/rules/index.js";
export { renderJson } from "./render/json.js";
export { renderPlain, type PlainRenderOptions } from "./render/plain.js";
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
