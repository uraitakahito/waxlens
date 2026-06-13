/**
 * `warc/recording-complete`(info/warning · browserhive profile 限定)のテスト。
 *
 * browserhive は失敗/未完了の HTTP やり取りを WARC の `WARC-Type: metadata`
 * レコード(`application/warc-fields` body: `incomplete: true` / `reason: ...`)
 * として記録する。本ルールはそれを数えて可視化する — ただし規格外の
 * producer 慣習なので `--profile browserhive` のときだけ走る(spec/lenient は
 * `excludeProfiles` で除外)。
 *
 * generator の `warcIncompleteRecords` で metadata レコードを n 件注入する。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseReportSource, type Issue, type RuleProfile } from "../src/validate/domain.js";
import { runValidation } from "../src/validate/engine.js";
import { DEFAULT_RULES } from "../src/validate/rules/index.js";
import { fileTransport } from "../src/wacz/transport.js";
import { WaczReader } from "../src/wacz/reader.js";
import { buildWacz, type FixtureOptions } from "./fixtures/generator.js";

const RULE = "warc/recording-complete";

const issuesFor = async (
  tmpDir: string,
  options: FixtureOptions = {},
  profile: RuleProfile = "browserhive",
): Promise<Issue[]> => {
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
    return result.value.issues;
  } finally {
    await reader.close();
  }
};

describe("warc/recording-complete", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-rec-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("browserhive profile: 未完了 metadata を warning で出し、件数を details に載せる", async () => {
    const issues = await issuesFor(tmpDir, { warcIncompleteRecords: 30 }, "browserhive");
    const hit = issues.find((i) => i.rule === RULE);
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("warning"); // responses 0 / incomplete 30 → 100% > 10%
    const recording = (hit?.details as { recording?: { incomplete?: number } } | undefined)?.recording;
    expect(recording?.incomplete).toBe(30);
  });

  it("metadata が無ければ何も出さない", async () => {
    const issues = await issuesFor(tmpDir, {}, "browserhive");
    expect(issues.some((i) => i.rule === RULE)).toBe(false);
  });

  it("spec / lenient profile では除外され出ない", async () => {
    for (const profile of ["spec", "lenient"] as const) {
      const issues = await issuesFor(tmpDir, { warcIncompleteRecords: 30 }, profile);
      expect(issues.some((i) => i.rule === RULE)).toBe(false);
    }
  });

  it("resourceType / blockedReason を byResourceType / byBlockedReason に集計する", async () => {
    const issues = await issuesFor(
      tmpDir,
      {
        warcIncompleteSpec: [
          { resourceType: "Image" },
          { resourceType: "Image" },
          { resourceType: "Script", blockedReason: "inspector" },
        ],
      },
      "browserhive",
    );
    const recording = (
      issues.find((i) => i.rule === RULE)?.details as
        | {
            recording?: {
              byResourceType?: Record<string, number>;
              byBlockedReason?: Record<string, number>;
            };
          }
        | undefined
    )?.recording;
    expect(recording?.byResourceType).toEqual({ Image: 2, Script: 1 });
    expect(recording?.byBlockedReason).toEqual({ inspector: 1 });
  });
});
