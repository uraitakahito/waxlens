// @module-tag tui
/**
 * scrollWindow / clampOffset の純ロジックのテスト(実測高は呼び出し側が渡す前提)。
 * React も I/O も関わらないので常時走る。
 */
import { describe, expect, it } from "vitest";
import { clampOffset, scrollWindow } from "../src/scroll.js";

describe("scrollWindow", () => {
  it("height<=0 や total<=0 は空窓", () => {
    expect(scrollWindow(0, 10, 0)).toEqual({ start: 0, end: 0, offset: 0, atTop: true, atBottom: true });
    expect(scrollWindow(3, 0, 5)).toEqual({ start: 0, end: 0, offset: 0, atTop: true, atBottom: true });
  });

  it("全部が窓に収まるなら [0,total)", () => {
    const w = scrollWindow(0, 3, 5);
    expect(w.start).toBe(0);
    expect(w.end).toBe(3);
    expect(w.atTop).toBe(true);
    expect(w.atBottom).toBe(true);
  });

  it("offset は [0, total-height] にクランプ", () => {
    expect(scrollWindow(999, 10, 4).offset).toBe(6); // max = 10 - 4
    expect(scrollWindow(-5, 10, 4).offset).toBe(0);
  });

  it("focused が窓の下に出たら offset を下げて追従", () => {
    // total=12, height=5, focused=7 → offset=7-5+1=3、窓 [3,8)
    const w = scrollWindow(0, 12, 5, 7);
    expect(w.start).toBe(3);
    expect(w.end).toBe(8);
    expect(7).toBeGreaterThanOrEqual(w.start);
    expect(7).toBeLessThan(w.end);
  });

  it("focused が窓の上に出たら offset を上げて追従", () => {
    // 既に offset=8 で focused=2 → offset=2、窓 [2,7)
    const w = scrollWindow(8, 12, 5, 2);
    expect(w.start).toBe(2);
    expect(w.end).toBe(7);
  });

  it("focused が窓内ならそのまま", () => {
    const w = scrollWindow(3, 12, 5, 5); // 5 ∈ [3,8)
    expect(w.start).toBe(3);
  });

  it("atTop / atBottom フラグ", () => {
    expect(scrollWindow(0, 12, 5).atTop).toBe(true);
    expect(scrollWindow(0, 12, 5).atBottom).toBe(false);
    expect(scrollWindow(7, 12, 5).atBottom).toBe(true); // max = 7
    expect(scrollWindow(7, 12, 5).atTop).toBe(false);
  });
});

describe("clampOffset", () => {
  it("delta を足して [0, total-height] にクランプ", () => {
    expect(clampOffset(0, 1, 10, 4)).toBe(1);
    expect(clampOffset(5, 10, 10, 4)).toBe(6); // max = 6
    expect(clampOffset(3, -10, 10, 4)).toBe(0);
  });
});
