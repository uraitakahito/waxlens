// @module-tag frictionless
/**
 * `datapackage/frictionless-schema`(補助ルール)のテスト。
 *
 * - vendored 公式スキーマが v1/draft-04 のままか(pin)
 * - 正常な WACZ では warning を出さない(= 既定 fixture はスキーマ適合)
 * - 公式スキーマ違反(resource.name の大文字)で warning を出す
 * - WACZ 拡張(wacz_version 等)は弾かない
 * - lenient profile では除外される
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseReportSource, type RuleProfile } from "../src/validate/domain.js";
import { runValidation } from "../src/validate/engine.js";
import { DEFAULT_RULES } from "../src/validate/rules/index.js";
import { fileTransport } from "../src/wacz/transport.js";
import { WaczReader } from "../src/wacz/reader.js";
import { buildWacz, type FixtureOptions } from "./fixtures/generator.js";

const RULE = "datapackage/frictionless-schema";

const issuesFor = async (
  tmpDir: string,
  options: FixtureOptions = {},
  profile: RuleProfile = "spec",
): Promise<{ rule: string; severity: string }[]> => {
  const { bytes } = await buildWacz(options);
  const path = join(tmpDir, "fixture.wacz");
  await writeFile(path, bytes);
  const sourceResult = parseReportSource(path);
  if (!sourceResult.ok) throw new Error("unreachable: test input is well-formed");
  if (sourceResult.value.kind !== "file") throw new Error("unreachable: local file");
  const reader = await WaczReader.open(fileTransport(sourceResult.value.path));
  try {
    const result = await runValidation(reader, {
      waxlensVersion: "0.0.0",
      rules: DEFAULT_RULES,
      profile: { name: profile },
    });
    if (!result.ok) throw new Error("runValidation returned err — unreachable");
    return result.value.issues.map((i) => ({ rule: i.rule, severity: i.severity }));
  } finally {
    await reader.close();
  }
};

describe("datapackage/frictionless-schema", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-fdp-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("vendored schema は Frictionless v1 / draft-04 のまま (pin)", () => {
    const schema = JSON.parse(
      readFileSync(
        new URL(
          "../src/validate/frictionless/data-package.schema.json",
          import.meta.url,
        ),
        "utf-8",
      ),
    ) as { $schema: string; required: string[] };
    expect(schema.$schema).toContain("draft-04");
    expect(schema.required).toContain("resources");
  });

  it("正常な WACZ では frictionless-schema の warning を出さない", async () => {
    const issues = await issuesFor(tmpDir);
    expect(issues.some((i) => i.rule === RULE)).toBe(false);
  });

  it("resource.name が公式パターン外(大文字)だと warning", async () => {
    const issues = await issuesFor(tmpDir, {
      mutateResources: (rs) =>
        rs.map((r, i) => (i === 0 ? { ...r, name: "DATA.warc.gz" } : r)),
    });
    expect(
      issues.some((i) => i.rule === RULE && i.severity === "warning"),
    ).toBe(true);
  });

  it("WACZ 拡張 (wacz_version / mainPageURL) は弾かない", async () => {
    // 既定 fixture は wacz_version と mainPageURL を持つ。これらが warning に
    // ならない = additionalProperties open がスキーマで効いている。
    const issues = await issuesFor(tmpDir);
    expect(issues.filter((i) => i.rule === RULE)).toEqual([]);
  });

  it("lenient profile では除外される", async () => {
    const issues = await issuesFor(
      tmpDir,
      { mutateResources: (rs) => rs.map((r, i) => (i === 0 ? { ...r, name: "DATA.warc.gz" } : r)) },
      "lenient",
    );
    expect(issues.some((i) => i.rule === RULE)).toBe(false);
  });
});
