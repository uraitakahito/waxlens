/**
 * `Report.entries` の収集(best-effort)。
 *
 * WACZ(zip)の実エントリを列挙し、各 file に
 *   - getEntryMeta() の size / 圧縮方式
 *   - datapackage.json が宣言しているか (resources[].path)
 *   - その path を `location.entry` に持つ issue
 * を紐付けた flat なリストを返す。renderer (tui) がこれを §5.1 風の
 * ディレクトリツリーへ組み直す。
 *
 * datapackage が宣言しているが zip に無い path は `present: false` の
 * entry として加える(declared-but-missing の可視化)。location.entry が
 * どの entry にも一致しない issue(例: datapackage.json 自体の欠落)は
 * Layout には出さない — Issues ビュー側で従来どおり見える。
 *
 * stats.ts と同じく engine から best-effort で呼ばれる。datapackage の
 * parse は緩い `parseDatapackage` を使い、失敗しても一覧は止めない。
 */
import { parseDatapackage } from "../wacz/datapackage.js";
import type { WaczReader } from "../wacz/reader.js";
import type { Issue, ReportEntry } from "./domain.js";

const DATAPACKAGE_ENTRY = "datapackage.json";

/** datapackage.json の `resources[].path` の集合(無ければ空)。 */
const declaredPaths = async (wacz: WaczReader): Promise<Set<string>> => {
  const buf = await wacz.readEntry(DATAPACKAGE_ENTRY);
  if (!buf) return new Set();
  const pkg = parseDatapackage(buf.toString("utf-8"));
  const paths = new Set<string>();
  for (const resource of pkg?.resources ?? []) {
    if (typeof resource.path === "string") paths.add(resource.path);
  }
  return paths;
};

export const buildEntries = async (
  wacz: WaczReader,
  issues: readonly Issue[],
): Promise<ReportEntry[]> => {
  const declared = await declaredPaths(wacz);
  const byPath = new Map<string, ReportEntry>();

  // 1) zip の実エントリ
  for (const path of wacz.entryNames()) {
    const meta = wacz.getEntryMeta(path);
    byPath.set(path, {
      path,
      present: true,
      // exactOptionalPropertyTypes: undefined を明示代入しないよう条件 spread。
      ...(meta && {
        uncompressedSize: meta.uncompressedSize,
        compressionMethod: meta.compressionMethod,
      }),
      declaredInDatapackage: declared.has(path),
      issues: [],
    });
  }

  // 2) datapackage が宣言するが zip に無い path(declared-but-missing)
  for (const path of declared) {
    if (!byPath.has(path)) {
      byPath.set(path, {
        path,
        present: false,
        declaredInDatapackage: true,
        issues: [],
      });
    }
  }

  // 3) issue を path で紐付け
  for (const issue of issues) {
    const path = issue.location?.entry;
    if (path === undefined) continue;
    byPath.get(path)?.issues.push({ rule: issue.rule, severity: issue.severity });
  }

  return [...byPath.values()];
};
