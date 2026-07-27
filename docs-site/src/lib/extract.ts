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
  /** 既定の severity。profile で上書きされることがある（下記）。 */
  severity: string;
  /** spec 上の要求レベル（MUST / SHOULD / MAY / MUST NOT）。 */
  conformance: string;
  /** profile 名 → その profile での severity。空なら全 profile で既定どおり。 */
  severityByProfile: Record<string, string>;
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
    const severity = literal(source, "severity");
    const conformance = literal(source, "conformance");
    if (name === undefined || severity === undefined || conformance === undefined) {
      throw new Error(`rules/${file}: could not read name / severity / conformance`);
    }

    const byProfile: Record<string, string> = {};
    const block = /severityByProfile:\s*\{([^}]*)\}/.exec(source)?.[1];
    for (const [, profile, level] of (block ?? "").matchAll(/(\w+):\s*"([^"]+)"/g)) {
      byProfile[profile] = level;
    }

    return { name, severity, conformance, severityByProfile: byProfile, links: docLinks[name] ?? [] };
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
 */
export function sourceRegion(file: string, region: string): string {
  const re = new RegExp(String.raw`//\s*#region\s+${region}\b([\s\S]*?)//\s*#endregion`);
  const m = re.exec(read(resolve(ROOT, file)));
  if (!m) throw new Error(`region '${region}' not found in ${file}`);
  return m[1].replace(/^\n/, "").replace(/\s+$/, "");
}
