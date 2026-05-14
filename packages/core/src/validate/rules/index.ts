/**
 * Rule registry — engine が実行時に参照する唯一のリスト。
 *
 * 新しい rule を追加する = 専用ファイルから export して、`DEFAULT_RULES`
 * に append する。waxlens 内の他の層は新しい rule を知る必要が無い。
 * CLI の将来の `--rule` filter は `ValidationRule.name` で識別する。
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
 * 完全な validation セット。datapackage 系と cdxj の構造 check を
 * 先頭に置くことで、最も可能性の高い producer バグが report の上の方に
 * 上がる。cross-layer rule や WARC 内部 rule はその後に続く。
 *
 * library consumer が subset を渡したいときは `runValidation({ rules })`
 * に独自配列を渡せる — engine は `readonly ValidationRule[]` を受け
 * るので、ここからの cherry-pick で柔軟に組める。
 */
export const DEFAULT_RULES: readonly ValidationRule[] = [
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
