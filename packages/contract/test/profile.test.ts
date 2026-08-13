// @module-tag cli
/**
 * profile selector と、最小 semver の固定。
 *
 * ここが守るのは 2 つ。
 *   1. **バージョンを書かない selector は元の文字列に戻る。** これが崩れると
 *      `Report.profile` の値が変わり、既存の出力が動く。
 *   2. **解せない範囲式は throw する。** false に化けると rule が静かに
 *      消えるので、書き間違いはその場で落ちてほしい。
 */
import { describe, expect, it } from "vitest";
import {
  ALL_PROFILES,
  formatProfileSelector,
  parseProfileSelector,
  parseSemVer,
  satisfies,
} from "../src/index.js";

describe("parseProfileSelector", () => {
  it("バージョンなしは profile 名そのもの", () => {
    for (const name of ALL_PROFILES) {
      expect(parseProfileSelector(name)).toEqual({ name });
    }
  });

  it("バージョンつきを分解する", () => {
    expect(parseProfileSelector("browserhive@2.1.0")).toEqual({
      name: "browserhive",
      version: { major: 2, minor: 1, patch: 0 },
    });
  });

  it("往復して元の文字列に戻る", () => {
    // バージョンなしの往復が壊れると Report.profile の値が変わる = 既存の出力が動く。
    for (const raw of ["spec", "lenient", "browserhive", "browserhive@2.1.0"]) {
      const parsed = parseProfileSelector(raw);
      expect(parsed).not.toBeNull();
      expect(formatProfileSelector(parsed!)).toBe(raw);
    }
  });

  it("知らない profile 名は null", () => {
    expect(parseProfileSelector("strict")).toBeNull();
    expect(parseProfileSelector("strict@1.0.0")).toBeNull();
  });

  it("バージョンとして読めないものは null", () => {
    // 「profile 名は合っているがバージョンが壊れている」を既定に落とさない —
    // daemon が静かに既定 profile へフォールバックしていた不具合の再発防止。
    expect(parseProfileSelector("browserhive@x")).toBeNull();
    expect(parseProfileSelector("browserhive@2.1")).toBeNull();
    expect(parseProfileSelector("browserhive@")).toBeNull();
  });
});

describe("parseSemVer", () => {
  it("x.y.z だけを受ける", () => {
    expect(parseSemVer("1.11.0")).toEqual({ major: 1, minor: 11, patch: 0 });
    expect(parseSemVer("2.1")).toBeNull();
    expect(parseSemVer("v1.11.0")).toBeNull();
    // prerelease は順序を決める必要が出るので今は受けない。
    expect(parseSemVer("2.1.0-rc.1")).toBeNull();
  });
});

describe("satisfies", () => {
  const v = (s: string) => parseSemVer(s)!;

  it("境界を含む / 含まない", () => {
    expect(satisfies(v("1.11.0"), ">=1.11.0")).toBe(true);
    expect(satisfies(v("1.10.9"), ">=1.11.0")).toBe(false);
    expect(satisfies(v("1.11.0"), ">1.11.0")).toBe(false);
    expect(satisfies(v("1.11.1"), ">1.11.0")).toBe(true);
    expect(satisfies(v("2.0.0"), "<=2.0.0")).toBe(true);
    expect(satisfies(v("2.0.1"), "<2.0.0")).toBe(false);
  });

  it("桁をまたぐ比較", () => {
    // 文字列比較なら "1.9.0" > "1.11.0" になってしまう組み合わせ。
    expect(satisfies(v("1.9.0"), ">=1.11.0")).toBe(false);
    expect(satisfies(v("2.1.0"), ">=1.11.0")).toBe(true);
  });

  it("空白区切りは AND", () => {
    expect(satisfies(v("1.15.0"), ">=1.11.0 <2.0.0")).toBe(true);
    expect(satisfies(v("2.1.0"), ">=1.11.0 <2.0.0")).toBe(false);
  });

  it("解せない式は throw する（false に化けない）", () => {
    expect(() => satisfies(v("1.11.0"), "^1.11.0")).toThrow(/解せない範囲式/);
    expect(() => satisfies(v("1.11.0"), "~1.11.0")).toThrow(/解せない範囲式/);
    expect(() => satisfies(v("1.11.0"), ">=1.11.0 || <1.0.0")).toThrow(/解せない範囲式/);
    expect(() => satisfies(v("1.11.0"), "")).toThrow(/空の範囲式/);
  });
});
