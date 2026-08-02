// @module-tag engine
/**
 * `Report.entries`(ファイル一覧 + 検証の紐付け)のテスト。
 *
 * - ZIP の実エントリを present:true で網羅し、size / expectedBy が取れる
 * - hash 不一致は該当 file の issues に紐付く
 * - datapackage が宣言するが ZIP に無い path は present:false で出る
 * - §5.2 MUST が不在なら present:false / expectedBy:[wacz-spec] で出る
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseReportSource, type Report } from "../src/validate/domain.js";
import { runValidation } from "../src/validate/engine.js";
import { DEFAULT_RULES } from "../src/validate/rules/index.js";
import { fileTransport } from "../src/wacz/transport.js";
import { WaczReader } from "../src/wacz/reader.js";
import { buildWacz, type FixtureOptions } from "./fixtures/generator.js";

const reportFor = async (tmpDir: string, options: FixtureOptions = {}): Promise<Report> => {
  const { bytes } = await buildWacz(options);
  const path = join(tmpDir, "fixture.wacz");
  await writeFile(path, bytes);
  const src = parseReportSource(path);
  if (!src.ok || src.value.kind !== "file") throw new Error("unreachable: local file");
  const reader = await WaczReader.open(fileTransport(src.value.path));
  try {
    const result = await runValidation(reader, {
      waxlensVersion: "0.0.0",
      rules: DEFAULT_RULES,
      profile: "spec",
    });
    if (!result.ok) throw new Error("unreachable: runValidation err");
    return result.value;
  } finally {
    await reader.close();
  }
};

describe("Report.entries", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-entries-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("ZIP の実エントリを present:true で網羅し、size / expectedBy が取れる", async () => {
    const report = await reportFor(tmpDir);
    const paths = report.entries.map((e) => e.path);
    expect(paths).toContain("archive/data.warc.gz");
    expect(paths).toContain("datapackage.json");

    const warc = report.entries.find((e) => e.path === "archive/data.warc.gz");
    expect(warc?.present).toBe(true);
    expect(typeof warc?.uncompressedSize).toBe("number");
    expect(warc?.expectedBy).toContain("datapackage"); // resources[] に居る

    // datapackage.json 自身は resources[] には居ないが、§5.2.4 の MUST。
    const dp = report.entries.find((e) => e.path === "datapackage.json");
    expect(dp?.present).toBe(true);
    expect(dp?.expectedBy).toEqual(["wacz-spec"]);
  });

  it("hash 不一致は該当 file の issues に紐付く", async () => {
    const report = await reportFor(tmpDir, {
      mutateResources: (rs) =>
        rs.map((r) =>
          r.path === "archive/data.warc.gz"
            ? {
                ...r,
                hash: "sha256:dead0000000000000000000000000000000000000000000000000000000000ff",
              }
            : r,
        ),
    });
    const warc = report.entries.find((e) => e.path === "archive/data.warc.gz");
    expect(
      warc?.issues.some(
        (i) => i.rule === "datapackage/resource-hashes" && i.severity === "error",
      ),
    ).toBe(true);
  });

  it("datapackage が宣言するが ZIP に無い path は present:false", async () => {
    const report = await reportFor(tmpDir, {
      mutateResources: (rs) => [
        ...rs,
        { name: "extrapages.jsonl", path: "pages/extraPages.jsonl", hash: "sha256:00", bytes: 0 },
      ],
    });
    const ghost = report.entries.find((e) => e.path === "pages/extraPages.jsonl");
    expect(ghost?.present).toBe(false);
    expect(ghost?.expectedBy).toContain("datapackage");
  });

  it("§5.2 MUST が不在(未宣言)でも present:false / expectedBy:[wacz-spec] で出る", async () => {
    // omitPages は ZIP からも resources[] からも pages.jsonl を落とす
    // (= 不在かつ未宣言)。それでも §5.2.3 の MUST としてツリーに出るべき。
    const report = await reportFor(tmpDir, { omitPages: true });
    const pages = report.entries.find((e) => e.path === "pages/pages.jsonl");
    expect(pages?.present).toBe(false);
    expect(pages?.expectedBy).toEqual(["wacz-spec"]);
    // wacz/required-files の issue が該当 entry に紐付く
    expect(pages?.issues.some((i) => i.rule === "wacz/required-files")).toBe(true);
  });
});
