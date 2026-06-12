/**
 * Layout の右ペイン(DetailPane)が使う純関数。
 *
 * 文字列化・突合だけを担い Ink に依存しないので、そのまま単体テストできる。
 * ペインに出す情報はすべて WireReport 内にあり、ファイルのバイトは読まない。
 */
import type { ExpectedBy, WireIssue, WireReport } from "@waxlens/protocol";

/** ZIP の圧縮方式コード → 表示名(0=STORE / 8=DEFLATE / 他=?)。 */
export const codecName = (method?: number): string =>
  method === 0 ? "STORE" : method === 8 ? "DEFLATE" : "?";

/**
 * expectedBy → 「なぜ期待されるか」の一文。両方該当も表現する。
 * 空(= ZIP に実在するだけ)は "—"。
 */
export const expectedLabel = (expectedBy: ExpectedBy[]): string => {
  const parts: string[] = [];
  if (expectedBy.includes("datapackage")) parts.push("declared in datapackage");
  if (expectedBy.includes("wacz-spec")) parts.push("required by §5.2");
  return parts.length > 0 ? parts.join(", ") : "—";
};

/**
 * その path を `location.entry` に持つ issue を返す。`ReportEntry.issues` は
 * rule/severity しか持たないので、全文 message / details を出すには
 * `report.issues` 側を突合する必要がある。
 */
export const entryIssues = (report: WireReport, path: string): WireIssue[] =>
  report.issues.filter((i) => i.location?.entry === path);
