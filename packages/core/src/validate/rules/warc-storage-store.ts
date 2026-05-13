/**
 * Rule: warc/storage-store
 *
 * `archive/data.warc.gz` は WACZ zip の中で STORE 方式 (compression
 * method 0) で格納すべきで、DEFLATE では駄目。WARC spec に従って
 * 内側の WARC はすでに gzip 圧縮されているので、その gzip wrapper
 * を更に deflate してもサイズが膨らむだけで展開メリットがなく、
 * downstream ツールが依存する offset / length コントラクトを壊す
 * (CDXJ index の offset は *uncompressed* な zip entry を指していて、
 * ここでの "uncompressed" は STORE 格納を意味する)。
 *
 * Spec / 慣習: WACZ は厳密には STORE を mandate しないが、フォーマット
 *       の存在理由である random-access 設計が STORE に依存しており、
 *       参考実装 (browserhive、pywb、wacz-creator) はすべて WARC
 *       entry を STORE で出す。
 * Reference producer: browserhive/src/storage/wacz/packager.ts:152-169
 *       は `archive/data.warc.gz` を唯一の STORE entry にして、それ
 *       以外は DEFLATE。
 *
 * Severity は `error` ではなく `warning`: DEFLATE で格納された
 * warc.gz でも標準的な zip reader で問題なく解凍できるので、entry
 * 全体をメモリに読んでから scan する replay ツールは動く。問題は、
 * CDXJ offset で zip の raw bytes に直接 seek するツールにとってで、
 * 全 record を miss する。downstream consumer がどちらのクラスかは
 * 判定できないので、抑止するのではなく表面化する側に倒している。
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
      // WARC が完全に欠落 — 他 rule (resource-hashes、
      // members-independent) がより rich な context で表面化する。
      // 重複ノイズを避けるためここは silent にしておく。
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
