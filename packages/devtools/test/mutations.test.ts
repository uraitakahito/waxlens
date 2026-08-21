// @module-tag engine
/**
 * 壊し方そのもののテスト。
 *
 * 見ているのは「rule が反応するか」ではなく **「入力が実際に変わったか」** ——
 * 壊し方が黙って何もしないと、検証は緑のままで「rule が検出できていない」と
 * 読まれる。実際には rule は正しく、壊れていなかっただけなのに。壊し方の嘘は
 * rule の欠陥に化けるので、そこを先に塞ぐ。
 */
import { describe, expect, it } from "vitest";
import { MUTATIONS, type TlsMember } from "../src/mutations.js";

/** 2 host・2 チェーンの最小形。どの壊し方も適用できる。 */
const sample = (): TlsMember => ({
  hosts: {
    "a.example": { subject: "a.example", san: ["a.example"], chainRef: "aaa" },
    "b.example": { subject: "b.example", san: ["b.example"], chainRef: "bbb" },
  },
  chains: { aaa: ["leaf-a", "inter-a"], bbb: ["leaf-b", "inter-b"] },
});

describe("MUTATIONS", () => {
  it("名前が重複しない", () => {
    const names = MUTATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("すべてが messageKey を名乗る", () => {
    for (const m of MUTATIONS) expect(m.expects).toMatch(/^browserhive\/tls-(chain|san)\./);
  });

  it.each(MUTATIONS.map((m) => [m.name, m] as const))("%s は tls を実際に書き換える", (_n, m) => {
    const before = JSON.stringify(sample());
    const tls = sample();
    const said = m.apply(tls);
    // 何も変わっていないなら、この壊し方は嘘をつく。
    expect(JSON.stringify(tls)).not.toBe(before);
    // 何をしたかも名乗ること。--list と出力の両方がこれに依る。
    expect(said).not.toBe("");
  });
});

describe("壊せない入力", () => {
  it("チェーンが 1 本しか無ければ swap は throw する", () => {
    const one: TlsMember = {
      hosts: { "a.example": { chainRef: "aaa" } },
      chains: { aaa: ["leaf-a", "inter-a"] },
    };
    const swap = MUTATIONS.find((m) => m.name === "swap-intermediate");
    expect(swap).toBeDefined();
    // 黙って成功すると「壊したのに緑」に化ける。失敗は失敗として出す。
    expect(() => swap?.apply(one)).toThrow();
  });

  it("chainRef がどこにも無ければ throw する", () => {
    const none: TlsMember = { hosts: { "a.example": null }, chains: {} };
    for (const m of MUTATIONS.filter((x) => x.name !== "san-drift")) {
      expect(() => m.apply(structuredClone(none))).toThrow();
    }
  });

  it("san を持つ host が無ければ san-drift は throw する", () => {
    const none: TlsMember = {
      hosts: { "a.example": { chainRef: "aaa" } },
      chains: { aaa: ["leaf-a"] },
    };
    const drift = MUTATIONS.find((m) => m.name === "san-drift");
    expect(() => drift?.apply(none)).toThrow();
  });
});
