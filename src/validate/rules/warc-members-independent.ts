/**
 * Rule: warc/members-independent
 *
 * Each WARC record MUST occupy its own independent gzip member, so that
 * concatenating the members yields a valid `.warc.gz` per the WARC spec
 * and CDXJ offsets can seek to a single record without decoding the rest.
 *
 * Source: browserhive/src/storage/warc/writer.ts:1-15 (the producer
 * comment explains the independent-gzip-member invariant directly).
 *
 * Verification: walk the iterator with `loose: false` and let
 * `gunzipSync` reject any slice that isn't a self-contained gzip member.
 * `iterateWarcMembers` throws `WarcMemberDecodeError` on failure; we
 * catch it and report the offending offset/length.
 *
 * Severity is `error` — a non-independent-member WARC silently breaks
 * every replay engine that relies on the CDXJ offset/length pair.
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
    if (!bytes) return ok(issues); // resource-hashes / other rules surface absence.

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
        // Genuinely-unexpected throw — surface as an issue rather than
        // propagate, so the validation run still completes.
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
