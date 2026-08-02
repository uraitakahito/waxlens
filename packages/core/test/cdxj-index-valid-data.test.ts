// @module-tag cdxj
/**
 * `cdxj/index-valid-data`(MUST/error)のテスト。
 *
 * WACZ 1.1.1 §5.2.2「Index files MUST contain CDXJ data」を強制する。
 * `indexes/*.cdxj`(平文)を parseCdxj に通し、CDXJ として読めない行を
 * error にする。検出は既存 parseCdxj の errors を消費するだけ。
 *
 * このルールは、従来 `cdxj/filename-archive-relative` に紛れ込んでいた
 * parse-error 報告を引き取ったもの(単一責務化)。そのため:
 *   - 非CDXJ の index.cdxj は cdxj/index-valid-data が error にする
 *   - 同じ行を cdxj/filename-archive-relative が二重に報告しない(dedup)
 *   - §5.2.2 は MUST なので lenient profile でも error のまま
 *
 * ハーネスは frictionless-structure.test.ts と同形。rule を直接 import せず、
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

const RULE = "cdxj/index-valid-data";

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

describe("cdxj/index-valid-data", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-civd-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("正常な CDXJ では error を出さない", async () => {
    const issues = await issuesFor(tmpDir);
    expect(issues.some((i) => i.rule === RULE)).toBe(false);
  });

  it("indexes/index.cdxj の中身が CDXJ でないと error", async () => {
    const issues = await issuesFor(tmpDir, { cdxjOverride: "this is not cdxj data\n" });
    expect(hasError(issues)).toBe(true);
  });

  it("空白の無い 1 トークン行(missing-fields)でも error", async () => {
    const issues = await issuesFor(tmpDir, { cdxjOverride: "garbage\n" });
    expect(hasError(issues)).toBe(true);
  });

  it("§5.2.2 は MUST なので lenient profile でも error のまま", async () => {
    const issues = await issuesFor(tmpDir, { cdxjOverride: "not cdxj at all\n" }, "lenient");
    expect(hasError(issues)).toBe(true);
  });

  it("非CDXJ の行は cdxj/filename-archive-relative では二重報告されない(責務分離)", async () => {
    const issues = await issuesFor(tmpDir, { cdxjOverride: "not cdxj at all\n" });
    // parse-validity は cdxj/index-valid-data の専任。filename rule は
    // entries が空なので何も出さない(従来の .parse-error 二重報告が消えた)。
    expect(issues.some((i) => i.rule === "cdxj/filename-archive-relative")).toBe(false);
  });

  // ── §5.2.2 後半「MAY be gzip compressed」: gzip された index の中身検証 ──

  it("webrecorder の index.cdx.gz が gunzip して非CDXJ なら error", async () => {
    // producer: webrecorder は index.cdx.gz + index.idx(cdxj-gzip-1.0)を出す。
    // cdxjOverride で本文を非CDXJ にすると、.cdx.gz は gunzip 後に parse 失敗。
    const issues = await issuesFor(tmpDir, {
      producer: "webrecorder",
      cdxjOverride: "not cdxj at all\n",
    });
    expect(hasError(issues)).toBe(true);
  });

  it("正常な gzip index(good-webrecorder 相当)では error を出さない", async () => {
    const issues = await issuesFor(tmpDir, { producer: "webrecorder" });
    expect(issues.some((i) => i.rule === RULE)).toBe(false);
  });

  it("gzip と名乗るのに展開できなければ error(gzip-error)", async () => {
    const issues = await issuesFor(tmpDir, { cdxjGzipBroken: true });
    expect(hasError(issues)).toBe(true);
  });
});
