// @module-tag engine
/**
 * `browserhive/dismissal-shape` のテスト。
 *
 * この rule が守っているのは 2 つの主張で、どちらも**結果が反証できるか**に関わる。
 *
 *   1. `selectors` と `heuristic` は、何も取り除かなかった取り込みにも在る。
 *      空の `removedSelectors` は、20 本探した場合でも 1 本も探さなかった場合でも
 *      同じに読める —— 入力が隣に無ければ、読み手は「そもそも探したのか」を
 *      アーカイブから確かめられない。
 *   2. `unreadable` と結果は同居しない。遂行できなかった除去は何も観測していないので、
 *      隣に空の結果を書けば「ページはバナーを持たなかった」という、その取り込みが
 *      稼いでいない主張になる。
 *
 * **不在は違反ではない。** 除去を試みなかった取り込みでは member ごと書かないのが
 * 正しい形で、不在は「配信されたままのページを保存した」を意味する。ここを
 * 必須にすると、その意味が消える。
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

const RULE = "browserhive/dismissal-shape";
/** profile 1.4.0 §dismissal の「Required: yes」の行。rule の一覧と一致するべきもの。 */
const REQUIRED_MEMBERS = ["selectors", "heuristic"] as const;
/** `unreadable` と並べてはならない observation の member。 */
const OUTCOME_MEMBERS = [
  "framework",
  "removedSelectors",
  "unusableSelectors",
  "removedOverlays",
] as const;
const V85 = { major: 8, minor: 5, patch: 0 };

/** browserhive のアーカイブであることを示すだけの最小の目録。 */
const minimalInventory: Record<string, unknown> = {
  profile: "browserhive:storage/1",
  stage: "after-behaviors",
  valuesRecorded: false,
  origins: [],
};

/** profile 1.4.0 どおりの dismissal。 */
const goodDismissal = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  selectors: [{ framework: "OneTrust", selector: "#onetrust-banner-sdk" }],
  heuristic: { enabled: true, minViewportCoverageRatio: 0.3, minZIndex: 1000 },
  framework: "OneTrust",
  removedSelectors: ["#onetrust-banner-sdk"],
  unusableSelectors: [],
  removedOverlays: 0,
  devicePixelRatio: 1,
  ...over,
});

const dismissalWithout = (member: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(goodDismissal()).filter(([k]) => k !== member));

const runFor = async (
  tmpDir: string,
  options: FixtureOptions,
  profile: RuleProfile = "browserhive",
  version: { major: number; minor: number; patch: number } = V85,
): Promise<Issue[]> => {
  const { bytes } = await buildWacz(options);
  const path = join(tmpDir, "fixture.wacz");
  await writeFile(path, bytes);
  const source = parseReportSource(path);
  if (!source.ok || source.value.kind !== "file") throw new Error("unreachable");
  const reader = await WaczReader.open(fileTransport(source.value.path));
  try {
    const result = await runValidation(reader, {
      validatorVersion: "0.0.0",
      rules: DEFAULT_RULES,
      profile: { name: profile, version },
    });
    if (!result.ok) throw new Error("runValidation returned err — unreachable");
    return result.value.issues.filter((i) => i.rule === RULE);
  } finally {
    await reader.close();
  }
};

describe("browserhive/dismissal-shape", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "wacz-validator-dismissal-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const run = (options: FixtureOptions, version?: typeof V85): Promise<Issue[]> =>
    runFor(tmpDir, { storage: minimalInventory, ...options }, "browserhive", version);

  it("profile どおりの dismissal には何も言わない", async () => {
    expect(await run({ dismissal: goodDismissal() })).toEqual([]);
  });

  /**
   * **不在は違反ではない。** 除去を試みなかった取り込みでは member ごと書かないのが
   * 正しく、不在は「配信されたままのページを保存した」を意味する。ここで落とすと、
   * 除去を頼まない取り込みが軒並み不適合になる。
   */
  it("除去を試みなかったアーカイブには何も言わない", async () => {
    expect(await run({})).toEqual([]);
  });

  it("dismissal がオブジェクトでなければ落とす", async () => {
    const issues = await run({ dismissal: ["nope"] as unknown as Record<string, unknown> });
    expect(issues.map((i) => i.messageKey)).toEqual([`${RULE}.not-object`]);
    expect(issues[0]?.params?.["found"]).toBe("array");
  });

  /**
   * 2 つを 1 つずつ回すのは、必須一覧そのものを固定するため。1 つだけ試すと、
   * 一覧から別の member を外しても緑のまま通る —— 一覧がこの rule の契約なので、
   * 全要素が反証可能でなければ意味がない。
   */
  it.each(REQUIRED_MEMBERS)("入力の member %s を落としたら落とす", async (member) => {
    const issues = await run({ dismissal: dismissalWithout(member) });
    expect(issues.map((i) => i.messageKey)).toContain(`${RULE}.missing-member`);
    expect(issues.map((i) => i.params?.["member"])).toContain(member);
  });

  /**
   * **当たりが 0 でも入力は書く。** これがこの rule の存在理由そのもの ——
   * 効いていた選択子が無ければ、空の取り除きは「探したが無かった」と
   * 「何も探さなかった」のどちらとも読めてしまう。
   */
  it("何も取り除かなかった形でも、入力が在れば通す", async () => {
    const issues = await run({
      dismissal: goodDismissal({
        framework: null,
        removedSelectors: [],
        removedOverlays: 0,
      }),
    });
    expect(issues).toEqual([]);
  });

  it.each(REQUIRED_MEMBERS)("入力の member %s の型が違えば落とす", async (member) => {
    const issues = await run({ dismissal: goodDismissal({ [member]: "文字列" }) });
    expect(issues.map((i) => i.messageKey)).toContain(`${RULE}.wrong-type`);
    expect(issues.map((i) => i.params?.["found"])).toContain("string");
  });

  it("unreadable だけを述べる形は通す", async () => {
    const issues = await run({
      dismissal: {
        selectors: [{ framework: "OneTrust", selector: "#onetrust-banner-sdk" }],
        heuristic: { enabled: true, minViewportCoverageRatio: 0.3, minZIndex: 1000 },
        devicePixelRatio: 1,
        unreadable: true,
      },
    });
    expect(issues).toEqual([]);
  });

  /**
   * **遂行できなかった除去は何も観測していない。** 隣に空の結果を書くことは
   * 「ページはバナーを持たなかった」という主張になる。`storage` の
   * 「両方の area を持つか unreadable: true のどちらか」と同じ形。
   *
   * 4 つを 1 つずつ回すのは、observation の一覧そのものを固定するため。
   */
  it.each(OUTCOME_MEMBERS)("unreadable と %s を並べたら落とす", async (member) => {
    const issues = await run({
      dismissal: {
        selectors: [],
        heuristic: { enabled: false, minViewportCoverageRatio: 0.3, minZIndex: 1000 },
        unreadable: true,
        [member]: member === "removedOverlays" ? 0 : member === "framework" ? null : [],
      },
    });
    expect(issues.map((i) => i.messageKey)).toContain(`${RULE}.unreadable-with-outcome`);
    expect(issues.map((i) => i.params?.["members"])).toContain(member);
  });

  /**
   * 版の下限。`dismissal` は browserhive 8.5.0 で入ったので、それ未満の
   * アーカイブに 1.4.0 の MUST を当てて落とすのは検証器として誤り。
   */
  it("8.5.0 未満のアーカイブには当てない", async () => {
    const broken = { selectors: [] };
    // 8.5.0 なら落ちる形であることを先に確かめる。落ちない形で版だけ下げても、
    // 「見ていない」と「問題なし」が区別できない。
    expect((await run({ dismissal: broken })).length).toBeGreaterThan(0);
    expect(
      await run({ dismissal: broken }, { major: 8, minor: 4, patch: 0 }),
    ).toEqual([]);
  });
});
