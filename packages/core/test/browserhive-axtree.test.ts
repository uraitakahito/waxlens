// @module-tag engine
/**
 * `browserhive/axtree-shape` のテスト。
 *
 * この rule が見るのは**中身だけ**。エントリが在るかは
 * `datapackage/resources-complete` が、壊れていないかは
 * `datapackage/resource-hashes` が既に見ているので、ここで重ねて確かめない。
 *
 * 版の条件があるので、素の browserhive profile では走らない —— 版を渡さない
 * ケースを 1 つ置いて、「見ていない」ことが「問題なし」と混ざらないようにする。
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

const RULE = "browserhive/axtree-shape";
const V38 = { major: 3, minor: 8, patch: 0 };

/** profile どおりに刈り込まれたスナップショット。 */
const goodSnapshot = (): Record<string, unknown> => ({
  profile: "browserhive:axtree/1",
  url: "https://www.iana.org/",
  takenAt: "2026-08-22T02:55:56.759Z",
  stage: "after-behaviors",
  devicePixelRatio: 1,
  viewport: { width: 1280, height: 800 },
  nodes: 255,
  tree: [
    {
      role: "RootWebArea",
      name: "Internet Assigned Numbers Authority",
      children: [
        { role: "heading", name: "Domain Names", level: 2 },
        { role: "image", name: "logo", url: "https://www.iana.org/_img/logo.svg" },
      ],
    },
  ],
});

const runFor = async (
  tmpDir: string,
  options: FixtureOptions,
  profile: RuleProfile = "browserhive",
  version: { major: number; minor: number; patch: number } = V38,
): Promise<Issue[]> => {
  const { bytes } = await buildWacz(options);
  const path = join(tmpDir, "fixture.wacz");
  await writeFile(path, bytes);
  const source = parseReportSource(path);
  if (!source.ok || source.value.kind !== "file") throw new Error("unreachable");
  const reader = await WaczReader.open(fileTransport(source.value.path));
  try {
    const result = await runValidation(reader, {
      waxlensVersion: "0.0.0",
      rules: DEFAULT_RULES,
      profile: { name: profile, version },
    });
    if (!result.ok) throw new Error("runValidation returned err — unreachable");
    return result.value.issues.filter((i) => i.rule === RULE);
  } finally {
    await reader.close();
  }
};

describe("browserhive/axtree-shape", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-axtree-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("規則どおりの木には何も言わない", async () => {
    expect(await runFor(tmpDir, { axtree: goodSnapshot() })).toEqual([]);
  });

  it("エントリが無いのは黙って通す(撮っていない capture も正しい)", async () => {
    expect(await runFor(tmpDir, {})).toEqual([]);
  });

  it("JSON として読めない行を報告する", async () => {
    const issues = await runFor(tmpDir, { axtree: "{ではない\n" });
    expect(issues.map((i) => i.messageKey)).toEqual([`${RULE}.not-json`]);
  });

  it("知らない profile の行は、そこで打ち切る", async () => {
    // 版が違えば刈り込み規則も違う。別の規則を当てて「違反」と言うほうが害が大きい。
    const issues = await runFor(tmpDir, {
      axtree: { ...goodSnapshot(), profile: "browserhive:axtree/99", tree: [{ role: "generic" }] },
    });
    expect(issues.map((i) => i.messageKey)).toEqual([`${RULE}.unknown-profile`]);
  });

  it("必須の member が欠けていることを報告する", async () => {
    const withoutUrl = goodSnapshot();
    delete withoutUrl["url"];
    const issues = await runFor(tmpDir, { axtree: withoutUrl });
    expect(issues.map((i) => i.messageKey)).toEqual([`${RULE}.missing-member`]);
  });

  it("この版が許していない property を報告する", async () => {
    // producer が刈り込み規則を変えたのに profile の版を上げなかった、という形。
    const snapshot = goodSnapshot();
    snapshot["tree"] = [{ role: "button", name: "押す", focusable: true }];
    const issues = await runFor(tmpDir, { axtree: snapshot });
    expect(issues.map((i) => i.messageKey)).toEqual([`${RULE}.unknown-property`]);
    expect(issues[0]?.params?.["keys"]).toBe("focusable");
  });

  it("畳まれているはずの role が残っていることを報告する", async () => {
    const snapshot = goodSnapshot();
    snapshot["tree"] = [{ role: "generic", children: [{ role: "link", name: "A" }] }];
    const issues = await runFor(tmpDir, { axtree: snapshot });
    expect(issues.map((i) => i.messageKey)).toEqual([`${RULE}.collapsed-role`]);
  });

  it("深い位置のノードも見る", async () => {
    // 根だけ見て済ませていないこと。木を辿らない実装はここで落ちる。
    const snapshot = goodSnapshot();
    snapshot["tree"] = [
      { role: "main", children: [{ role: "list", children: [{ role: "none" }] }] },
    ];
    const issues = await runFor(tmpDir, { axtree: snapshot });
    expect(issues.map((i) => i.messageKey)).toEqual([`${RULE}.collapsed-role`]);
  });

  it("同じ違反は種類ごとに 1 件へ畳む", async () => {
    // 1 ページに数百ノードあるので、ノードごとに出すと報告が読めなくなる。
    const snapshot = goodSnapshot();
    snapshot["tree"] = [
      { role: "button", focusable: true },
      { role: "link", focusable: true },
      { role: "heading", focusable: true },
    ];
    const issues = await runFor(tmpDir, { axtree: snapshot });
    expect(issues).toHaveLength(1);
  });

  it("3.8.0 未満では走らない", async () => {
    // 走ってしまうと「無い」を毎回報告することになる。走らなかったことは
    // Report.skipped に残るので、読者は「問題なし」と区別できる。
    const snapshot = goodSnapshot();
    snapshot["profile"] = "browserhive:axtree/99";
    const issues = await runFor(tmpDir, { axtree: snapshot }, "browserhive", {
      major: 3,
      minor: 7,
      patch: 0,
    });
    expect(issues).toEqual([]);
  });
});
