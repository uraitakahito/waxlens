/**
 * カタログの健全性チェック。
 *
 * - en と ja のキー集合が一致する(翻訳漏れ・余りを検出)
 * - 全エントリが有効な ICU MessageFormat(コンパイルが throw しない)
 *   → リテラル波括弧の未エスケープ等を CI で検出する
 *
 * カタログは fs で読む(import attribute に依存しない)。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const load = (name: string): Record<string, string> =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../src/i18n/locales/${name}.json`, import.meta.url)), "utf-8"),
  ) as Record<string, string>;

const en = load("en");
const ja = load("ja");

const require = createRequire(import.meta.url);
const IntlMessageFormat = (
  require("intl-messageformat") as { IntlMessageFormat: new (msg: string, locale?: string) => unknown }
).IntlMessageFormat;

describe("i18n catalogs", () => {
  it("en と ja のキー集合が一致する", () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
  });

  it("全エントリが有効な ICU(コンパイルが throw しない)", () => {
    for (const [locale, cat] of [
      ["en", en],
      ["ja", ja],
    ] as const) {
      for (const [key, pattern] of Object.entries(cat)) {
        expect(() => new IntlMessageFormat(pattern, locale), `${locale}:${key}`).not.toThrow();
      }
    }
  });
});
