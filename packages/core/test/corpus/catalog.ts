/**
 * waxlens-corpus の `manifest.json` を docs 用の Markdown カタログに変換する
 * 純粋関数群 (副作用なし)。
 *
 * `manifest.json` は build-corpus が **実 runValidation 出力**から書く単一
 * 真実源なので、ここから一方向に派生させれば docs は corpus の実挙動と
 * 必ず一致する (手書きの期待結果ゼロ)。ファイル I/O や `CORPUS_DIR` 解決は
 * 呼び出し側 (build-docs.test.ts) の責務で、この module は文字列 in / 文字列
 * out に徹する — おかげで CORPUS_DIR 不在でも `catalog.test.ts` が常時
 * exercise できる。
 */

import { ALL_PROFILES } from "@waxlens/contract";
import type { FixtureEntry, Manifest, ProfileResult } from "./manifest.js";

// 既存の import 元 (build-docs.test.ts / catalog.test.ts) を壊さないよう、
// manifest の型はここから通す。catalog 自体は引き続き「manifest を docs に
// する」だけを担う。
export type { FixtureEntry, Manifest, ProfileResult };

/** profile 差テーブルの列順。持ち主は @waxlens/contract。 */
const PROFILES = ALL_PROFILES;

/**
 * カタログは docs site の en / ja 両方へ注入する。表の中身 (fixture 名・rule 名・
 * severity) は言語非依存なので、切り替わるのは見出しと列名だけ。
 */
export type CatalogLang = "en" | "ja";

const HEADS: Record<CatalogLang, { main: string[]; profile: string[] }> = {
  ja: {
    main: [
      "### 全標本(`spec` profile)",
      "",
      "| fixture | 説明 | `$schema` | `spec` の発火 rule | exit |",
      "| --- | --- | --- | --- | --- |",
    ],
    profile: [
      "### profile で severity が変わる標本",
      "",
      "| fixture | rule | spec | browserhive | lenient |",
      "| --- | --- | --- | --- | --- |",
    ],
  },
  en: {
    main: [
      "### Every specimen (`spec` profile)",
      "",
      "| fixture | description | `$schema` | rules fired under `spec` | exit |",
      "| --- | --- | --- | --- | --- |",
    ],
    profile: [
      "### Specimens whose severity changes by profile",
      "",
      "| fixture | rule | spec | browserhive | lenient |",
      "| --- | --- | --- | --- | --- |",
    ],
  },
};

const base = (file: string): string => file.replace(/^fixtures\//, "");

/** Markdown 表セルを壊す `|` を無害化する (現 manifest には無いが防御的)。 */
const cell = (text: string): string => text.replace(/\|/g, "\\|");

/** fixture の `spec` profile 結果。単一 `expect` か `byProfile.spec` を採る。 */
const specOf = (entry: FixtureEntry): ProfileResult => {
  const result = entry.expect ?? entry.byProfile?.["spec"];
  if (result === undefined) {
    throw new Error(`${entry.file}: manifest entry に expect も byProfile.spec も無い`);
  }
  return result;
};

/**
 * 標本が宣言する `$schema`。宣言が無ければ `—`。
 *
 * `=== null` ではなく `typeof === "string"` で判定する — 記録前の古い manifest
 * を渡されたときに来る `undefined` を、`undefined` という文字列としてレンダリング
 * してはならない。
 */
const declaredSchema = (entry: FixtureEntry): string =>
  typeof entry.$schema === "string" ? `\`${cell(entry.$schema)}\`` : "—";

/** 発火 rule を `\`rule\` (severity)` の列に。同一 rule は 1 度だけ (dedup)。 */
const firedRules = (result: ProfileResult): string => {
  const bySeverity = new Map<string, string>();
  for (const issue of result.issues) {
    if (!bySeverity.has(issue.rule)) bySeverity.set(issue.rule, issue.severity);
  }
  if (bySeverity.size === 0) return "—";
  return [...bySeverity].map(([rule, severity]) => `\`${rule}\` (${severity})`).join(", ");
};

/** ある profile での rule の severity。発火しなければ `—`。 */
const severityIn = (result: ProfileResult | undefined, rule: string): string =>
  result?.issues.find((issue) => issue.rule === rule)?.severity ?? "—";

/** byProfile の 3 profile に現れる rule 名の和集合 (出現順)。 */
const ruleUnion = (byProfile: Record<string, ProfileResult>): string[] => {
  const rules = new Set<string>();
  for (const profile of PROFILES) {
    for (const issue of byProfile[profile]?.issues ?? []) rules.add(issue.rule);
  }
  return [...rules];
};

/**
 * manifest を 2 つの Markdown 表に変換する:
 *   1. 全標本 — `spec` profile の発火 rule と exit code (valid=false → 1)
 *   2. profile で severity が変わる標本 — rule ごとの spec/browserhive/lenient
 * 返り値はマーカー間に挿入する **本文のみ** (マーカー自体は injectCatalog が保持)。
 */
export const renderCatalog = (manifest: Manifest, lang: CatalogLang = "ja"): string => {
  const { main: MAIN_HEAD, profile: PROFILE_HEAD } = HEADS[lang];
  const mainRows = manifest.fixtures.map((entry) => {
    const spec = specOf(entry);
    const exit = spec.valid ? 0 : 1;
    return (
      `| \`${base(entry.file)}\` | ${cell(entry.description)} | ` +
      `${declaredSchema(entry)} | ${firedRules(spec)} | ${String(exit)} |`
    );
  });

  const profileRows: string[] = [];
  for (const entry of manifest.fixtures) {
    const { byProfile } = entry;
    if (byProfile === undefined) continue;
    for (const rule of ruleUnion(byProfile)) {
      const cells = PROFILES.map((profile) => severityIn(byProfile[profile], rule));
      profileRows.push(`| \`${base(entry.file)}\` | \`${rule}\` | ${cells.join(" | ")} |`);
    }
  }

  return [...MAIN_HEAD, ...mainRows, "", ...PROFILE_HEAD, ...profileRows].join("\n");
};

const BEGIN = "<!-- BEGIN corpus-catalog";
const END = "<!-- END corpus-catalog -->";

/**
 * 対象ページのマーカー間だけを `body` で差し替える。BEGIN コメント
 * 行 (末尾の "do not edit" 注記を含む) と END マーカーは温存するので、
 * 同じ入力からは冪等。マーカーが無ければ silent 上書きせず throw する。
 */
export const injectCatalog = (doc: string, body: string): string => {
  const begin = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);
  if (begin < 0 || end < 0) {
    throw new Error("対象ページに corpus-catalog マーカー (BEGIN/END) が無い");
  }
  const beginClose = doc.indexOf("-->", begin);
  if (beginClose < 0 || beginClose > end) {
    throw new Error("corpus-catalog の BEGIN マーカーが閉じていない");
  }
  return `${doc.slice(0, beginClose + 3)}\n\n${body}\n\n${doc.slice(end)}`;
};
