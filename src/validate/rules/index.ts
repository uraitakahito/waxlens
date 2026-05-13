/**
 * Rule registry — the single list the engine consults at run time.
 *
 * Adding a new rule = export it from its own file and append it here. No
 * other layer in waxlens needs to learn about the new rule; the CLI's
 * future `--rule` filter (M3) will key off `ValidationRule.name`.
 *
 * Order matters only for cosmetic reasons: the renderer walks the
 * issues in the order rules produced them, so semantically-grouped rules
 * (datapackage/*, cdxj/*) read better when adjacent.
 */
import type { ValidationRule } from "../types.js";
import { cdxjFilenameRule } from "./cdxj-filename.js";
import { cdxjNonGzippedRule } from "./cdxj-non-gzipped.js";
import { datapackageHashesRule } from "./datapackage-hashes.js";
import { datapackageProfileRule } from "./datapackage-profile.js";
import { datapackageWaczVersionRule } from "./datapackage-wacz-version.js";

export const M1_RULES: readonly ValidationRule[] = [
  datapackageProfileRule,
  datapackageWaczVersionRule,
  datapackageHashesRule,
  cdxjNonGzippedRule,
  cdxjFilenameRule,
];

/** Re-export for tests / library consumers that want to compose their own list. */
export {
  cdxjFilenameRule,
  cdxjNonGzippedRule,
  datapackageHashesRule,
  datapackageProfileRule,
  datapackageWaczVersionRule,
};
