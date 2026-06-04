/**
 * WACZ 1.1.1 §5.2 (Directories and Files) が MUST とする構造の単一定義。
 *
 * `wacz/required-files` ルール(存在チェック)と `buildEntries`(Layout の
 * ファイル一覧)が **同じ真実** を共用するためにここへ集約する。正規表現や
 * 必須 path を二重に持つと片方だけ直して不整合になりがちなので、定義は 1 つ。
 *
 * §5.2.5 datapackage-digest.json は SHOULD なので含めない。
 *
 * Spec: https://specs.webrecorder.net/wacz/1.1.1/#directories-and-files
 */

/** §5.2.1 archive/ が含むべき WARC(*.warc / *.warc.gz)。 */
export const WARC_RE = /^archive\/.+\.warc(\.gz)?$/;
/** §5.2.2 indexes/ が含むべき index(*.cdx / *.cdxj / *.idx, gzip 可)。 */
export const INDEX_RE = /^indexes\/.+\.(cdx|cdxj|idx)(\.gz)?$/;

/**
 * §5.2 が「特定 path」で MUST とするファイル。
 *   - §5.2.4 datapackage.json(root)
 *   - §5.2.3 pages/pages.jsonl
 * archive/ ・ indexes/ は「特定 path」ではなく「≥1 のいずれか」なので
 * ここではなく {@link hasWarc} / {@link hasIndex} で扱う。
 */
export const SPEC_REQUIRED_PATHS: readonly string[] = ["datapackage.json", "pages/pages.jsonl"];

/** archive/ に WARC が 1 つ以上あるか(§5.2.1)。 */
export const hasWarc = (names: readonly string[]): boolean => names.some((n) => WARC_RE.test(n));
/** indexes/ に index が 1 つ以上あるか(§5.2.2)。 */
export const hasIndex = (names: readonly string[]): boolean => names.some((n) => INDEX_RE.test(n));
