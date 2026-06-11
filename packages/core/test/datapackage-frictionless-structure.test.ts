/**
 * `datapackage/frictionless-structure`(MUST/error)のテスト。
 *
 * Frictionless の「構造」要件だけを error で見る — 正当な WACZ なら必ず満たすので
 * 誤検知しない。stylistic(name 小文字 等)は frictionless-schema(warning)が担当。
 *
 * - 正常な WACZ では error を出さない
 * - resources が空配列 → error(no-resources)
 * - resource に name が無い → error
 * - resource に path も data も無い → error
 * - path の代わりに data があれば error にしない
 * - datapackage.json 不在 → error なし(profile-required に委譲)
 * - lenient profile では除外
 *
 * ハーネスは frictionless-schema.test.ts と同形。rule を直接 import せず、
 * DEFAULT_RULES を engine で回して rule 名で issue を拾う(登録まで含めて検証)。
 */
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

const RULE = "datapackage/frictionless-structure";

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
      profile,
    });
    if (!result.ok) throw new Error("runValidation returned err — unreachable");
    return result.value.issues.map((i) => ({ rule: i.rule, severity: i.severity }));
  } finally {
    await reader.close();
  }
};

const hasError = (issues: { rule: string; severity: string }[]): boolean =>
  issues.some((i) => i.rule === RULE && i.severity === "error");

describe("datapackage/frictionless-structure", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-fds-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("正常な WACZ では error を出さない", async () => {
    const issues = await issuesFor(tmpDir);
    expect(issues.some((i) => i.rule === RULE)).toBe(false);
  });

  it("resources が空配列だと error", async () => {
    const issues = await issuesFor(tmpDir, { mutateResources: () => [] });
    expect(hasError(issues)).toBe(true);
  });

  it("resource に name が無いと error", async () => {
    const issues = await issuesFor(tmpDir, {
      // generator を変えずに malformed resource を作るため、要素型 (typeof r) に
      // 二段キャストする。name を落とした resource を 1 件だけ混ぜる。
      mutateResources: (rs) =>
        rs.map((r, i) =>
          i === 0 ? ({ path: r.path, hash: r.hash, bytes: r.bytes } as unknown as typeof r) : r,
        ),
    });
    expect(hasError(issues)).toBe(true);
  });

  it("resource に path も data も無いと error", async () => {
    const issues = await issuesFor(tmpDir, {
      mutateResources: (rs) =>
        rs.map((r, i) =>
          i === 0 ? ({ name: r.name, hash: r.hash, bytes: r.bytes } as unknown as typeof r) : r,
        ),
    });
    expect(hasError(issues)).toBe(true);
  });

  it("path の代わりに data があれば error にしない", async () => {
    const issues = await issuesFor(tmpDir, {
      mutateResources: (rs) =>
        rs.map((r, i) =>
          i === 0
            ? ({ name: r.name, data: "inline", hash: r.hash, bytes: r.bytes } as unknown as typeof r)
            : r,
        ),
    });
    expect(hasError(issues)).toBe(false);
  });

  it("datapackage.json 不在では error を出さない(profile-required に委譲)", async () => {
    const issues = await issuesFor(tmpDir, { omitDatapackage: true });
    expect(issues.some((i) => i.rule === RULE)).toBe(false);
  });

  it("lenient profile では除外される", async () => {
    const issues = await issuesFor(tmpDir, { mutateResources: () => [] }, "lenient");
    expect(issues.some((i) => i.rule === RULE)).toBe(false);
  });
});
