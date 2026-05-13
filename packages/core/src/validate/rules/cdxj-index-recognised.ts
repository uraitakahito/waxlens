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
 *   - `.idx` はあるが `!meta.filename` が zip に存在しない → warning
 *     (`.idx` 自体はロードされるが、lookup が miss する)。
 *
 * "index 欠落" 分岐の severity は全 profile で `error` — 読めない
 * index は producer に依存せず replay-breaking なバグだから。
 */
import { ok } from "../../result.js";
import type { Issue, ValidationRule } from "../types.js";

const INDEXES_PREFIX = "indexes/";
const ACCEPTED_SUFFIXES = [".cdx", ".cdxj", ".idx"] as const;

/**
 * `.idx` の先頭行を読み、pywb / wacz-creator が emit する
 * `!meta { format, filename }` header から `filename` field を取り
 * 出す。header が無い / 壊れている場合は null を返し、呼び出し側は
 * これを "ペア未宣言" として扱う。
 */
const parseIdxPairFilename = (text: string): string | null => {
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (!firstLine.startsWith("!meta")) return null;
  const braceIdx = firstLine.indexOf("{");
  if (braceIdx < 0) return null;
  let meta: unknown;
  try {
    meta = JSON.parse(firstLine.slice(braceIdx));
  } catch {
    return null;
  }
  if (typeof meta !== "object" || meta === null) return null;
  const filename = (meta as Record<string, unknown>)["filename"];
  return typeof filename === "string" && filename.length > 0 ? filename : null;
};

export const cdxjIndexRecognisedRule: ValidationRule = {
  name: "cdxj/index-recognised-by-wabac",
  description: `WACZ must contain a wabac-recognised index (${ACCEPTED_SUFFIXES.join(" / ")})`,
  severity: "error",

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
        message:
          "No wabac-recognised index file found under indexes/ — wabac.js needs at least one .cdx / .cdxj / .idx entry to serve any URL",
        location: { entry: INDEXES_PREFIX },
        details: {
          acceptedSuffixes: ACCEPTED_SUFFIXES,
          allIndexEntries: wacz.entryNames().filter((name) => name.startsWith(INDEXES_PREFIX)),
        },
      });
      return ok(issues);
    }

    // すべての `.idx` entry について、`!meta.filename` のペアが zip
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
      // `.idx` は CDXJ ペアを名前のみで参照していて、zip は同じ
      // ディレクトリ (通常 `indexes/`) に保存している。直接と
      // `indexes/` 配下の両方を見る。
      const candidates = [pair, `${INDEXES_PREFIX}${pair}`];
      const found = candidates.some((p) => wacz.hasEntry(p));
      if (!found) {
        issues.push({
          rule: "cdxj/index-recognised-by-wabac",
          severity: "warning",
          message: `${name} references "${pair}" but no such entry exists in the WACZ`,
          location: { entry: name },
          details: { idxFile: name, claimedPair: pair, candidatesChecked: candidates },
        });
      }
    }

    return ok(issues);
  },
};
