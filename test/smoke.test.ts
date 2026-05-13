import { describe, expect, it } from "vitest";

// M0 smoke test — proves the test runner, tsconfig, and ESM resolution
// all line up. Replaced with real validator tests in M1.
describe("waxlens scaffold", () => {
  it("library entry imports without error", async () => {
    const mod = await import("../src/index.js");
    expect(mod).toBeDefined();
  });
});
