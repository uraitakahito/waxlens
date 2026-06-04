/**
 * spec-sections.ts(section → spec URL)のテスト。
 */
import { describe, expect, it } from "vitest";
import { SPEC_SECTIONS, specUrl } from "../src/validate/spec-sections.js";

describe("specUrl", () => {
  it("section 番号を spec のアンカー URL に解決する", () => {
    expect(specUrl("5.2.1")).toBe("https://specs.webrecorder.net/wacz/1.1.1/#archive");
    expect(specUrl("5.2.4")).toBe("https://specs.webrecorder.net/wacz/1.1.1/#datapackage-json");
  });

  it("number でも引ける(params は string | number)", () => {
    expect(specUrl(5.2)).toBe("https://specs.webrecorder.net/wacz/1.1.1/#directories-and-files");
  });

  it("未知 section / undefined は undefined", () => {
    expect(specUrl("9.9.9")).toBeUndefined();
    expect(specUrl(undefined)).toBeUndefined();
  });

  it("§5.2 系の全 section が BASE で始まる絶対 URL", () => {
    for (const url of Object.values(SPEC_SECTIONS)) {
      expect(url).toMatch(/^https:\/\/specs\.webrecorder\.net\/wacz\/1\.1\.1\/#/);
    }
  });
});
