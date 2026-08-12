// @module-tag docs
/**
 * spec カバレッジ拡充で追加した 5 rule のテスト。
 *
 *   warc/extension-gzip-match / pages/page-schema / datapackage/digest /
 *   wacz/reserved-dirs-clean / datapackage/resources-complete
 *
 * validate.test.ts と同じく fixture をオンザフライで生成し、DEFAULT_RULES を
 * 当てて issue の *rule 名* を assert する(文言は renderer / snapshot 側)。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runValidation } from "../src/validate/engine.js";
import { DEFAULT_RULES } from "../src/validate/rules/index.js";
import { parseReportSource, type Report } from "../src/validate/domain.js";
import { WaczReader } from "../src/wacz/reader.js";
import { fileTransport } from "../src/wacz/transport.js";
import { buildWacz, type FixtureOptions } from "./fixtures/generator.js";

const reportFor = async (tmpDir: string, options: FixtureOptions = {}): Promise<Report> => {
  const { bytes } = await buildWacz(options);
  const path = join(tmpDir, "fixture.wacz");
  await writeFile(path, bytes);
  const parsed = parseReportSource(path);
  if (!parsed.ok || parsed.value.kind !== "file") throw new Error("unreachable");
  const reader = await WaczReader.open(fileTransport(parsed.value.path));
  try {
    const result = await runValidation(reader, {
      waxlensVersion: "0.0.0",
      rules: DEFAULT_RULES,
      profile: { name: "spec" },
    });
    if (!result.ok) throw new Error("unreachable");
    return result.value;
  } finally {
    await reader.close();
  }
};

const rules = (report: Report): string[] => report.issues.map((i) => i.rule);

describe("spec-coverage rules", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-spec-cov-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("黄金は新 5 rule のいずれも発火しない", async () => {
    const report = await reportFor(tmpDir);
    const names = rules(report);
    for (const r of [
      "warc/extension-gzip-match",
      "pages/page-schema",
      "datapackage/digest",
      "wacz/reserved-dirs-clean",
      "datapackage/resources-complete",
    ]) {
      expect(names, `${r} should not fire on the golden`).not.toContain(r);
    }
  });

  it("warc/extension-gzip-match: gzip 内容を .warc 名で格納すると発火", async () => {
    const report = await reportFor(tmpDir, { warcExtensionMismatch: true });
    expect(rules(report)).toContain("warc/extension-gzip-match");
  });

  it("pages/page-schema: url/ts を欠く page 行で発火", async () => {
    const report = await reportFor(tmpDir, { pagesBadLine: "missing-prop" });
    expect(rules(report)).toContain("pages/page-schema");
  });

  it("pages/page-schema: JSON でない page 行で発火", async () => {
    const report = await reportFor(tmpDir, { pagesBadLine: "not-json" });
    expect(rules(report)).toContain("pages/page-schema");
  });

  it("datapackage/digest: digest が無いと warning で発火(valid のまま)", async () => {
    const report = await reportFor(tmpDir, { digest: "absent" });
    expect(rules(report)).toContain("datapackage/digest");
    expect(report.valid).toBe(true);
  });

  it("datapackage/digest: hash 不一致は error で発火(valid=false)", async () => {
    const report = await reportFor(tmpDir, { digest: "bad-hash" });
    expect(rules(report)).toContain("datapackage/digest");
    expect(report.valid).toBe(false);
  });

  it("wacz/reserved-dirs-clean: 予約 dir の異物で発火", async () => {
    const report = await reportFor(tmpDir, { reservedDirExtraFile: true });
    expect(rules(report)).toContain("wacz/reserved-dirs-clean");
  });

  it("datapackage/resources-complete: 未宣言の孤児ファイルで発火", async () => {
    const report = await reportFor(tmpDir, { orphanFile: true });
    expect(rules(report)).toContain("datapackage/resources-complete");
  });
});
