/**
 * Rule: warc/payload-digest
 *
 * The `WARC-Payload-Digest` header MUST match a fresh SHA-256 over the
 * record's payload bytes. "Payload" is type-dependent per the WARC 1.1
 * spec §6.2:
 *
 *   - response / request:  the HTTP entity body (bytes after the inner
 *                          `\r\n\r\n` separator)
 *   - warcinfo / metadata: the record body verbatim
 *   - resource:            the record body verbatim
 *   - revisit:             intentionally NOT checked here — revisit
 *                          records re-state another record's digest
 *                          rather than carrying their own payload, so
 *                          a local sha doesn't apply
 *
 * The digest format is `sha256:<BASE32>` (RFC 4648, uppercase, no
 * padding). Producers that emit any other algorithm (`sha1:...`, etc.)
 * are accepted with an info-level note rather than a warning, since
 * the spec allows arbitrary `algorithm:value` and waxlens isn't a
 * spec-coverage suite.
 *
 * Severity: `warning`. Replay tools generally don't re-verify digests
 * at lookup time, so a mismatch doesn't break the user-visible behaviour
 * — but it does indicate the WARC bytes were modified after the producer
 * recorded the response, which is almost always corruption.
 */
import { ok } from "../../result.js";
import { formatHexLines } from "../../render/hex.js";
import { sha256Base32 } from "../../wacz/digest.js";
import { getHeader, httpEntityBody, parseWarcRecord } from "../../wacz/warc-header.js";
import { iterateWarcMembers } from "../../wacz/warc-iter.js";
import type { Issue, ValidationRule } from "../types.js";

const WARC_ENTRY = "archive/data.warc.gz";

/**
 * Record types whose `WARC-Payload-Digest` covers the record body verbatim.
 * Everything else either uses the HTTP-entity slice (response/request) or
 * lacks a meaningful local payload (revisit).
 */
const BODY_VERBATIM_TYPES = new Set(["warcinfo", "metadata", "resource"]);

export const warcPayloadDigestRule: ValidationRule = {
  name: "warc/payload-digest",
  description: `WARC records' WARC-Payload-Digest must match a fresh sha256 of the payload`,
  severity: "warning",

  run: async (wacz) => {
    const issues: Issue[] = [];
    const warcBuf = await wacz.readEntry(WARC_ENTRY);
    if (!warcBuf) return ok(issues); // resource-hashes covers absence.

    let memberIdx = 0;
    for (const member of iterateWarcMembers(warcBuf, { loose: true })) {
      memberIdx += 1;
      const record = parseWarcRecord(member.raw);
      if (!record) continue;

      const recordType = (getHeader(record, "WARC-Type") ?? "").toLowerCase();
      const declared = getHeader(record, "WARC-Payload-Digest");
      if (declared === undefined) continue; // optional per spec.

      if (recordType === "revisit") continue; // see header comment.

      // Algorithms other than sha256 are accepted by the spec; rule
      // surfaces them informatively so the operator knows the line is
      // un-verified rather than mismatched.
      if (!declared.toLowerCase().startsWith("sha256:")) {
        issues.push({
          rule: "warc/payload-digest",
          severity: "info",
          message: `WARC record #${String(memberIdx)} uses non-sha256 digest "${declared.split(":")[0] ?? ""}" — not verified`,
          location: { entry: WARC_ENTRY, offset: member.offset },
          details: { recordType, declared },
        });
        continue;
      }

      const payload = BODY_VERBATIM_TYPES.has(recordType) ? record.body : httpEntityBody(record);
      if (payload === null) {
        issues.push({
          rule: "warc/payload-digest",
          severity: "warning",
          message: `WARC record #${String(memberIdx)} (${recordType || "unknown"}) has WARC-Payload-Digest but no parseable HTTP body`,
          location: { entry: WARC_ENTRY, offset: member.offset },
          details: { recordType, declared },
        });
        continue;
      }

      const computed = sha256Base32(payload);
      if (computed.toUpperCase() !== declared.toUpperCase()) {
        issues.push({
          rule: "warc/payload-digest",
          severity: "warning",
          message: `WARC record #${String(memberIdx)} payload digest mismatch`,
          location: { entry: WARC_ENTRY, offset: member.offset },
          details: {
            recordType,
            expected: declared,
            actual: computed,
            payloadBytes: payload.byteLength,
            // First 256 bytes of the payload as a hex dump — lets the
            // operator eyeball whether the bytes look like the
            // resource the record is supposed to be carrying (HTML?
            // image? all-zero pad?). M3 plan calls this "hex viewer".
            hexPreview: formatHexLines(payload),
          },
        });
      }
    }

    return ok(issues);
  },
};
