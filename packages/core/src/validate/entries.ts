/**
 * `Report.entries` の収集(best-effort)。
 *
 * 「期待されるファイル集合」を **実在 ∪ datapackage 宣言 ∪ §5.2 MUST** の
 * 和として作り、各 path に
 *   - present: ZIP に実在するか
 *   - expectedBy: なぜ「あるべき」か(datapackage 宣言 / §5.2 MUST)
 *   - getEntryMeta() の size / 圧縮方式(present のみ)
 *   - その path を `location.entry` に持つ issue
 * を紐付けた flat なリストを返す。renderer (tui) がこれを §5.1 風の
 * ディレクトリツリーへ組み直す。
 *
 * 期待されるが ZIP に無い path は `present: false` の entry として出る
 * (欠落の可視化)。これにより「datapackage 宣言済みだが無い」だけでなく
 * 「§5.2 が MUST とするのに無い(未宣言でも)」ファイルもツリーに現れる。
 * archive/ ・ indexes/ の「≥1」は特定 path が無いので、未充足のときだけ
 * ディレクトリ単位の placeholder entry を足す。
 *
 * stats.ts と同じく engine から best-effort で呼ばれる。datapackage の
 * parse は緩い `parseDatapackage` を使い、失敗しても一覧は止めない。
 */
import { datapackageOf } from "./datapackage-source.js";
import type { WaczReader } from "../wacz/reader.js";
import type { ExpectedBy, Issue, ReportEntry } from "./domain.js";
import { SPEC_REQUIRED_PATHS, hasIndex, hasWarc, sectionForSpecPath } from "./wacz-spec.js";

/** datapackage.json の `resources[].path` の集合(無ければ空)。 */
const declaredPaths = async (wacz: WaczReader): Promise<Set<string>> => {
  // 空集合を返すのは不在の言い換えではない —— 「宣言された path は 0 個」という
  // それ自体が答えなので、ここだけは undefined へ揃えない。
  const { parsed: pkg } = await datapackageOf(wacz);
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
  const names = wacz.entryNames();
  const present = new Set(names);
  const byPath = new Map<string, ReportEntry>();

  // path が「なぜ期待されるか」。datapackage 宣言 + §5.2 の特定パス。
  const expectFor = (path: string): ExpectedBy[] => {
    const by: ExpectedBy[] = [];
    if (declared.has(path)) by.push("datapackage");
    if (SPEC_REQUIRED_PATHS.includes(path)) by.push("wacz-spec");
    return by;
  };

  // 1) 実在 ∪ datapackage 宣言 ∪ §5.2 特定パス を 1 つの集合にして entry 化。
  //    present で実在を、expectedBy で「なぜ期待されるか」を持つ。
  for (const path of new Set([...names, ...declared, ...SPEC_REQUIRED_PATHS])) {
    const meta = present.has(path) ? wacz.getEntryMeta(path) : undefined;
    const expectedBy = expectFor(path);
    // wacz-spec 由来のときだけ §5.2.x を載せる(path から sectionForSpecPath が導出)。
    const expectedSection = expectedBy.includes("wacz-spec") ? sectionForSpecPath(path) : undefined;
    byPath.set(path, {
      path,
      present: present.has(path),
      // exactOptionalPropertyTypes: undefined を明示代入しないよう条件 spread。
      ...(meta && {
        uncompressedSize: meta.uncompressedSize,
        compressionMethod: meta.compressionMethod,
      }),
      expectedBy,
      ...(expectedSection !== undefined && { expectedSection }),
      issues: [],
    });
  }

  // 2) §5.2 の「ディレクトリに ≥1」(archive/ の WARC、indexes/ の index)。
  //    特定 path が無いので、未充足のときだけ dir 単位の placeholder を足す。
  if (!hasWarc(names)) {
    const expectedSection = sectionForSpecPath("archive/");
    byPath.set("archive/", {
      path: "archive/",
      present: false,
      expectedBy: ["wacz-spec"],
      ...(expectedSection !== undefined && { expectedSection }),
      issues: [],
    });
  }
  if (!hasIndex(names)) {
    const expectedSection = sectionForSpecPath("indexes/");
    byPath.set("indexes/", {
      path: "indexes/",
      present: false,
      expectedBy: ["wacz-spec"],
      ...(expectedSection !== undefined && { expectedSection }),
      issues: [],
    });
  }

  // 3) issue を path で紐付け(archive//indexes/ の placeholder にも付く)。
  for (const issue of issues) {
    const path = issue.location?.entry;
    if (path === undefined) continue;
    byPath.get(path)?.issues.push({ rule: issue.rule, severity: issue.severity });
  }

  return [...byPath.values()];
};
