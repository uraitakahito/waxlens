/**
 * `wacz/required-files`(§5.2 の MUST ファイル存在チェック)と、
 * それに伴う `datapackage/profile-required` の de-dup の回帰テスト。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseReportSource } from "../src/validate/domain.js";
import { runValidation } from "../src/validate/engine.js";
import { DEFAULT_RULES } from "../src/validate/rules/index.js";
import { fileTransport } from "../src/wacz/transport.js";
import { WaczReader } from "../src/wacz/reader.js";
import { buildWacz, type FixtureOptions } from "./fixtures/generator.js";

const RF = "wacz/required-files";
const PROFILE = "datapackage/profile-required";

const rulesFor = async (tmpDir: string, options: FixtureOptions = {}): Promise<string[]> => {
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
    return result.value.issues.map((i) => i.rule);
  } finally {
    await reader.close();
  }
};

describe("wacz/required-files", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-rf-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("正常な WACZ では required-files を出さない", async () => {
    expect(await rulesFor(tmpDir)).not.toContain(RF);
  });

  it.each([
    ["omitDatapackage", { omitDatapackage: true }],
    ["omitPages", { omitPages: true }],
    ["omitArchive", { omitArchive: true }],
    ["omitIndexes", { omitIndexes: true }],
  ])("%s で §5.2 MUST 欠落として required-files が発火する", async (_label, options) => {
    expect(await rulesFor(tmpDir, options)).toContain(RF);
  });
});

describe("datapackage/profile-required の de-dup", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-rf-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("datapackage 不在では profile-required を出さない (required-files が担当)", async () => {
    const rules = await rulesFor(tmpDir, { omitDatapackage: true });
    expect(rules).toContain(RF);
    expect(rules).not.toContain(PROFILE);
  });

  it("datapackage は在るが profile が無いときは profile-required が発火する", async () => {
    const rules = await rulesFor(tmpDir, { profile: null });
    expect(rules).toContain(PROFILE);
    expect(rules).not.toContain(RF); // datapackage 自体は在るので required-files は出ない
  });
});
