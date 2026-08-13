/**
 * rule profile と、その選択子。
 *
 * profile 名は 3 値の閉じた enum のまま。**バージョンは enum に混ぜない** —
 * `browserhive@2.1.0` を enum の値にすると組み合わせが無限に増え、
 * 「宣言されていない profile は型エラー」という性質が失われる。バージョンは
 * {@link ProfileSelector} の別フィールドとして持つ。
 */
import { formatSemVer, parseSemVer, type SemVer } from "./version.js";

/**
 * 選べる rule profile の全体。順序は CLI のヘルプ表示にそのまま出る。
 *
 * 増やすときはここだけを触る — core も protocol も re-export しているので、
 * 両方の CLI が同時に追随する。
 */
export const ALL_PROFILES = ["spec", "browserhive", "lenient"] as const;
export type RuleProfile = (typeof ALL_PROFILES)[number];

export const DEFAULT_PROFILE: RuleProfile = "spec";

/**
 * `--profile` の値。`<name>` または `<name>@<version>`。
 *
 * ここでいうバージョンは **producer のもの**であって waxlens のではない。
 * `browserhive@2.1.0` は「この archive は BrowserHive 2.1.0 が作ったものとして
 * 扱え」の意。
 *
 * `version` が無いとき、バージョンに条件を持つ rule は**条件を見ずに走る**。
 * 既定を「バージョンを問わない」に置いているので、バージョンを書かない従来の
 * 呼び出しは挙動が変わらない。
 */
export interface ProfileSelector {
  readonly name: RuleProfile;
  readonly version?: SemVer;
}

export const DEFAULT_SELECTOR: ProfileSelector = { name: DEFAULT_PROFILE };

const isProfileName = (raw: string): raw is RuleProfile =>
  (ALL_PROFILES as readonly string[]).includes(raw);

/**
 * `"browserhive@2.1.0"` → `{ name, version }`。
 *
 * 不正な入力は `null`。呼び出し側 (CLI / daemon) が自前の文言でエラーに
 * するので、ここでは理由を区別しない — profile 名が違うのかバージョンが違うのかは
 * 利用者にとって同じ「その profile は無い」であり、両方を並べて見せるのが
 * 分かりやすい。
 */
export const parseProfileSelector = (raw: string): ProfileSelector | null => {
  const at = raw.indexOf("@");
  if (at < 0) return isProfileName(raw) ? { name: raw } : null;

  const name = raw.slice(0, at);
  if (!isProfileName(name)) return null;
  const version = parseSemVer(raw.slice(at + 1));
  return version === null ? null : { name, version };
};

/**
 * parse の逆。バージョンが無ければ profile 名そのものを返す — だからバージョンを指定
 * しない実行では `Report.profile` の値が従来と 1 文字も変わらない。
 */
export const formatProfileSelector = (selector: ProfileSelector): string =>
  selector.version === undefined
    ? selector.name
    : `${selector.name}@${formatSemVer(selector.version)}`;
