/**
 * i18n 基盤(translate.ts)のテスト。
 *
 * - t() が locale のカタログで解決し、params を差し込む
 * - ICU の複数形が効く
 * - 未定義キーは locale→en→id の順でフォールバックする
 * - resolveLocale が flag/env/LANG を正規化する
 */
import { afterEach, describe, expect, it } from "vitest";
import { resolveLocale, SUPPORTED_LOCALES, t } from "../src/i18n/translate.js";

describe("t()", () => {
  it("locale のカタログで解決する(en / ja)", () => {
    expect(t("i18n.smoke", { n: 2 }, "en")).toBe("2 files missing");
    expect(t("i18n.smoke", { n: 2 }, "ja")).toBe("2 個のファイルが不足");
  });

  it("ICU の複数形が効く(en の one/other)", () => {
    expect(t("i18n.smoke", { n: 1 }, "en")).toBe("1 file missing");
    expect(t("i18n.smoke", { n: 3 }, "en")).toBe("3 files missing");
  });

  it("未定義キーは id をそのまま返す(可視のフォールバック)", () => {
    expect(t("does.not.exist", {}, "ja")).toBe("does.not.exist");
  });
});

describe("resolveLocale()", () => {
  const saved = { WAXLENS_LANG: process.env["WAXLENS_LANG"], LANG: process.env["LANG"] };
  afterEach(() => {
    if (saved.WAXLENS_LANG === undefined) delete process.env["WAXLENS_LANG"];
    else process.env["WAXLENS_LANG"] = saved.WAXLENS_LANG;
    if (saved.LANG === undefined) delete process.env["LANG"];
    else process.env["LANG"] = saved.LANG;
  });

  it("明示フラグを最優先する", () => {
    expect(resolveLocale("ja")).toBe("ja");
    expect(resolveLocale("en")).toBe("en");
  });

  it("ja_JP.UTF-8 のような値を言語コードに正規化する", () => {
    expect(resolveLocale("ja_JP.UTF-8")).toBe("ja");
  });

  it("未対応ロケールは en に丸める", () => {
    expect(resolveLocale("fr")).toBe("en");
  });

  it("フラグ未指定なら WAXLENS_LANG → LANG の順で参照する", () => {
    delete process.env["LANG"];
    process.env["WAXLENS_LANG"] = "ja";
    expect(resolveLocale()).toBe("ja");
    delete process.env["WAXLENS_LANG"];
    process.env["LANG"] = "ja_JP.UTF-8";
    expect(resolveLocale()).toBe("ja");
  });

  it("SUPPORTED_LOCALES は en と ja を含む", () => {
    expect([...SUPPORTED_LOCALES]).toEqual(["en", "ja"]);
  });
});
