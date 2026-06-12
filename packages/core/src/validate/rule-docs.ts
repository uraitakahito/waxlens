/**
 * rule 名 → 出典(公式ドキュメント)リンクの唯一の対応表。
 *
 * issue を展開したとき、その rule が依拠する spec へすぐ飛べるよう URL を解決する。
 * `conformanceForRule`(rule 名 → MUST/SHOULD)と同じく **rule 名キー** で引くので、
 * `params.section` の有無に依存せず全 rule をカバーできる。1 rule が複数 spec を
 * 跨ぐ場合(例 frictionless-structure は Data Package と Data Resource の両方が根拠)は
 * ラベル付きで複数返す。URL のハードコードはこの 1 ファイルに集約する。
 *
 * - WACZ アンカーは {@link SPEC_SECTIONS} と同じ slug 規約(見出し語を小文字化、`.`→`-`)。
 * - Frictionless v1: https://specs.frictionlessdata.io/
 * - WARC 1.1: IIPC の HTML 版。
 */
const WACZ = "https://specs.webrecorder.net/wacz/1.1.1/";
const FD = "https://specs.frictionlessdata.io/";
const WARC11 = "https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/";

/** issue 1 件に紐づく出典リンク。`label` は人間可読、`url` は権威ある spec。 */
export interface DocLink {
  label: string;
  url: string;
}

/** rule 名 → 出典リンク群。未登録 rule は `undefined`(リンクを出さない)。 */
export const RULE_DOCS: Record<string, readonly DocLink[]> = {
  "wacz/required-files": [{ label: "WACZ §directories-and-files", url: `${WACZ}#directories-and-files` }],
  "wacz/reserved-dirs-clean": [
    { label: "WACZ §directories-and-files", url: `${WACZ}#directories-and-files` },
  ],
  "datapackage/profile-required": [
    { label: "WACZ §datapackage.json", url: `${WACZ}#datapackage-json` },
    { label: "Frictionless Data Package", url: `${FD}data-package/` },
  ],
  "datapackage/wacz-version-required": [
    { label: "WACZ §datapackage.json", url: `${WACZ}#datapackage-json` },
  ],
  "datapackage/resource-hashes": [
    { label: "WACZ §datapackage.json", url: `${WACZ}#datapackage-json` },
    { label: "Frictionless Data Resource", url: `${FD}data-resource/` },
  ],
  "datapackage/frictionless-schema": [
    { label: "Frictionless Data Package", url: `${FD}data-package/` },
  ],
  "datapackage/frictionless-structure": [
    { label: "Frictionless Data Package §required", url: `${FD}data-package/#required-properties` },
    { label: "Frictionless Data Resource", url: `${FD}data-resource/` },
  ],
  "datapackage/digest": [
    { label: "WACZ §datapackage-digest.json", url: `${WACZ}#datapackage-digest-json` },
  ],
  "datapackage/resources-complete": [
    { label: "WACZ §datapackage.json", url: `${WACZ}#datapackage-json` },
  ],
  "pages/page-schema": [{ label: "WACZ §pages", url: `${WACZ}#pages` }],
  "cdxj/index-recognised-by-wabac": [{ label: "WACZ §indexes", url: `${WACZ}#indexes` }],
  "cdxj/index-not-gzipped": [{ label: "WACZ §indexes", url: `${WACZ}#indexes` }],
  "cdxj/filename-archive-relative": [{ label: "WACZ §indexes", url: `${WACZ}#indexes` }],
  "cdxj/warc-offsets": [{ label: "WACZ §indexes", url: `${WACZ}#indexes` }],
  "cdxj/pages-mainpage": [{ label: "WACZ §pages", url: `${WACZ}#pages` }],
  "warc/extension-gzip-match": [{ label: "WACZ §archive", url: `${WACZ}#archive` }],
  "warc/storage-store": [{ label: "WACZ §archive", url: `${WACZ}#archive` }],
  "warc/members-independent": [{ label: "WARC 1.1", url: WARC11 }],
  "warc/payload-digest": [{ label: "WARC 1.1", url: WARC11 }],
  "fuzzy/valid-json": [{ label: "WACZ §fuzzy.json", url: `${WACZ}#fuzzy-json` }],
};

/** rule 名から出典リンク群を引く。未知 / 未登録は `undefined`。 */
export const docsForRule = (rule: string): readonly DocLink[] | undefined => RULE_DOCS[rule];
