/**
 * Rule: cdxj/index-valid-data
 *
 * WACZ 1.1.1 §5.2.2 は「Index files MUST contain CDXJ data and MAY be
 * gzip compressed [PYWB-CDXJ]」と定める。この rule は index の「中身
 * そのものが CDXJ か」を司る唯一の rule で、平文・gzip の両方を見る:
 *
 *   - 平文 `indexes/*.cdxj` → そのまま `parseCdxj`
 *   - `indexes/*.cdxj.gz`   → gunzip してから `parseCdxj`(名前が CDXJ と明示)
 *   - `.idx` が `!meta.format === "cdxj-gzip-1.0"` で名指す圧縮ファイル
 *     (`.cdx.gz` 等)→ gunzip してから `parseCdxj`(`.idx` の宣言で
 *     「中身は CDXJ」と確定する。pywb / wacz-creator / webrecorder layout)
 *
 * 対象外:
 *   - 平文 `indexes/*.cdx`(`.gz` 無し)= legacy の列指向 CDX。JSON でない
 *     ので CDXJ として parse すると誤検知する。`.idx` 宣言がある `.cdx.gz`
 *     だけを CDXJ と確定して扱う。
 *   - `.idx` 本体 = sparse index の別フォーマット。存在/ペアは
 *     `cdxj/index-recognised-by-wabac` が見る。
 *
 * なぜこの rule か:
 *   parse 妥当性の検出機構は元々 `parseCdxj` の `errors`(`invalid-json`
 *   / `json-not-object` / `missing-fields` / `empty-surt-or-timestamp`)
 *   として存在していたが、唯一それを消費していた
 *   `cdxj/filename-archive-relative` は (1) ハードコードした
 *   `indexes/index.cdxj` 1 本しか見ず、(2) filename rule で parse error を
 *   併発報告し、(3) lenient で warning に降格していた。§5.2.2 の MUST は
 *   この rule に集約し、`indexes/` 配下の CDXJ(平文・gzip 問わず)全体を
 *   対象に、全 profile で `error` にする(replay-breaking なので
 *   `cdxj/index-recognised-by-wabac` と同じ扱い)。
 *
 * 報告単位:
 *   - parse できない行ごとに 1 issue(`rawLine` は parser 側で 200 字に
 *     truncate 済み)。
 *   - gzip と名乗るのに展開できない entry は `gzip-error` を 1 issue
 *     (中身を CDXJ として読めない以上 §5.2.2 違反)。
 *
 * 留意: pywb の sparse な block 単位 `.cdx.gz` は本実装では entry 全体を
 *   `gunzipSync`(単一/連結 gzip member)で展開する。`.idx` の offset で
 *   block を部分展開する厳密版は将来拡張。
 *
 * Spec: WACZ 1.1.1 §5.2.2 indexes / pywb の CDXJ format。
 */
import { gunzipSync } from "node:zlib";
import { ok } from "../../result.js";
import { parseCdxj } from "../../wacz/cdxj-parser.js";
import { parseIdxMeta } from "../../wacz/idx-parser.js";
import type { Issue, ValidationRule } from "../domain.js";

const PLAIN_RE = /^indexes\/.+\.cdxj$/; // 平文 CDXJ
const GZ_RE = /^indexes\/.+\.cdxj\.gz$/; // 明示的に gzip された CDXJ
const IDX_RE = /^indexes\/.+\.idx$/;

export const cdxjIndexValidDataRule: ValidationRule = {
  name: "cdxj/index-valid-data",
  descriptionKey: "cdxj/index-valid-data.desc",
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
    const names = wacz.entryNames();

    // 検証対象 entry 名 → gzip か。dedup のため Map(`.cdxj.gz` が直接
    // マッチかつ `.idx` 経由でも拾われる重複を 1 本化)。
    const targets = new Map<string, boolean>();
    for (const name of names) {
      if (PLAIN_RE.test(name)) targets.set(name, false);
      else if (GZ_RE.test(name)) targets.set(name, true);
    }
    // `.idx` が `cdxj-gzip-1.0` で名指す圧縮ファイル(`.cdx.gz` 等)も CDXJ。
    for (const idxName of names.filter((n) => IDX_RE.test(n))) {
      const idxBuf = await wacz.readEntry(idxName);
      if (!idxBuf) continue;
      const meta = parseIdxMeta(idxBuf.toString("utf-8"));
      if (meta?.format !== "cdxj-gzip-1.0" || !meta.filename) continue;
      // `.idx` は名前のみで参照し、ZIP は同ディレクトリ(通常 `indexes/`)
      // に置く。直接と `indexes/` 配下の両方を見る。
      for (const cand of [meta.filename, `indexes/${meta.filename}`]) {
        if (wacz.hasEntry(cand)) targets.set(cand, cand.endsWith(".gz"));
      }
    }

    for (const [name, isGzip] of targets) {
      const buf = await wacz.readEntry(name);
      if (!buf) continue;

      let text: string;
      if (isGzip) {
        try {
          text = gunzipSync(buf).toString("utf-8");
        } catch {
          // `.gz` と名乗るのに展開不能 → 中身を CDXJ として読めない = §5.2.2 違反。
          issues.push({
            rule: "cdxj/index-valid-data",
            severity: "error",
            messageKey: "cdxj/index-valid-data.gzip-error",
            params: { entry: name, section: "5.2.2" },
            location: { entry: name },
          });
          continue;
        }
      } else {
        text = buf.toString("utf-8");
      }

      for (const e of parseCdxj(text).errors) {
        issues.push({
          rule: "cdxj/index-valid-data",
          severity: "error",
          messageKey: "cdxj/index-valid-data.invalid",
          params: { entry: name, line: String(e.line), reason: e.reason, section: "5.2.2" },
          location: { entry: name, line: e.line },
          details: { rawLine: e.rawLine },
        });
      }
    }

    return ok(issues);
  },
};
