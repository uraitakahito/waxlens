/**
 * Rule registry — the single list the engine consults at run time.
 *
 * Adding a new rule = export it from its own file and append it here. No
 * other layer in waxlens needs to learn about the new rule; the CLI's
 * future `--rule` filter (M3+) will key off `ValidationRule.name`.
 *
 * Order matters only for cosmetic reasons: the renderer walks the
 * issues in the order rules produced them, so semantically-grouped rules
 * (datapackage/*, cdxj/*, warc/*) read better when adjacent.
 */
import type { ValidationRule } from "../types.js";
import { cdxjFilenameRule } from "./cdxj-filename.js";
import { cdxjNonGzippedRule } from "./cdxj-non-gzipped.js";
import { cdxjPagesMainpageRule } from "./cdxj-pages-mainpage.js";
import { cdxjWarcOffsetsRule } from "./cdxj-warc-offsets.js";
import { datapackageHashesRule } from "./datapackage-hashes.js";
import { datapackageProfileRule } from "./datapackage-profile.js";
import { datapackageWaczVersionRule } from "./datapackage-wacz-version.js";
import { fuzzyValidJsonRule } from "./fuzzy-valid-json.js";
import { warcMembersIndependentRule } from "./warc-members-independent.js";
import { warcPayloadDigestRule } from "./warc-payload-digest.js";
import { warcStorageStoreRule } from "./warc-storage-store.js";

/**
 * The full validation set. M1_RULES (datapackage + cdxj structural
 * checks) lands first so the most-likely producer bugs surface high in
 * the report; the cross-layer rules (#8 / #9) and WARC-internal rules
 * (#7 / #10) follow.
 */
export const ALL_RULES: readonly ValidationRule[] = [
  datapackageProfileRule,
  datapackageWaczVersionRule,
  datapackageHashesRule,
  cdxjNonGzippedRule,
  cdxjFilenameRule,
  // -- M3 additions below --
  warcStorageStoreRule,
  warcMembersIndependentRule,
  cdxjWarcOffsetsRule,
  cdxjPagesMainpageRule,
  warcPayloadDigestRule,
  fuzzyValidJsonRule,
];

/**
 * Backwards-compatible alias used by the CLI and tests. Keeps the
 * earlier name working while the codebase transitions to ALL_RULES.
 * Today the two are identical; if a smaller subset ever ships (e.g.
 * "structural-only" vs "deep") we can split them here without touching
 * call sites.
 */
export const M1_RULES = ALL_RULES;

/** Re-export for tests / library consumers that want to compose their own list. */
export {
  cdxjFilenameRule,
  cdxjNonGzippedRule,
  cdxjPagesMainpageRule,
  cdxjWarcOffsetsRule,
  datapackageHashesRule,
  datapackageProfileRule,
  datapackageWaczVersionRule,
  fuzzyValidJsonRule,
  warcMembersIndependentRule,
  warcPayloadDigestRule,
  warcStorageStoreRule,
};
