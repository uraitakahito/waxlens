/**
 * waxlens library entry point.
 *
 * Re-exports the validation primitives so external consumers (test
 * harnesses, alternative front-ends) can run the engine without going
 * through the CLI. The CLI in `dist/cli.js` remains the primary surface.
 */
export { WaczReader } from "./wacz/reader.js";
export { runValidation } from "./validate/engine.js";
export { M1_RULES } from "./validate/rules/index.js";
export type {
  Issue,
  IssueLocation,
  Report,
  ReportSummary,
  Severity,
  ValidationRule,
} from "./validate/types.js";
