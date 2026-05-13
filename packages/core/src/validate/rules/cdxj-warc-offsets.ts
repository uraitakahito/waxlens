/**
 * Rule: cdxj/warc-offsets
 *
 * Every CDXJ entry carries `offset` and `length` fields that name the
 * byte range of the WARC record inside `archive/data.warc.gz`. Both
 * MUST be valid integer strings that land exactly on an independent
 * gzip member boundary — otherwise replay tools that seek by offset
 * fetch garbage and silently return "Archived Page Not Found".
 *
 * Spec / convention: pywb / wacz-creator stringify offset / length as
 *       decimal; wabac.js's CDXJ loader parses both string and number
 *       forms, so the string-vs-number choice is producer freedom.
 * Reference producer: browserhive's `src/storage/wacz/cdxj.ts` emits
 *       them as strings.
 *
 * Cross-check strategy:
 *   1. Iterate the WARC file with the existing `iterateWarcMembers`
 *      and collect every (offset, length) pair into a map.
 *   2. For each CDXJ entry whose `filename` resolves to `data.warc.gz`,
 *      parse `offset`/`length` and look up the member.
 *   3. Mismatch → error, with the CDXJ line number AND the candidate
 *      members nearby (so the operator can eyeball the corruption).
 *
 * Only entries with `filename === "data.warc.gz"` are checked — other
 * filenames point to siblings the WACZ doesn't ship and a different
 * rule (filename-archive-relative, M1) already covers the archive/
 * prefix mistake.
 */
import { ok } from "../../result.js";
import { parseCdxj } from "../../wacz/cdxj-parser.js";
import { parseWarcRecord } from "../../wacz/warc-header.js";
import {
  WarcMemberDecodeError,
  iterateWarcMembers,
  type WarcMember,
} from "../../wacz/warc-iter.js";
import type { Issue, ValidationRule } from "../types.js";

const CDXJ_ENTRY = "indexes/index.cdxj";
const WARC_ENTRY = "archive/data.warc.gz";
const EXPECTED_FILENAME = "data.warc.gz";

export const cdxjWarcOffsetsRule: ValidationRule = {
  name: "cdxj/warc-offsets",
  description: `${CDXJ_ENTRY} offset/length must land on a WARC gzip-member boundary`,
  severity: "error",
  applicability: {
    severityByProfile: { lenient: "warning" },
  },

  run: async (wacz) => {
    const issues: Issue[] = [];

    const cdxjBuf = await wacz.readEntry(CDXJ_ENTRY);
    const warcBuf = await wacz.readEntry(WARC_ENTRY);
    if (!cdxjBuf || !warcBuf) return ok(issues); // other rules report absence.

    // `loose: true` because the warc/members-independent rule already
    // reports decode failures with rich context; we don't want a single
    // bad member to short-circuit the offset check and lose visibility
    // into the other CDXJ rows.
    let members: WarcMember[];
    try {
      members = Array.from(iterateWarcMembers(warcBuf, { loose: true }));
    } catch (error) {
      if (error instanceof WarcMemberDecodeError) return ok(issues);
      throw error;
    }
    const byOffset = new Map<number, WarcMember>();
    for (const m of members) byOffset.set(m.offset, m);

    const { entries } = parseCdxj(cdxjBuf.toString("utf-8"));
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const filename = entry.fields["filename"];
      if (filename !== EXPECTED_FILENAME) continue;

      const offsetField = entry.fields["offset"];
      const lengthField = entry.fields["length"];
      const offset = parseIntOrUndef(offsetField);
      const length = parseIntOrUndef(lengthField);

      const line = i + 1;
      if (offset === undefined || length === undefined) {
        issues.push({
          rule: "cdxj/warc-offsets",
          severity: "error",
          message: `${CDXJ_ENTRY} line ${String(line)}: offset / length missing or not numeric`,
          location: { entry: CDXJ_ENTRY, line },
          details: { offset: offsetField, length: lengthField },
        });
        continue;
      }

      const member = byOffset.get(offset);
      if (!member) {
        // Candidates carry the WARC-Type header so the operator can
        // tell at a glance whether the CDXJ row is pointing into a
        // plausible record. We sniff the closest two members rather
        // than dump all of them to keep the detail block readable.
        const candidates = members
          .map((m) => ({
            offset: m.offset,
            length: m.length,
            warcHeader: snippetHeader(m),
          }))
          .slice(0, 3);
        issues.push({
          rule: "cdxj/warc-offsets",
          severity: "error",
          message: `${CDXJ_ENTRY} line ${String(line)}: offset ${String(offset)} does not match any WARC gzip-member start`,
          location: { entry: CDXJ_ENTRY, line, offset },
          details: {
            requested: { offset, length },
            candidates,
          },
        });
        continue;
      }
      if (member.length !== length) {
        issues.push({
          rule: "cdxj/warc-offsets",
          severity: "error",
          message: `${CDXJ_ENTRY} line ${String(line)}: length ${String(length)} does not match WARC member at offset ${String(offset)} (actual ${String(member.length)})`,
          location: { entry: CDXJ_ENTRY, line, offset },
          details: {
            expected: { offset, length },
            actual: { offset: member.offset, length: member.length },
            // The full header block of the record actually present at
            // this offset, so the operator can tell whether the CDXJ
            // length is off by a header bug or the WARC was rewritten.
            warcHeader: snippetHeader(member),
          },
        });
      }
    }

    return ok(issues);
  },
};

/**
 * Pull the canonical WARC header lines (protocol + Key:Value lines, no
 * blank line separator) out of a member's decoded bytes. Used for
 * issue.details so the TUI's warcHeader view can show "what record
 * actually lives here" alongside the CDXJ row that pointed to it.
 */
const snippetHeader = (member: WarcMember): string[] => {
  const record = parseWarcRecord(member.raw);
  if (!record) return [];
  const lines: string[] = [];
  if (record.protocol !== undefined) lines.push(record.protocol);
  for (const h of record.headers) {
    lines.push(`${h.name}: ${h.value}`);
  }
  return lines;
};

const parseIntOrUndef = (raw: unknown): number | undefined => {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  if (typeof raw !== "string") return undefined;
  // CDXJ convention is decimal; reject anything with a non-digit so a
  // hex-looking offset doesn't silently match the wrong member.
  if (!/^\d+$/.test(raw)) return undefined;
  return Number.parseInt(raw, 10);
};
