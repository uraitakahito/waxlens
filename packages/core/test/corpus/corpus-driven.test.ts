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
 * 未設定 / manifest 不在 / fixtures が LFS ポインタ (実体未取得) のときは
 * **skip** する — corpus 未配置のローカル `pnpm check` を緑に保つため。
 * CI は corpus を clone + `git lfs pull` してから実走させる。
 *
 *   CORPUS_DIR=<corpus の絶対パス> pnpm --filter @waxlens/core test:corpus
 *
 * 読み取り専用。fixtures の生成は build-corpus.test.ts (別ファイル) の責務。
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WaczReader } from "../../src/wacz/reader.js";
import { fileTransport } from "../../src/wacz/transport.js";
import { runValidation } from "../../src/validate/engine.js";
import { DEFAULT_RULES } from "../../src/validate/rules/index.js";
import { ALL_PROFILES, parseReportSource, type RuleProfile } from "../../src/validate/domain.js";
import type { Manifest, ProfileResult } from "./manifest.js";

const LFS_POINTER = "version https://git-lfs.github.com/spec/v1";
const corpusDir = process.env["CORPUS_DIR"];
const root = corpusDir ? resolve(corpusDir) : undefined;

// vitest は it() を同期収集するので、manifest は module top で同期読み。
// 重い validation だけ it() の中 (async) で行う。
const probe = (): { manifest?: Manifest; reason?: string } => {
  if (root === undefined) return { reason: "CORPUS_DIR 未設定" };
  if (!existsSync(join(root, "manifest.json"))) return { reason: `manifest が無い: ${root}` };
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as Manifest;
  const first = manifest.fixtures[0]?.file;
  if (first !== undefined) {
    const head = readFileSync(join(root, first)).subarray(0, LFS_POINTER.length).toString("utf8");
    if (head === LFS_POINTER) return { reason: "fixtures が LFS ポインタ (git lfs pull 未)" };
  }
  return { manifest };
};

const { manifest, reason } = probe();

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
      profile,
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
    it.skip(`skipped: ${reason ?? "corpus 利用不可"}`, () => {
      /* corpus 未配置 — CI 以外では正常に skip */
    });
    return;
  }

  for (const fixture of manifest.fixtures) {
    it(fixture.file, async () => {
      const abs = join(root, fixture.file);
      if (fixture.expect) {
        expect(await validate(abs, manifest.defaultProfile)).toEqual(fixture.expect);
      } else if (fixture.byProfile) {
        for (const profile of ALL_PROFILES) {
          expect(await validate(abs, profile), `${fixture.file} @ ${profile}`).toEqual(
            fixture.byProfile[profile],
          );
        }
      } else {
        throw new Error(`${fixture.file}: manifest entry に expect も byProfile も無い`);
      }
    });
  }
});
