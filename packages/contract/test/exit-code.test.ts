// @module-tag cli
/**
 * exit code 契約の固定。
 *
 * この package が持つ唯一の実行されるロジックで、しかも `waxlens-validate`
 * と `waxlens` の**両方**が守る対外契約 (CI がこの数値で分岐する)。
 * exhaustiveness は tsc が見てくれるが、**どの kind がどの数値になるか**は
 * 型では表現できないのでここで固定する。
 */
import { describe, expect, it } from "vitest";
import { ALL_PROFILES, DEFAULT_PROFILE, exitCodeFor, SUPPORTED_LOCALES } from "../src/index.js";

describe("exitCodeFor", () => {
  it("valid → 0", () => {
    expect(exitCodeFor({ kind: "valid", report: {} })).toBe(0);
  });

  it("invalid → 1", () => {
    expect(exitCodeFor({ kind: "invalid", report: {} })).toBe(1);
  });

  it("operational な失敗はどちらも 2", () => {
    expect(exitCodeFor({ kind: "openFailed", filePath: "/x.wacz", cause: new Error("nope") })).toBe(2);
    expect(exitCodeFor({ kind: "engineFailed" })).toBe(2);
  });
});

describe("語彙", () => {
  it("既定 profile は選べる profile の 1 つ", () => {
    // 型でも縛れているが、値としての整合を実行時にも見ておく —
    // DEFAULT_PROFILE は CLI のヘルプに literal で出る。
    expect(ALL_PROFILES).toContain(DEFAULT_PROFILE);
  });

  it("locale は en / ja", () => {
    // i18n カタログ (core/src/i18n/locales/*.json) と対になる。
    expect([...SUPPORTED_LOCALES]).toEqual(["en", "ja"]);
  });
});
