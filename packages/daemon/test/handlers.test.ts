/**
 * daemon ハンドラのテスト。
 *
 * 不正 URI の DaemonError は常時走る。実 WACZ を要する validate/readEntry の
 * happy path は corpus fixtures を使い `CORPUS_DIR` 未設定なら skip(corpus-driven
 * と同じ規約)。各呼び出しは独立(stateless)。
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { DaemonError, readEntry, validate } from "../src/handlers.js";

const corpusDir = process.env["CORPUS_DIR"];
const fixtureUri = (rel: string): string => pathToFileURL(resolve(corpusDir ?? "", rel)).href;

describe("daemon handlers", () => {
  it("開けない URI は openFailed の DaemonError", async () => {
    await expect(
      validate({ source: { kind: "uri", uri: "file:///waxlens/no-such-file.wacz" }, locale: "en" }),
    ).rejects.toBeInstanceOf(DaemonError);
  });

  describe.skipIf(corpusDir === undefined || corpusDir === "")("with corpus fixtures", () => {
    it("validate: good.wacz は valid な WireReport(解決済み message)", async () => {
      const report = await validate({
        source: { kind: "uri", uri: fixtureUri("fixtures/good.wacz") },
        locale: "en",
        profile: "spec",
      });
      expect(report.valid).toBe(true);
      expect(report.summary.failed).toBe(0);
    });

    it("validate: locale=ja で issue message が日本語に解決される", async () => {
      const report = await validate({
        source: { kind: "uri", uri: fixtureUri("fixtures/wacz-missing-archive.wacz") },
        locale: "ja",
      });
      expect(report.valid).toBe(false);
      expect(report.issues.some((i) => i.message.includes("ありません"))).toBe(true);
    });

    it("readEntry: datapackage.json は JSON 整形された内容を返す", async () => {
      const res = await readEntry({
        source: { kind: "uri", uri: fixtureUri("fixtures/good.wacz") },
        path: "datapackage.json",
      });
      expect(res.content).toContain('"profile": "data-package"');
      expect(res.truncated).toBe(false);
    });
  });
});
