/**
 * 最小の semver 実装。
 *
 * **`semver` パッケージは入れない。** この package の存在理由は「何も
 * import しない」ことで、それが `@waxlens/protocol` 経由で browser に
 * validation engine を引き込まない保証になっている。依存を 1 つでも
 * 足せばその保証が消える。
 *
 * 解する範囲式は意図的に小さい部分集合だけ:
 *
 *   ">=1.11.0"        以上
 *   ">1.11.0"         より大きい
 *   "<2.0.0"          未満
 *   "<=2.0.0"         以下
 *   ">=1.11.0 <2.0.0" 空白区切りは AND
 *
 * caret (`^1.2.3`) / tilde (`~1.2.3`) / OR (`||`) は**解さない**。
 * 必要なのは「このバージョン以降で正しい」を言うことだけで、それ以上の表現力は
 * 曖昧さを増やすだけだから。
 *
 * 解せない式は throw する。false を返して黙らないのは、書き間違いが
 * 「範囲外」に化けて rule が静かに消えるほうが危険だから — 起動時に
 * 大きな音で落ちるほうがましである。
 */

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * `1.11.0` 形式だけを受ける。prerelease / build metadata は受けない —
 * producer のバージョンとして比較したいのは 3 つ組だけで、`2.1.0-rc.1` を
 * どう順序づけるかを決める必要が今は無い。
 */
export const parseSemVer = (raw: string): SemVer | null => {
  const m = SEMVER_RE.exec(raw.trim());
  if (m === null) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
};

export const formatSemVer = (v: SemVer): string =>
  [v.major, v.minor, v.patch].join(".");

/** 辞書順の 3 つ組比較。a < b なら負。 */
const compare = (a: SemVer, b: SemVer): number =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch;

const COMPARATOR_RE = /^(>=|<=|>|<)(\d+\.\d+\.\d+)$/;

/**
 * `version` が `range` を満たすか。
 *
 * @throws 範囲式が上記の部分集合で表せない場合。呼び出し側 (rule の
 *   宣言) は起動時に一度しか評価しないので、書き間違いはその場で露見する。
 */
export const satisfies = (version: SemVer, range: string): boolean => {
  const terms = range.trim().split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) {
    throw new Error(`空の範囲式: ${JSON.stringify(range)}`);
  }
  return terms.every((term) => {
    const m = COMPARATOR_RE.exec(term);
    if (m === null) {
      throw new Error(
        `解せない範囲式: ${JSON.stringify(term)}。` +
          `使えるのは >= / > / <= / < と x.y.z、および空白区切りの AND のみ。`,
      );
    }
    const bound = parseSemVer(m[2] ?? "");
    // COMPARATOR_RE が \d+\.\d+\.\d+ を要求しているので parse は必ず通る。
    if (bound === null) throw new Error(`解せないバージョン: ${JSON.stringify(term)}`);
    const c = compare(version, bound);
    switch (m[1]) {
      case ">=":
        return c >= 0;
      case ">":
        return c > 0;
      case "<=":
        return c <= 0;
      default:
        return c < 0;
    }
  });
};
