/**
 * Rule: warc/storage-store
 *
 * `archive/data.warc.gz` SHOULD be stored in the WACZ zip with method
 * STORE (compression method 0) — never DEFLATE. The inner WARC is
 * already gzipped per the WARC spec; deflating the gzip wrapper inflates
 * the file for no decompression benefit and breaks the offset/length
 * contract downstream tools rely on (the offsets in the CDXJ index point
 * into the *uncompressed* zip entry — and "uncompressed" here means
 * STORE-stored).
 *
 * Spec / convention: WACZ doesn't strictly mandate STORE, but the
 *       random-access design that justifies the format depends on it,
 *       and every reference producer (browserhive, pywb, wacz-creator)
 *       emits STORE for the WARC entry.
 * Reference producer: browserhive/src/storage/wacz/packager.ts:152-169
 *       marks `archive/data.warc.gz` as the only STORE entry; the rest
 *       are DEFLATE.
 *
 * Severity is `warning`, not `error`: a DEFLATE-stored warc.gz still
 * decompresses cleanly via standard zip readers, so replay tools that
 * read the whole entry into memory before scanning would still work. The
 * danger is for tools that seek by CDXJ offset directly into the zip's
 * raw bytes — they'd miss every record. We can't tell which class of
 * consumer is downstream, so we surface the problem rather than fail.
 */
import { ok } from "../../result.js";
import { ZIP_COMPRESSION_STORE } from "../../wacz/reader.js";
import type { Issue, ValidationRule } from "../types.js";

const WARC_ENTRY = "archive/data.warc.gz";

export const warcStorageStoreRule: ValidationRule = {
  name: "warc/storage-store",
  description: `${WARC_ENTRY} must be stored with method STORE (0), not DEFLATE`,
  severity: "warning",
  applicability: {
    severityByProfile: { lenient: "info" },
  },

  run: async (wacz) => {
    const issues: Issue[] = [];
    await Promise.resolve(); // satisfy lint: async function with no await
    const meta = wacz.getEntryMeta(WARC_ENTRY);
    if (!meta) {
      // The WARC is missing entirely — other rules (resource-hashes,
      // members-independent) will surface this with more context. We
      // stay silent here to avoid duplicate noise.
      return ok(issues);
    }

    if (meta.compressionMethod !== ZIP_COMPRESSION_STORE) {
      issues.push({
        rule: "warc/storage-store",
        severity: "warning",
        message: `${WARC_ENTRY} is zip-compressed (method ${String(meta.compressionMethod)}) — should be STORE (0) so CDXJ offsets seek correctly`,
        location: { entry: WARC_ENTRY },
        details: {
          expected: ZIP_COMPRESSION_STORE,
          actual: meta.compressionMethod,
          compressedSize: meta.compressedSize,
          uncompressedSize: meta.uncompressedSize,
        },
      });
    }

    return ok(issues);
  },
};
