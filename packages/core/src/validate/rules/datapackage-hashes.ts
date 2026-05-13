/**
 * Rule: datapackage/resource-hashes
 *
 * Every entry in `datapackage.json#resources[]` declares `path` + `hash` +
 * `bytes` for one of the other WACZ files (archive/data.warc.gz,
 * indexes/index.cdxj, pages/pages.jsonl, fuzzy.json, …). The hashes are
 * `sha256:<hex>` over the *uncompressed* entry payload, and the bytes
 * field is the corresponding length. We recompute both from the actual
 * zip contents and flag any mismatch.
 *
 * Spec: Frictionless Data Package descriptor (the format WACZ borrows
 *       for `datapackage.json#resources[]`) defines `hash` as
 *       `sha256:<hex>` and `bytes` as the integer file length.
 * Reference producer: browserhive/src/storage/wacz/datapackage.ts:68-83
 *       shows the hash + length assembly straight from emitted bytes.
 *
 * Failure modes worth distinguishing in the report:
 *   - resource missing from the zip            → error
 *   - resource present but hash mismatched     → error (with expected/actual)
 *   - resource present but bytes mismatched    → error (separate issue)
 *   - resources[] empty / non-array            → error (signals a producer bug)
 */
import { ok } from "../../result.js";
import { sha256Hex } from "../../wacz/digest.js";
import { parseDatapackage } from "../../wacz/datapackage.js";
import type { Issue, ValidationRule } from "../types.js";

const DATAPACKAGE_ENTRY = "datapackage.json";

export const datapackageHashesRule: ValidationRule = {
  name: "datapackage/resource-hashes",
  description: `${DATAPACKAGE_ENTRY} resource hashes must match the WACZ contents`,
  severity: "error",

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(DATAPACKAGE_ENTRY);
    if (!buf) return ok(issues); // profile rule already reported the absence.

    const pkg = parseDatapackage(buf.toString("utf-8"));
    if (!pkg) return ok(issues); // profile rule already reported the parse failure.

    const resources = pkg.resources;
    if (!Array.isArray(resources) || resources.length === 0) {
      issues.push({
        rule: "datapackage/resource-hashes",
        severity: "error",
        message: `${DATAPACKAGE_ENTRY} has no "resources" array (or it is empty)`,
        location: { entry: DATAPACKAGE_ENTRY },
      });
      return ok(issues);
    }

    for (const res of resources) {
      const path = res.path;
      const expectedHash = res.hash;
      const expectedBytes = res.bytes;

      if (typeof path !== "string" || path.length === 0) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          message: `${DATAPACKAGE_ENTRY} resource is missing or has an invalid "path"`,
          location: { entry: DATAPACKAGE_ENTRY },
          details: { resource: res },
        });
        continue;
      }

      const actualBuf = await wacz.readEntry(path);
      if (!actualBuf) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          message: `Resource "${path}" listed in ${DATAPACKAGE_ENTRY} is missing from the WACZ`,
          location: { entry: path },
        });
        continue;
      }

      const actualHash = sha256Hex(actualBuf);
      if (typeof expectedHash !== "string" || expectedHash.length === 0) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          message: `Resource "${path}" has no "hash" in ${DATAPACKAGE_ENTRY}`,
          location: { entry: path },
          details: { actual: actualHash },
        });
      } else if (expectedHash !== actualHash) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          message: `Resource "${path}" hash mismatch`,
          location: { entry: path },
          details: { expected: expectedHash, actual: actualHash },
        });
      }

      const actualBytes = actualBuf.byteLength;
      if (typeof expectedBytes === "number" && expectedBytes !== actualBytes) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          message: `Resource "${path}" byte length mismatch`,
          location: { entry: path },
          details: { expected: expectedBytes, actual: actualBytes },
        });
      }
    }

    return ok(issues);
  },
};
