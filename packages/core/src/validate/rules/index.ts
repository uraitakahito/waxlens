/**
 * Rule registry — engine が実行時に参照する唯一のリスト。
 *
 * 新しい rule を追加する = 専用ファイルから export して、ここに append
 * する。waxlens 内の他の層は新しい rule を知る必要が無い。CLI の将来の
 * `--rule` filter (M3 以降) は `ValidationRule.name` で識別する。
 *
 * 順序は cosmetic な理由でしか効かない: renderer は rule が生成した
 * 順に issue を辿るので、意味的にまとまった rule (datapackage/*、
 * cdxj/*、warc/*) を並べておくと読みやすい。
 */
import type { ValidationRule } from "../types.js";
import { cdxjFilenameRule } from "./cdxj-filename.js";
import { cdxjIndexRecognisedRule } from "./cdxj-index-recognised.js";
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
 * 完全な validation セット。M1_RULES (datapackage + cdxj の構造的
 * check) が先頭に来るので、最も可能性の高い producer バグが report
 * の上の方に上がる。cross-layer rule (#8 / #9) や WARC 内部 rule
 * (#7 / #10) はその後に続く。
 */
export const ALL_RULES: readonly ValidationRule[] = [
  datapackageProfileRule,
  datapackageWaczVersionRule,
  datapackageHashesRule,
  // cdxj/index-recognised-by-wabac は他の cdxj/* rule より先に来る。
  // 「index が全く無い」状態を最優先で出して、index を読む派生 rule
  // の二次的な不満より前に置きたいため。
  cdxjIndexRecognisedRule,
  cdxjNonGzippedRule,
  cdxjFilenameRule,
  warcStorageStoreRule,
  warcMembersIndependentRule,
  cdxjWarcOffsetsRule,
  cdxjPagesMainpageRule,
  warcPayloadDigestRule,
  fuzzyValidJsonRule,
];

/**
 * CLI / test が使う後方互換 alias。コードベースが ALL_RULES に
 * 移行する間、古い名前を使えるようにしておく。今は両者は同一。もし
 * いずれ小さい subset (例: "structural-only" vs "deep") を出すことに
 * なれば、ここで分割すれば call site を触らずに済む。
 */
export const M1_RULES = ALL_RULES;

/** Re-export for tests / library consumers that want to compose their own list. */
export {
  cdxjFilenameRule,
  cdxjIndexRecognisedRule,
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
