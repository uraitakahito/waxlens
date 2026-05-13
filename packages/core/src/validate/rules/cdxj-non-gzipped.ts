/**
 * Rule: cdxj/index-not-gzipped
 *
 * wabac-recognition コントラクトの producer-strict バリアント。
 * producer が plain な `indexes/index.cdxj` を出すことが期待される
 * 場合、この rule は `.cdxj.gz` / `.cdx.gz` バリアント (または
 * content が gzip magic で始まる `.cdxj` ファイル) を error として
 * 表面化する。
 *
 * "wabac.js がこの index を読めない" 全般 check は
 * `cdxj/index-recognised-by-wabac` (Phase D) にある。この rule が
 * 別途残っている理由は、ペアになる `.idx` を伴わない gzip 済み
 * CDXJ を吐く producer は同様に壊れているし、plain 形を出すと
 * ドキュメント化されている producer が gzip 形を出すなら二重に
 * 壊れているからである。
 *
 * Replay engine: wabac.js の `multiwacz.ts:loadIndex` は `.cdx` /
 *       `.cdxj` を直接受け付け、`.idx` (`!meta { format:
 *       "cdxj-gzip-1.0", filename }` header 経由でペアになった
 *       `.cdx.gz`) も受け付ける。`.cdx.gz` / `.cdxj.gz` 単体は
 *       絶対に受け付けない。
 * Reference producer: browserhive/src/storage/wacz/packager.ts:46-56
 *       は plain な `indexes/index.cdxj` を commit していて、この
 *       rule の動機となる silent-skip 落とし穴がコメントに書かれて
 *       いる。
 *
 * 検出戦略:
 *   1. `indexes/index.cdxj.gz` (または任意の `.cdxj.gz` / `.cdx.gz`
 *      バリアント) があれば、それがバグ — 該当 entry 名つきで報告。
 *   2. `indexes/index.cdxj` はあるが、ファイルが gzip magic
 *      (`1f 8b`) で始まっている場合、ファイルは二重処理されている
 *      (名前は正しいが content が gzip 済み)。これも producer バグ。
 */
import { ok } from "../../result.js";
import type { Issue, ValidationRule } from "../types.js";

const EXPECTED_CDXJ = "indexes/index.cdxj";

const FORBIDDEN_GZ_SUFFIXES = [".cdxj.gz", ".cdx.gz"] as const;
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

export const cdxjNonGzippedRule: ValidationRule = {
  name: "cdxj/index-not-gzipped",
  description: `${EXPECTED_CDXJ} must not be gzipped (wabac.js silently ignores .cdxj.gz)`,
  // ベースラインを `warning` にしているのは、gzip された CDXJ が
  // spec 準拠の WACZ で `.idx` header ファイルとペアになっている
  // ケースがあるため (wabac.js の `loadIDX` 経路がこれを扱う)。
  // `browserhive` profile はより厳しく、plain な `.cdxj` を期待し
  // どんな `.gz` index も error 扱いにする。
  severity: "warning",
  applicability: {
    severityByProfile: {
      browserhive: "error",
      lenient: "info",
    },
  },

  run: async (wacz) => {
    const issues: Issue[] = [];

    for (const name of wacz.entryNames()) {
      if (FORBIDDEN_GZ_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
        issues.push({
          rule: "cdxj/index-not-gzipped",
          severity: "warning",
          message: `Entry "${name}" is a gzipped CDXJ — wabac.js does not recognise .cdxj.gz / .cdx.gz`,
          location: { entry: name },
        });
      }
    }

    const cdxjBuf = await wacz.readEntry(EXPECTED_CDXJ);
    if (cdxjBuf && cdxjBuf.length >= 2) {
      if (cdxjBuf[0] === GZIP_MAGIC_0 && cdxjBuf[1] === GZIP_MAGIC_1) {
        issues.push({
          rule: "cdxj/index-not-gzipped",
          severity: "warning",
          message: `${EXPECTED_CDXJ} starts with the gzip magic bytes — the file is named correctly but the content is compressed`,
          location: { entry: EXPECTED_CDXJ },
        });
      }
    }

    return ok(issues);
  },
};
