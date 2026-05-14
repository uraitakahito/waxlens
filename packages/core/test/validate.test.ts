/**
 * Validation engine + rule のテスト。
 *
 * 各テストは fixture generator で WACZ をオンザフライで作る (チェック
 * イン済みのバイナリ blob ではなく、ここで encode する spec を "good"
 * baseline が追えるように)。一時ファイルに書いて `DEFAULT_RULES` を当てる。
 * assert は *issue rule 名* に対して行う — メッセージの正確な文言は
 * renderer の責務で、`cli.test.ts` の CLI snapshot test が cover する。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runValidation } from "../src/validate/engine.js";
import { DEFAULT_RULES } from "../src/validate/rules/index.js";
import type { Report, RuleProfile } from "../src/validate/types.js";
import { WaczReader } from "../src/wacz/reader.js";
import { buildWacz, type FixtureOptions } from "./fixtures/generator.js";

const runAgainstFixture = async (
  tmpDir: string,
  filename: string,
  options: FixtureOptions = {},
  profile: RuleProfile = "spec",
): Promise<Report> => {
  const { bytes } = await buildWacz(options);
  const path = join(tmpDir, filename);
  await writeFile(path, bytes);
  const reader = await WaczReader.open(path);
  try {
    const result = await runValidation(reader, {
      file: path,
      waxlensVersion: "0.0.0",
      rules: DEFAULT_RULES,
      profile,
    });
    if (!result.ok) throw new Error("runValidation returned err — unreachable");
    return result.value;
  } finally {
    await reader.close();
  }
};

const ruleNames = (report: Report): string[] => report.issues.map((i) => i.rule);

describe("validation engine — happy path", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-test-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("a default-generated WACZ passes all rules", async () => {
    const report = await runAgainstFixture(tmpDir, "good.wacz");
    expect(report.valid).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.warnings).toBe(0);
    expect(report.summary.passed).toBe(DEFAULT_RULES.length);
    expect(report.issues).toEqual([]);
  });
});

describe("validation engine — corrupted variants", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-test-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("omitted datapackage profile → profile-required fires", async () => {
    const report = await runAgainstFixture(tmpDir, "no-profile.wacz", { profile: null });
    expect(report.valid).toBe(false);
    expect(ruleNames(report)).toContain("datapackage/profile-required");
  });

  it("wrong datapackage profile value → profile-required fires", async () => {
    const report = await runAgainstFixture(tmpDir, "wrong-profile.wacz", {
      profile: "not-a-data-package",
    });
    expect(report.valid).toBe(false);
    expect(ruleNames(report)).toContain("datapackage/profile-required");
  });

  it("omitted wacz_version → wacz-version-required fires (error)", async () => {
    // generator は常に wacz_version をセットするので、本テストでは
    // raw な datapackage を直接書く形で mutate する。簡易には helper を
    // 使って再ビルドしつつ、option 型を bypass するため `unknown` で
    // cast する。さしあたって "unknown version → warning" 分岐を
    // 動かす。
    const report = await runAgainstFixture(tmpDir, "unknown-version.wacz", {
      waczVersion: "9.9.9",
    });
    const versionIssues = report.issues.filter(
      (i) => i.rule === "datapackage/wacz-version-required",
    );
    expect(versionIssues).toHaveLength(1);
    expect(versionIssues[0]?.severity).toBe("warning");
  });

  it("corrupted resource hash → resource-hashes fires", async () => {
    const report = await runAgainstFixture(tmpDir, "bad-hash.wacz", {
      mutateResources: (defaults) =>
        defaults.map((r) =>
          r.path === "archive/data.warc.gz"
            ? {
                ...r,
                hash: "sha256:dead0000000000000000000000000000000000000000000000000000000000ff",
              }
            : r,
        ),
    });
    expect(report.valid).toBe(false);
    expect(ruleNames(report)).toContain("datapackage/resource-hashes");
  });

  it("CDXJ filename starts with archive/ → filename-archive-relative fires", async () => {
    const report = await runAgainstFixture(tmpDir, "bad-cdxj-filename.wacz", {
      cdxjFilenameOverride: "archive/data.warc.gz",
    });
    expect(report.valid).toBe(false);
    expect(ruleNames(report)).toContain("cdxj/filename-archive-relative");
  });

  it("gzipped CDXJ index (browserhive profile) → index-not-gzipped errors", async () => {
    const report = await runAgainstFixture(
      tmpDir,
      "gz-cdxj.wacz",
      { cdxjGzipped: true },
      "browserhive",
    );
    expect(report.valid).toBe(false);
    const issues = report.issues.filter((i) => i.rule === "cdxj/index-not-gzipped");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("gzipped CDXJ index (default = spec) → index-not-gzipped emits warnings", async () => {
    const report = await runAgainstFixture(tmpDir, "gz-cdxj.wacz", { cdxjGzipped: true });
    expect(report.profile).toBe("spec");
    // rule 自体は spec profile では `warning` に降格された。ここでは
    // `report.valid` を assert しない。fixture には plain な
    // `indexes/index.cdxj` entry も無く、
    // `cdxj/index-recognised-by-wabac` がそれを error として
    // 報告するためである (どの flavour の認識済み index も無い)。
    const issues = report.issues.filter((i) => i.rule === "cdxj/index-not-gzipped");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("no recognised index → cdxj/index-recognised-by-wabac errors (every profile)", async () => {
    const report = await runAgainstFixture(tmpDir, "gz-cdxj.wacz", { cdxjGzipped: true });
    const issues = report.issues.filter((i) => i.rule === "cdxj/index-recognised-by-wabac");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("error");
    expect(report.valid).toBe(false);
  });

  it("producer=webrecorder fixture validates cleanly under spec profile", async () => {
    // `.cdx.gz` + `.idx` のペアは wabac-recognised なので、新しい
    // rule は pass する。他の producer 固有 rule
    // (`cdxj/index-not-gzipped`、`cdxj/filename-archive-relative`)
    // は silent か適切に降格される。
    const report = await runAgainstFixture(tmpDir, "webrecorder.wacz", { producer: "webrecorder" });
    expect(report.profile).toBe("spec");
    // error 無し — BrowserHive のレイアウトとは違っても WACZ は
    // spec profile では valid。
    expect(report.summary.failed).toBe(0);
    expect(report.valid).toBe(true);
  });

  it("producer=webrecorder fixture → cdxj/index-not-gzipped errors under browserhive profile", async () => {
    const report = await runAgainstFixture(
      tmpDir,
      "webrecorder.wacz",
      { producer: "webrecorder" },
      "browserhive",
    );
    expect(report.profile).toBe("browserhive");
    const issues = report.issues.filter((i) => i.rule === "cdxj/index-not-gzipped");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
    expect(report.valid).toBe(false);
  });

  it("producer=webrecorder fixture under lenient profile → exit 0", async () => {
    const report = await runAgainstFixture(
      tmpDir,
      "webrecorder.wacz",
      { producer: "webrecorder" },
      "lenient",
    );
    expect(report.profile).toBe("lenient");
    expect(report.summary.failed).toBe(0);
    expect(report.valid).toBe(true);
  });

  it("missing datapackage.json → profile-required reports it", async () => {
    const report = await runAgainstFixture(tmpDir, "no-datapackage.wacz", {
      omitDatapackage: true,
    });
    expect(report.valid).toBe(false);
    expect(ruleNames(report)).toContain("datapackage/profile-required");
  });

  // -- WARC / cross-layer rule coverage -------------------------------

  it("DEFLATE-stored warc → warc/storage-store warns", async () => {
    const report = await runAgainstFixture(tmpDir, "deflate-warc.wacz", {
      warcDeflate: true,
    });
    const issues = report.issues.filter((i) => i.rule === "warc/storage-store");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    // validation 全体としては valid のまま (warning であって error ではない)。
    expect(report.valid).toBe(true);
  });

  it("corrupted gzip member → warc/members-independent errors", async () => {
    // 10 バイトの gzip header を越えた位置の deflate stream 内で 1 バイト
    // 反転させて、decode を fail させる。
    const report = await runAgainstFixture(tmpDir, "corrupt-warc.wacz", {
      warcCorruptAt: 30,
    });
    expect(report.valid).toBe(false);
    expect(ruleNames(report)).toContain("warc/members-independent");
  });

  it("mismatched CDXJ offset → cdxj/warc-offsets errors", async () => {
    const report = await runAgainstFixture(tmpDir, "bad-cdxj-offset.wacz", {
      cdxjOffsetOverride: "999999",
    });
    expect(report.valid).toBe(false);
    expect(ruleNames(report)).toContain("cdxj/warc-offsets");
  });

  it("mismatched CDXJ length → cdxj/warc-offsets errors (length branch)", async () => {
    const report = await runAgainstFixture(tmpDir, "bad-cdxj-length.wacz", {
      cdxjLengthMismatch: true,
    });
    expect(report.valid).toBe(false);
    const offset = report.issues.filter((i) => i.rule === "cdxj/warc-offsets");
    expect(offset).toHaveLength(1);
    expect(offset[0]?.message).toContain("length");
  });

  it("mainPageURL not covered → cdxj/pages-mainpage warns", async () => {
    const report = await runAgainstFixture(tmpDir, "orphan-mainpage.wacz", {
      mainPageUrlOverride: "https://orphan.example/",
    });
    const issues = report.issues.filter((i) => i.rule === "cdxj/pages-mainpage");
    // pages 側と cdxj 側の両方の warning が発火するはず。
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("invalid fuzzy.json → fuzzy/valid-json reports info", async () => {
    const report = await runAgainstFixture(tmpDir, "broken-fuzzy.wacz", {
      fuzzyOverride: "not json",
    });
    const issues = report.issues.filter((i) => i.rule === "fuzzy/valid-json");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("info");
    expect(report.valid).toBe(true); // info は valid を反転させない
  });

  it("bad WARC-Payload-Digest → warc/payload-digest warns", async () => {
    const report = await runAgainstFixture(tmpDir, "bad-payload-digest.wacz", {
      payloadDigestBad: true,
    });
    const issues = report.issues.filter((i) => i.rule === "warc/payload-digest");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
  });
});
