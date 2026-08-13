// @module-tag corpus
// @module-tag engine
/**
 * corpus-driven 回帰テスト。
 *
 * waxlens-corpus の `manifest.json` をループし、committed な
 * `fixtures/*.wacz` (Git LFS) を waxlens で validation して、実出力が
 * manifest の期待 (`expect` または `byProfile`) と完全一致するか assert
 * する。既存 `validate.test.ts` がその場生成して個別 rule を見るのに対し、
 * こちらは「凍結された WACZ bytes が凍結された期待レポートを生む」ことを
 * locking し、severity の変化や発火消失といった出力 drift を捕まえる。
 *
 * corpus の場所は `CORPUS_DIR` env で渡す (生成側 build-corpus と対称)。
 * 未設定 / manifest 不在 / manifest が古い / fixtures が LFS ポインタ
 * (実体未取得) のときは **skip** する — corpus 未配置のローカル `pnpm check`
 * を緑に保つため。CI は corpus を clone + `git lfs pull` してから実走させる。
 * skip の理由はテスト名ではなく注釈に載るので、名前は環境で変わらない。
 *
 *   CORPUS_DIR=<corpus の絶対パス> pnpm --filter @waxlens/core test:corpus
 *
 * 各 fixture には manifest の `description` (意図) と実際の validation 結果を
 * 注釈する。テスト名は fixture のファイル名だけなので、失敗したときに何を
 * 検証していたのかがそこからは読めないため。
 *
 * 読み取り専用。fixtures の生成は build-corpus.test.ts (別ファイル) の責務。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WaczReader } from "../../src/wacz/reader.js";
import { fileTransport } from "../../src/wacz/transport.js";
import { runValidation } from "../../src/validate/engine.js";
import { DEFAULT_RULES } from "../../src/validate/rules/index.js";
import { ALL_PROFILES, parseReportSource, type RuleProfile } from "../../src/validate/domain.js";
import type { Manifest, ProfileResult } from "./manifest.js";
import { corpusRoot } from "./corpus-dir.js";
import { assertPinnedCorpus } from "./corpus-version.js";

const LFS_POINTER = "version https://git-lfs.github.com/spec/v1";
const root = corpusRoot();

// vitest は it() を同期収集するので、manifest は module top で同期読み。
// 重い validation だけ it() の中 (async) で行う。
const probe = (): { manifest?: Manifest; reason?: string } => {
  if (root === undefined) return { reason: "CORPUS_DIR 未設定" };
  // バージョンずれは skip ではなく throw。以降の「期待値が合わない」より、渡された
  // corpus が固定先と違うことを先に名指しするほうが早い。
  assertPinnedCorpus(root);
  if (!existsSync(join(root, "manifest.json"))) return { reason: `manifest が無い: ${root}` };
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as Manifest;
  // description は型では必須だが、上は検査なしのキャスト。corpus を古い
  // commit で掴むと undefined のまま注釈されるので、ここで止める。
  const undescribed = manifest.fixtures.filter((f) => typeof f.description !== "string");
  if (undescribed.length > 0) {
    return {
      reason: `manifest が古い (description 無し ${String(undescribed.length)} 件) — corpus:build 要`,
    };
  }
  // `$schema` は「宣言が無い」ことを null で明示する。キーごと無ければ、記録
  // より前の corpus:build が書いた古い manifest を掴んでいる。expect /
  // byProfile しか読まないこのテストは、それでも緑になってしまうので止める。
  const unrecorded = manifest.fixtures.filter((f) => !("$schema" in f));
  if (unrecorded.length > 0) {
    return {
      reason: `manifest が古い ($schema 未記録 ${String(unrecorded.length)} 件) — corpus:build 要`,
    };
  }
  const first = manifest.fixtures[0]?.file;
  if (first !== undefined) {
    const head = readFileSync(join(root, first)).subarray(0, LFS_POINTER.length).toString("utf8");
    if (head === LFS_POINTER) return { reason: "fixtures が LFS ポインタ (git lfs pull 未)" };
  }
  return { manifest };
};

const { manifest, reason } = probe();

/**
 * issue 配列を 1 行に潰す。`toEqual` の diff は入れ子が深く、rule が複数
 * あると「何が増えて何が消えたか」を読み取りにくい。注釈は 1 行で全体像を
 * 示す役に徹する (詳細は assert の diff が持つ)。
 */
const summarize = (result: ProfileResult): string =>
  result.issues.length === 0
    ? `valid=${String(result.valid)} issues=none`
    : `valid=${String(result.valid)} ` +
      result.issues.map((i) => `${i.rule}:${i.severity}`).join(" ");

const validate = async (absPath: string, profile: RuleProfile): Promise<ProfileResult> => {
  const parsed = parseReportSource(absPath);
  if (!parsed.ok || parsed.value.kind !== "file") {
    throw new Error(`unreachable: ${absPath} did not parse as a file source`);
  }
  const reader = await WaczReader.open(fileTransport(parsed.value.path));
  try {
    const result = await runValidation(reader, {
      waxlensVersion: "0.0.0",
      rules: DEFAULT_RULES,
      profile: { name: profile },
    });
    if (!result.ok) throw new Error("runValidation returned err — unreachable");
    return {
      valid: result.value.valid,
      issues: result.value.issues.map((i) => ({ rule: i.rule, severity: i.severity })),
    };
  } finally {
    await reader.close();
  }
};

describe("waxlens-corpus regression", () => {
  if (manifest === undefined || root === undefined) {
    // 理由はテスト名ではなく注釈と skip の第 2 引数に載せる。名前に埋めると
    // 環境ごとにテスト名が変わり、名前で追跡するツールから別のテストに見える。
    // it.skip ではコールバックが走らず annotate できないので、走らせてから
    // 降りる — skip 済みのテストでも注釈は保持される。
    it("corpus が無いためスキップ", async (ctx) => {
      const why = reason ?? "corpus 利用不可";
      await ctx.annotate(why, "corpus");
      ctx.skip(true, why);
    });
    return;
  }

  for (const fixture of manifest.fixtures) {
    it(fixture.file, async ({ annotate }) => {
      // 何のための fixture か。テスト名はファイル名だけなので、これが無いと
      // manifest を開くまで意図がわからない。assert より前に置く — 失敗して
      // throw すると後続の annotate は実行されず、最も必要な瞬間に失われる。
      await annotate(fixture.description, "intent");

      const abs = join(root, fixture.file);
      if (fixture.expect) {
        const actual = await validate(abs, manifest.defaultProfile);
        await annotate(`${manifest.defaultProfile}: ${summarize(actual)}`, "result");
        expect(actual).toEqual(fixture.expect);
      } else if (fixture.byProfile) {
        for (const profile of ALL_PROFILES) {
          const actual = await validate(abs, profile);
          await annotate(`${profile}: ${summarize(actual)}`, "result");
          expect(actual, `${fixture.file} @ ${profile}`).toEqual(fixture.byProfile[profile]);
        }
      } else {
        throw new Error(`${fixture.file}: manifest entry に expect も byProfile も無い`);
      }
    });
  }
});
