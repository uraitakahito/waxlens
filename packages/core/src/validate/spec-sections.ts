/**
 * WACZ 1.1.1 spec のセクション番号 → ドキュメント URL(アンカー)の唯一の対応表。
 *
 * issue が運ぶ `params.section`(例 `"5.2.1"`)から、開発者が該当 spec へ
 * すぐ飛べるよう URL を解決する。URL のハードコードはこの 1 ファイルに集約する。
 *
 * アンカーは spec ページ(https://specs.webrecorder.net/wacz/1.1.1/)の見出し
 * slug 規約に従う(見出し語を小文字化、`.` は `-` に)。`#archive` は確認済み、
 * `#datapackage-json` / `#directories-and-files` は既存 rule コメントに既出。
 */
const BASE = "https://specs.webrecorder.net/wacz/1.1.1/";

export const SPEC_SECTIONS: Record<string, string> = {
  "5.2": `${BASE}#directories-and-files`,
  "5.2.1": `${BASE}#archive`,
  "5.2.2": `${BASE}#indexes`,
  "5.2.3": `${BASE}#pages`,
  "5.2.4": `${BASE}#datapackage-json`,
  "5.2.5": `${BASE}#datapackage-digest-json`,
};

/**
 * section 番号 → spec URL。`params.section` は `string | number | undefined` を
 * 取りうるので寛容に受け、未知 / 未指定は `undefined`(URL 行を出さない)。
 */
export const specUrl = (section: string | number | undefined): string | undefined =>
  section == null ? undefined : SPEC_SECTIONS[String(section)];
