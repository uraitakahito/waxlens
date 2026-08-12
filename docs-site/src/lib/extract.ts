/**
 * コードから「事実」を取り出す唯一の入口。
 *
 * waxlens の docs は他リポジトリより「コードの写し」の比率が高い。rule の
 * severity / conformance / profile ごとの上書き / spec リンクはすべて
 * `packages/core/src/validate/` に定義があり、それを手で書き写した表を
 * 日英 2 言語ぶん維持するのは現実的でない。ここで読んで注入する。
 *
 * 人が書く価値があるもの（各 rule が何を・なぜ見るか）は docs 側に残す。
 * ここが扱うのは「機械が言える事実」だけ。
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// waxlens ルート。docs-site は waxlens 直下にあり、astro dev/build は docs-site
// を cwd に実行されるので、その親がリポジトリルート。
// ※ import.meta.url は astro ビルド後の dist パスになるため使えない。
const ROOT = resolve(process.cwd(), "..");
const RULES_DIR = resolve(ROOT, "packages/core/src/validate/rules");
const RULE_DOCS = resolve(ROOT, "packages/core/src/validate/rule-docs.ts");

const read = (abs: string): string => readFileSync(abs, "utf8");

/** `key: "value"` を 1 つ取り出す。無ければ undefined。 */
const literal = (source: string, key: string): string | undefined =>
  new RegExp(String.raw`\b${key}:\s*"([^"]+)"`).exec(source)?.[1];

/** rule が依拠する spec へのリンク。`rule-docs.ts` の RULE_DOCS 由来。 */
export interface RuleLink {
  label: string;
  url: string;
}

/** 1 つの rule について、コードから機械的に言えること。 */
export interface RuleFact {
  /** `wacz/required-files` のような rule 名。docs 本文の参照もこの文字列。 */
  name: string;
  /**
   * その rule が出しうる severity の**全部**（出現順、重複除去）。
   *
   * `ValidationRule` には severity field が無い。実体は `issues.push` が
   * 書く値なので、そこから集める。1 つの rule が状況によって別の severity
   * を出すことがあり（例: `datapackage/digest` は不在なら warning、hash
   * 不一致なら error）、その場合は 2 値になる。
   */
  severities: string[];
  /** spec 上の要求レベル（MUST / SHOULD / MAY / MUST NOT）。 */
  conformance: string;
  /**
   * profile 名 → その profile で書き換わる severity の集合。
   *
   * 宣言は messageKey 単位だが、表では「その profile でどう変わるか」の
   * 概観だけ示す（messageKey 単位の詳細は rule のソースを見る）。
   * **その rule の全 issue が変わるとは限らない** ので、件数を併記する。
   */
  severityByProfile: Record<string, { levels: string[]; count: number }>;
  /**
   * profile 別の producer 版の範囲 (`profileVersions`)。
   *
   * 範囲外の版を名乗った実行では rule が走らない。表に出さないと
   * 「この rule はいつ効くのか」が rule ソースを開くまで分からない。
   */
  profileVersions: Record<string, string>;
  /** 出典リンク。未登録の rule は空配列。 */
  links: RuleLink[];
}

/**
 * `rules/*.ts` を読んで全 rule の事実を返す。
 *
 * ファイル数と `rules/index.ts` の登録数が食い違えば throw する。rule は
 * 「ファイルを作る」と「index.ts に登録する」の 2 段階で有効になり、登録忘れは
 * *その rule が黙って動かない* という最悪の失敗になる。専用テストが無ければ
 * 誰も気付かないので、docs のビルドで落とす。
 */
export function rules(): RuleFact[] {
  const docLinks = parseRuleDocs();

  const files = readdirSync(RULES_DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts");
  const facts = files.map((file): RuleFact => {
    const source = read(resolve(RULES_DIR, file));
    const name = literal(source, "name");
    const conformance = literal(source, "conformance");
    if (name === undefined || conformance === undefined) {
      throw new Error(`rules/${file}: could not read name / conformance`);
    }

    // その rule が出しうる severity。三項演算子で決まるもの（1 件だけ:
    // warc/recording-complete）があるので、行ごとに両方の枝を拾う。
    const severities = [
      ...new Set(
        [...source.matchAll(/severity:\s*([^,\n]+)/g)].flatMap(([, expr]) =>
          [...expr.matchAll(/"(error|warning|info)"/g)].map(([, level]) => level),
        ),
      ),
    ];
    if (severities.length === 0) {
      throw new Error(`rules/${file}: no severity found in issues.push`);
    }

    // profile 上書きは messageKey 単位。表向けに profile ごとへ畳む。
    const byProfile: Record<string, { levels: string[]; count: number }> = {};
    const block = /severityByProfile:\s*\{([\s\S]*?)\n {2}\},/.exec(source)?.[1];
    for (const [, profile, body] of (block ?? "").matchAll(/(\w+):\s*\{([\s\S]*?)\}/g)) {
      const levels = [...body.matchAll(/:\s*"(error|warning|info)"/g)].map(([, level]) => level);
      byProfile[profile] = { levels: [...new Set(levels)], count: levels.length };
    }

    // 版の範囲。severityByProfile と同じく profile 名で引く。
    const profileVersions: Record<string, string> = {};
    const versionBlock = /profileVersions:\s*\{([^}]*)\}/.exec(source)?.[1];
    for (const [, profile, range] of (versionBlock ?? "").matchAll(/(\w+):\s*"([^"]+)"/g)) {
      profileVersions[profile] = range;
    }

    return {
      name,
      severities,
      conformance,
      severityByProfile: byProfile,
      profileVersions,
      links: docLinks[name] ?? [],
    };
  });

  // DEFAULT_RULES の配列要素だけを数える。import 行にも `…Rule,` が並ぶので
  // ファイル全体を対象にすると二重に数えてしまう。
  const registry = read(resolve(RULES_DIR, "index.ts"));
  const array = /DEFAULT_RULES[^=]*=\s*\[([\s\S]*?)\n\];/.exec(registry)?.[1] ?? "";
  const registered = (array.match(/^\s*\w+Rule,\s*$/gm) ?? []).length;
  if (facts.length !== registered) {
    throw new Error(
      `${String(facts.length)} rule files but ${String(registered)} registered in rules/index.ts — ` +
        "a rule that is not registered never runs",
    );
  }

  return facts.sort((a, b) => a.name.localeCompare(b.name));
}

/** `rule-docs.ts` の RULE_DOCS を rule 名 → リンク群として読む。 */
function parseRuleDocs(): Record<string, RuleLink[]> {
  const source = read(RULE_DOCS);

  // 先頭の `const WACZ = "…"` 等を解決してからテンプレートリテラルを展開する。
  const bases: Record<string, string> = {};
  for (const [, id, url] of source.matchAll(/^const (\w+) = "([^"]+)";$/gm)) bases[id] = url;
  const expand = (raw: string): string =>
    raw.replace(/\$\{(\w+)\}/g, (whole, id: string) => bases[id] ?? whole);

  const body = /export const RULE_DOCS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
  const out: Record<string, RuleLink[]> = {};
  for (const [, name, entries] of body.matchAll(/"([^"]+)":\s*\[([\s\S]*?)\],?\n/g)) {
    out[name] = [...entries.matchAll(/label:\s*"([^"]+)",\s*url:\s*`?([^`",]+)`?/g)].map(
      ([, label, url]) => ({ label, url: expand(url) }),
    );
  }
  return out;
}

/**
 * `// #region <name>` … `// #endregion` で囲まれた実ソース片を返す。
 * region が見つからなければ throw = astro build が落ちる。
 *
 * 名前は行末まで一致させる。`\b` だと `-` を単語境界とみなすので、
 * `#region report` が `#region report-summary` を掴んでしまい、
 * 「トップレベル」の節に ReportSummary が出る、という形で実際に壊れていた。
 * 掴んだ側の残り (`-summary`) がコード片の 1 行目として描画されるため、
 * 症状は「謎のハイフン」に見えて原因から遠い。
 */
export function sourceRegion(file: string, region: string): string {
  // 名前は正規表現ではなくリテラルとして扱う。
  const name = region.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const re = new RegExp(String.raw`//\s*#region\s+${name}[ \t]*\r?\n([\s\S]*?)//\s*#endregion`);
  const m = re.exec(read(resolve(ROOT, file)));
  if (!m) throw new Error(`region '${region}' not found in ${file}`);
  return m[1].replace(/^\n/, "").replace(/\s+$/, "");
}
