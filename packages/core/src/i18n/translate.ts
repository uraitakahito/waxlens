/**
 * メッセージの i18n 解決。
 *
 * rule は人間向け prose ではなく `messageKey` + `params` を出す。ここで
 * ロケール別の ICU MessageFormat カタログ(`locales/<locale>.json`)を
 * `intl-messageformat` で解決して表示文字列を作る。Report 自体は
 * locale-neutral(key+params)に保ち、renderer が表示時に `t()` を呼ぶ。
 *
 * - カタログは vendored schema と同じ `import … with { type: "json" }` で
 *   読む。tsc は .json を dist にコピーしないので postbuild で cp する。
 * - `intl-messageformat` は CJS-only(`exports` が `./index.js` のみ)。
 *   ESM + esModuleInterop off では `import` の default が値として取れない
 *   ため、ajv-draft-04 と同じく `createRequire` で値(クラス)を取得する。
 */
import { createRequire } from "node:module";
import en from "./locales/en.json" with { type: "json" };
import ja from "./locales/ja.json" with { type: "json" };

export const SUPPORTED_LOCALES = ["en", "ja"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
/** メッセージに差し込むランタイム値(path・行番号・理由など)。 */
export type MsgParams = Record<string, string | number>;

const catalogs: Record<Locale, Record<string, string>> = { en, ja };

// createRequire で intl-messageformat の値(クラス)を取得。require() は
// { IntlMessageFormat, default, … } を返すので名前付きを使う(ajv-draft-04 と同様)。
interface CompiledMessage {
  format: (values?: Record<string, unknown>) => unknown;
}
type IntlMessageFormatCtor = new (message: string, locales?: string) => CompiledMessage;
const require = createRequire(import.meta.url);
const IntlMessageFormat = (
  require("intl-messageformat") as { IntlMessageFormat: IntlMessageFormatCtor }
).IntlMessageFormat;

// コンパイル済み formatter を (locale, id) でキャッシュ。
const compiled = new Map<string, CompiledMessage>();

/**
 * `id` を `locale` のカタログで解決し、`params` を差し込んだ文字列を返す。
 * カタログにキーが無ければ en → id の順でフォールバックする(壊さない /
 * 欠落が見えるように最終的には id をそのまま出す)。
 */
export const t = (id: string, params: MsgParams, locale: Locale): string => {
  const pattern = catalogs[locale][id] ?? catalogs.en[id] ?? id;
  const cacheKey = `${locale}\t${id}`;
  let mf = compiled.get(cacheKey);
  if (mf === undefined) {
    mf = new IntlMessageFormat(pattern, locale);
    compiled.set(cacheKey, mf);
  }
  return String(mf.format(params));
};

/**
 * 表示ロケールを決める。優先順: 明示フラグ → `WAXLENS_LANG` →
 * 端末の `LANG` → "en"。`ja_JP.UTF-8` のような値は先頭の言語コードに
 * 正規化し、未対応なら "en" に丸める。
 */
export const resolveLocale = (flag?: string): Locale => {
  const raw = flag ?? process.env["WAXLENS_LANG"] ?? process.env["LANG"] ?? "en";
  const base = raw.toLowerCase().split(/[-_.]/)[0] ?? "en";
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as Locale) : "en";
};
