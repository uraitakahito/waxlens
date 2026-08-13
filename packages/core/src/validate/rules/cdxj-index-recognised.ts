/**
 * Rule: cdxj/index-recognised-by-wabac
 *
 * WACZ は、wabac.js の `multiwacz.ts:loadIndex` が認識する index
 * ファイルを少なくとも 1 つ持つ必要がある。当該 loader は次の 3 つの
 * suffix を hard-code している:
 *
 *   - `.cdx`  / `.cdxj`   — `loadCDX` で直接ロード
 *   - `.idx`              — `loadIDX` でロード。最初の行に
 *                           `!meta { format: "cdxj-gzip-1.0",
 *                           filename: <file> }` が必要で、その
 *                           `filename` が指す圧縮 CDXJ とペアになる
 *
 * それ以外 (`.idx` のペアが無い裸の `.cdx.gz` / `.cdxj.gz`) は
 * wabac.js に silent に skip されるので、replay が index を得られず
 * すべての URL lookup が "Archived Page Not Found" を返す。
 *
 * Replay engine: wabac.js
 *   https://github.com/webrecorder/wabac.js/blob/main/src/wacz/multiwacz.ts
 *   `loadIndex` ~465 行目: `if (filename.endsWith(".cdx") ||
 *   filename.endsWith(".cdxj"))`、~471 行目: `else if (filename.endsWith(".idx"))`。
 *
 * 何を報告するか:
 *   - WACZ 内に認識可能な index ファイルが無い → error。
 *   - `.idx` はあるが `!meta.filename` が ZIP に存在しない → warning
 *     (`.idx` 自体はロードされるが、lookup が miss する)。
 *
 * "index 欠落" 分岐の severity は全 profile で `error` — 読めない
 * index は producer に依存せず replay-breaking なバグだから。
 */
import { ok } from "../../result.js";
import { parseIdxMeta } from "../../wacz/idx-parser.js";
import type { Issue, ValidationRule } from "../domain.js";

const INDEXES_PREFIX = "indexes/";
const ACCEPTED_SUFFIXES = [".cdx", ".cdxj", ".idx"] as const;

/**
 * `.idx` の先頭 `!meta { format, filename }` header から `filename` を
 * 取り出す (header 無し / 壊れ / filename 無しは null = "ペア未宣言")。
 * header parse 自体は {@link parseIdxMeta} に一本化している。
 */
const parseIdxPairFilename = (text: string): string | null =>
  parseIdxMeta(text)?.filename ?? null;

export const cdxjIndexRecognisedRule: ValidationRule = {
  name: "cdxj/index-recognised-by-wabac",
  descriptionKey: "cdxj/index-recognised-by-wabac.desc",
  conformance: "MUST",
  docs: [
      {
        label: "WACZ §indexes",
        url: {
          en: "https://specs.webrecorder.net/wacz/1.1.1/#indexes",
          ja: "https://uraitakahito.github.io/specs/wacz/1.1.1/#indexes",
        },
      },
  ],

  run: async (wacz) => {
    const issues: Issue[] = [];

    const indexEntries = wacz
      .entryNames()
      .filter((name) => name.startsWith(INDEXES_PREFIX))
      .filter((name) => ACCEPTED_SUFFIXES.some((s) => name.endsWith(s)));

    if (indexEntries.length === 0) {
      issues.push({
        rule: "cdxj/index-recognised-by-wabac",
        severity: "error",
        messageKey: "cdxj/index-recognised-by-wabac.no-index",
        location: { entry: INDEXES_PREFIX },
        details: {
          acceptedSuffixes: ACCEPTED_SUFFIXES,
          allIndexEntries: wacz.entryNames().filter((name) => name.startsWith(INDEXES_PREFIX)),
        },
      });
      return ok(issues);
    }

    // すべての `.idx` entry について、`!meta.filename` のペアが ZIP
    // に存在するかを確認する。ペアが壊れていると wabac.js は `.idx`
    // 自体は見えるが、圧縮 CDXJ が無いのですべての lookup が miss
    // する。
    for (const name of indexEntries) {
      if (!name.endsWith(".idx")) continue;
      const buf = await wacz.readEntry(name);
      if (!buf) continue;
      const pair = parseIdxPairFilename(buf.toString("utf-8"));
      if (pair === null) continue; // header claim 無し; lookup は動かないが
      //                              プロジェクトの早い段階で別個の
      //                              "no claim" diagnostic を出すのは
      //                              かえって混乱するので silent にする。
      // `.idx` は CDXJ ペアを名前のみで参照していて、ZIP は同じ
      // ディレクトリ (通常 `indexes/`) に保存している。直接と
      // `indexes/` 配下の両方を見る。
      const candidates = [pair, `${INDEXES_PREFIX}${pair}`];
      const found = candidates.some((p) => wacz.hasEntry(p));
      if (!found) {
        issues.push({
          rule: "cdxj/index-recognised-by-wabac",
          severity: "warning",
          messageKey: "cdxj/index-recognised-by-wabac.missing-pair",
          params: { name, pair },
          location: { entry: name },
          details: { idxFile: name, claimedPair: pair, candidatesChecked: candidates },
        });
      }
    }

    return ok(issues);
  },
};
