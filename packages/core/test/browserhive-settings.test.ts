// @module-tag engine
/**
 * `browserhive/settings-shape` と `browserhive/blocklist-declared` のテスト。
 *
 * この 2 本が守っているのは 2 つの主張:
 *
 *   1. profile 1.2.0 の必須 member が **揃っている**。この検査が無かったせいで、
 *      1.1.0 の `cache` は「どの実装も書かない必須 member」として何版か残った ——
 *      適合を名乗るアーカイブが必須 member を欠いていても、誰も気づけなかった。
 *   2. `blockUrlPatterns` は **一致が 0 でも在る**。空の配列が「濾していない」と
 *      いう主張の綴りなので、不在と空を混ぜると証憑としての意味が消える。
 *
 * 版の条件があるので古い browserhive のアーカイブでは走らない —— 版を下げた
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

const SHAPE = "browserhive/settings-shape";
/** profile 1.2.0 §settings の「Required: yes」の行。rule の一覧と一致するべきもの。 */
const REQUIRED_MEMBERS = [
  "signature",
  "viewport",
  "devicePixelRatios",
  "session",
  "behaviors",
  "limits",
  "blockUrlPatterns",
] as const;
const BLOCKLIST = "browserhive/blocklist-declared";
const V7 = { major: 7, minor: 0, patch: 0 };

/** browserhive のアーカイブであることを示すだけの最小の目録。 */
const minimalInventory: Record<string, unknown> = {
  profile: "browserhive:storage/1",
  stage: "after-behaviors",
  valuesRecorded: false,
  origins: [],
};

/** profile 1.2.0 どおりの settings。 */
const goodSettings = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  signature: "none",
  viewport: { width: 1280, height: 800 },
  devicePixelRatios: [1],
  session: "isolated",
  behaviors: ["autoscroll"],
  limits: { maxResponseBytes: 20_971_520, maxTaskBytes: 209_715_200 },
  blockUrlPatterns: [],
  ...over,
});

/** `goodSettings()` から member を 1 つ落とした形。 */
const settingsWithout = (member: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(goodSettings()).filter(([k]) => k !== member));

const runFor = async (
  tmpDir: string,
  options: FixtureOptions,
  rule: string,
  profile: RuleProfile = "browserhive",
  version: { major: number; minor: number; patch: number } = V7,
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
    return result.value.issues.filter((i) => i.rule === rule);
  } finally {
    await reader.close();
  }
};

describe("browserhive/settings-shape", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-settings-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const run = (options: FixtureOptions, version?: typeof V7): Promise<Issue[]> =>
    runFor(tmpDir, options, SHAPE, "browserhive", version);

  it("profile どおりの settings には何も言わない", async () => {
    expect(await run({ settings: goodSettings() })).toEqual([]);
  });

  it("settings ごと無ければ落とす", async () => {
    // browserhive のアーカイブであることは storage で示し、settings だけを落とす。
    // 両方無いと `browserhive:capture` 自体が現れず、その場合この profile の MUST を
    // 当てる相手が居ない —— 「browserhive のアーカイブではない」が正しい読み。
    const issues = await run({ storage: minimalInventory });
    expect(issues.map((i) => i.messageKey)).toEqual([`${SHAPE}.missing`]);
  });

  /**
   * **これが 1.1.0 で起きたこと。** 必須 member を 1 つ落としたまま適合を
   * 名乗れてしまう状態が、この rule が無い間ずっと続いていた。
   *
   * 7 つを 1 つずつ回すのは、必須一覧そのものを固定するため。1 つだけ試すと、
   * 一覧から別の member を外しても緑のまま通る —— 一覧がこの rule の契約なので、
   * 全要素が反証可能でなければ意味がない。
   */
  it.each(REQUIRED_MEMBERS)("必須 member %s を落としたら落とす", async (member) => {
    const issues = await run({ settings: settingsWithout(member) });
    expect(issues.map((i) => i.messageKey)).toContain(`${SHAPE}.missing-member`);
    expect(issues.map((i) => i.params?.["member"])).toContain(member);
  });

  it("型が違えば落とす", async () => {
    const issues = await run({ settings: goodSettings({ devicePixelRatios: "1" }) });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.messageKey).toBe(`${SHAPE}.wrong-type`);
    expect(issues[0]?.params?.["member"]).toBe("devicePixelRatios");
  });

  it("acceptLanguage は任意なので、無くても何も言わない", async () => {
    expect(await run({ settings: goodSettings() })).toEqual([]);
  });

  it("7.0.0 未満の browserhive では走らない", async () => {
    expect(
      await run({ settings: settingsWithout("session") }, { major: 6, minor: 9, patch: 9 }),
    ).toEqual([]);
  });
});

describe("browserhive/blocklist-declared", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-blocklist-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const run = (options: FixtureOptions, version?: typeof V7): Promise<Issue[]> =>
    runFor(tmpDir, options, BLOCKLIST, "browserhive", version);

  /**
   * **この rule の要。** 空の配列は「効いていたパターンが無い」という積極的な
   * 主張なので、通さなければならない。落とすと、正しく申告したアーカイブが
   * 罰せられる。
   */
  it("空の配列を通す —— それが「濾していない」の綴り", async () => {
    expect(await run({ settings: goodSettings({ blockUrlPatterns: [] }) })).toEqual([]);
  });

  it("パターンが並んでいても通す", async () => {
    expect(
      await run({
        settings: goodSettings({
          blockUrlPatterns: ["*://*.google-analytics.com/*", "*://*.doubleclick.net/*"],
        }),
      }),
    ).toEqual([]);
  });

  /**
   * 不在と空は別物。不在は何も述べていないので落とす —— 読み手は
   * 「何も要求しなかったページ」と「記録しないことにした取り込み」を
   * 区別できないままになる。
   */
  it("member ごと無ければ落とす", async () => {
    const issues = await run({ settings: settingsWithout("blockUrlPatterns") });
    expect(issues.map((i) => i.messageKey)).toEqual([`${BLOCKLIST}.absent`]);
  });

  it("配列でなければ落とす", async () => {
    const issues = await run({ settings: goodSettings({ blockUrlPatterns: "*://*/*" }) });
    expect(issues.map((i) => i.messageKey)).toEqual([`${BLOCKLIST}.not-array`]);
  });

  it("文字列でない要素があれば落とす", async () => {
    const issues = await run({ settings: goodSettings({ blockUrlPatterns: [1, "*://*/*", null] }) });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.messageKey).toBe(`${BLOCKLIST}.non-string-entry`);
    expect(issues[0]?.params?.["count"]).toBe("2");
  });

  it("7.0.0 未満の browserhive では走らない", async () => {
    expect(
      await run({ settings: settingsWithout("blockUrlPatterns") }, { major: 6, minor: 9, patch: 9 }),
    ).toEqual([]);
  });
});
