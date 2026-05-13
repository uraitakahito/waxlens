/**
 * Rule: warc/members-independent
 *
 * 各 WARC record は独立した gzip member として配置する必要がある。
 * そうすると WARC spec に従って member を連結したものが valid な
 * `.warc.gz` になり、CDXJ offset で他を decode せず単一 record まで
 * seek できる。
 *
 * Spec: WARC 1.1 §A.1 ("Record at a time gzip" — 各 record は
 *       自己完結した gzip member で、ファイルはそれらの member の
 *       連結)。
 * Reference producer: browserhive/src/storage/warc/writer.ts:1-15
 *       がこの不変条件をコードコメントで直接 ドキュメント化している。
 *
 * 検証方法: iterator を `loose: false` で歩いて `gunzipSync` に
 * 自己完結 gzip member でないスライスを reject させる。
 * `iterateWarcMembers` は失敗時に `WarcMemberDecodeError` を throw
 * する; これを catch して、問題の offset / length を報告する。
 *
 * Severity は `error` — non-independent-member な WARC は CDXJ の
 * offset/length ペアに依存するすべての replay engine を silent に
 * 壊す。
 */
import { ok } from "../../result.js";
import { WarcMemberDecodeError, iterateWarcMembers } from "../../wacz/warc-iter.js";
import type { Issue, ValidationRule } from "../types.js";

const WARC_ENTRY = "archive/data.warc.gz";

export const warcMembersIndependentRule: ValidationRule = {
  name: "warc/members-independent",
  description: `${WARC_ENTRY} must concatenate independent gzip members`,
  severity: "error",

  run: async (wacz) => {
    const issues: Issue[] = [];
    const bytes = await wacz.readEntry(WARC_ENTRY);
    if (!bytes) return ok(issues); // 不在は resource-hashes など他の rule が表面化する。

    try {
      let memberCount = 0;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for (const _ of iterateWarcMembers(bytes, { loose: false })) {
        memberCount += 1;
      }
      if (memberCount === 0) {
        issues.push({
          rule: "warc/members-independent",
          severity: "error",
          message: `${WARC_ENTRY} contains no gzip members (empty or unrecognised)`,
          location: { entry: WARC_ENTRY },
          details: { archiveBytes: bytes.byteLength },
        });
      }
    } catch (error) {
      if (error instanceof WarcMemberDecodeError) {
        issues.push({
          rule: "warc/members-independent",
          severity: "error",
          message: `Failed to decode gzip member at offset ${String(error.offset)} (length ${String(error.length)})`,
          location: { entry: WARC_ENTRY, offset: error.offset },
          details: {
            offset: error.offset,
            length: error.length,
            reason: error.cause instanceof Error ? error.cause.message : String(error.cause),
          },
        });
      } else {
        // 想定外の throw — propagate せず issue として表面化することで、
        // 検証 run 自体は最後まで走らせる。
        issues.push({
          rule: "warc/members-independent",
          severity: "error",
          message: `Unexpected error walking ${WARC_ENTRY}: ${error instanceof Error ? error.message : String(error)}`,
          location: { entry: WARC_ENTRY },
        });
      }
    }

    return ok(issues);
  },
};
