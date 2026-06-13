/**
 * `.idx` (compressed CDXJ secondary index) の先頭 `!meta` header parser。
 *
 * pywb / wacz-creator が出す `.idx` は 1 行目に
 *
 *   !meta { "format": "cdxj-gzip-1.0", "filename": "index.cdx.gz" }
 *
 * を持ち、`filename` が指す gzip 圧縮 CDXJ (`.cdx.gz` 等) とペアになる。
 * `format` はそのペアの中身が CDXJ であることの宣言。
 *
 * `cdxj/index-recognised-by-wabac` (ペアの存在確認) と
 * `cdxj/index-valid-data` (ペアの中身が CDXJ か) の両方が同じ header を
 * 読む必要があるため、parse をここに一本化する (DRY)。
 */

export interface IdxMeta {
  /** `!meta` の `format` field (例 `"cdxj-gzip-1.0"`)。無ければ undefined。 */
  format?: string;
  /** `!meta` の `filename` field (ペアの圧縮 index 名)。空/無しは undefined。 */
  filename?: string;
}

/**
 * `.idx` の先頭行 `!meta { ... }` を parse する。`!meta` で始まらない /
 * brace が無い / JSON 不正 / object でない場合は null。値が見つからない
 * field は undefined にする (header はあるが filename だけ無い等を区別)。
 */
export const parseIdxMeta = (text: string): IdxMeta | null => {
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
  const m = meta as Record<string, unknown>;
  // exactOptionalPropertyTypes: 値があるときだけ field を生やす(明示 undefined を避ける)。
  const out: IdxMeta = {};
  if (typeof m["format"] === "string") out.format = m["format"];
  if (typeof m["filename"] === "string" && m["filename"].length > 0) out.filename = m["filename"];
  return out;
};
