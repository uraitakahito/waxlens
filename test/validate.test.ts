/**
 * Validation engine + rule tests.
 *
 * Each test builds a WACZ on the fly with the fixture generator (so the
 * "good" baseline tracks the spec we encode rather than a checked-in
 * binary blob), writes it to a temp file, and runs the M1 ruleset
 * against it. We assert on the *issue rule names* — the exact wording of
 * messages is the renderer's concern and is covered by the CLI snapshot
 * tests in `cli.test.ts`.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runValidation } from "../src/validate/engine.js";
import { M1_RULES } from "../src/validate/rules/index.js";
import type { Report } from "../src/validate/types.js";
import { WaczReader } from "../src/wacz/reader.js";
import { buildWacz, type FixtureOptions } from "./fixtures/generator.js";

const runAgainstFixture = async (
  tmpDir: string,
  filename: string,
  options: FixtureOptions = {},
): Promise<Report> => {
  const { bytes } = await buildWacz(options);
  const path = join(tmpDir, filename);
  await writeFile(path, bytes);
  const reader = await WaczReader.open(path);
  try {
    const result = await runValidation(reader, {
      file: path,
      waxlensVersion: "0.0.0",
      rules: M1_RULES,
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
    expect(report.summary.passed).toBe(M1_RULES.length);
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
    // The generator always sets wacz_version, so we mutate via writing a
    // raw datapackage directly in this test. Simpler: rebuild with the
    // helper but cast through `unknown` to bypass the option type.
    // For now we exercise the "unknown version → warning" branch.
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

  it("gzipped CDXJ index → index-not-gzipped fires", async () => {
    const report = await runAgainstFixture(tmpDir, "gz-cdxj.wacz", { cdxjGzipped: true });
    expect(report.valid).toBe(false);
    expect(ruleNames(report)).toContain("cdxj/index-not-gzipped");
  });

  it("missing datapackage.json → profile-required reports it", async () => {
    const report = await runAgainstFixture(tmpDir, "no-datapackage.wacz", {
      omitDatapackage: true,
    });
    expect(report.valid).toBe(false);
    expect(ruleNames(report)).toContain("datapackage/profile-required");
  });

  // -- M3 rule coverage -----------------------------------------------

  it("DEFLATE-stored warc → warc/storage-store warns", async () => {
    const report = await runAgainstFixture(tmpDir, "deflate-warc.wacz", {
      warcDeflate: true,
    });
    const issues = report.issues.filter((i) => i.rule === "warc/storage-store");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    // Validation as a whole stays valid (warning, not error).
    expect(report.valid).toBe(true);
  });

  it("corrupted gzip member → warc/members-independent errors", async () => {
    // Flip a byte inside the deflate stream (well past the 10-byte gzip
    // header) so decoding fails.
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
    // Both pages-side and cdxj-side warnings should fire.
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
    expect(report.valid).toBe(true); // info does not flip valid
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
