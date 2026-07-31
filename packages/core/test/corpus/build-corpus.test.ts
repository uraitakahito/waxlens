/**
 * waxlens-corpus 生成エントリ (案 3)。
 *
 * `CORPUS_DIR` が指す repo に `fixtures/*.wacz` と `manifest.json` を
 * 書き出す。 各 fixture は `spec.ts` の宣言に従って生成し、 さらに
 * **3 profile (spec / browserhive / lenient) で実際に runValidation** して
 * 結果を manifest に記録する。 manifest の `issues` は手書きではなく
 * waxlens の実出力なので嘘が入らない。 加えて `spec.expectRules ⊆ 実結果`
 * を assert し、 意図した rule をちゃんと踏むかも保証する。
 *
 * `CORPUS_DIR` 未設定時は skip するので、 通常の `pnpm check` (= vitest
 * run) には影響しない。 生成は明示的に:
 *
 *     CORPUS_DIR="$(cd ../waxlens-corpus && pwd)" pnpm --filter @waxlens/core corpus:build
 *
 * **絶対パスで渡すこと。** `pnpm --filter` は cwd を packages/core にして走らせる
 * ので、 相対パスはそこ基準で解決される (`../waxlens-corpus` は
 * `packages/waxlens-corpus` になり、 何も見つからず skip する)。 しかもこの
 * script は fixtures を丸ごと削除してから書き直すので、 パスの誤りは
 * 「何も起きない」で済まない可能性がある。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildWaczToFile } from "../fixtures/generator.js";
import { WaczReader } from "../../src/wacz/reader.js";
import { fileTransport } from "../../src/wacz/transport.js";
import { runValidation } from "../../src/validate/engine.js";
import { DEFAULT_RULES } from "../../src/validate/rules/index.js";
import { ALL_PROFILES, parseReportSource, type RuleProfile } from "../../src/validate/domain.js";
import { CORPUS } from "./spec.js";
import { corpusRoot } from "./corpus-dir.js";
import type { ProfileResult } from "./manifest.js";

const corpusRootDir = corpusRoot();

const validateFixture = async (absPath: string, profile: RuleProfile): Promise<ProfileResult> => {
  const sourceResult = parseReportSource(absPath);
  if (!sourceResult.ok || sourceResult.value.kind !== "file") {
    throw new Error(`unreachable: ${absPath} did not parse as a file source`);
  }
  const reader = await WaczReader.open(fileTransport(sourceResult.value.path));
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

/**
 * profile 横断の比較用に安定キー化 (issue を rule+severity でソート)。
 *
 * 区切りは NUL。rule 名にも severity 名にも現れない文字なので
 * ("a", "b:c") と ("a:b", "c") のようなキーの衝突が起きない。ソースには
 * 必ず `\u0000` エスケープで書くこと — 生バイトを埋めると git がファイル
 * 全体を binary と判定し、diff も blame も grep も効かなくなる。
 */
const stableKey = (r: ProfileResult): string =>
  JSON.stringify({
    valid: r.valid,
    issues: [...r.issues].sort((a, b) =>
      `${a.rule}\u0000${a.severity}`.localeCompare(`${b.rule}\u0000${b.severity}`),
    ),
  });

describe.skipIf(corpusRootDir === undefined)("build-corpus", () => {
  it(
    "generates fixtures + manifest into CORPUS_DIR, self-validating each",
    async () => {
      const out = corpusRootDir ?? "";
      await rm(join(out, "fixtures"), { recursive: true, force: true });
      await mkdir(join(out, "fixtures"), { recursive: true });

      const entries: unknown[] = [];

      for (const spec of CORPUS) {
        const rel = `fixtures/${spec.name}.wacz`;
        const abs = join(out, rel);
        await buildWaczToFile(abs, spec.options);

        // 3 profile で実 validation。
        const byProfile: Record<string, ProfileResult> = {};
        for (const profile of ALL_PROFILES) {
          byProfile[profile] = await validateFixture(abs, profile);
        }

        // 意図チェック: spec profile で expectRules が全て発火しているか。
        const specRules = new Set(byProfile["spec"]?.issues.map((i) => i.rule));
        for (const want of spec.expectRules) {
          expect(
            specRules.has(want),
            `${spec.name}: expected rule "${want}" under spec, got [${[...specRules].join(", ")}]`,
          ).toBe(true);
        }
        // 黄金 (expectRules 空) は spec profile で valid であること。
        if (spec.expectRules.length === 0) {
          expect(byProfile["spec"]?.valid, `${spec.name}: golden should be valid`).toBe(true);
        }

        // 3 profile が同一なら expect 1 本、違えば byProfile。
        const keys = ALL_PROFILES.map((p) => stableKey(byProfile[p]!));
        const uniform = keys.every((k) => k === keys[0]);
        entries.push(
          uniform
            ? { file: rel, description: spec.description, expect: byProfile["spec"] }
            : { file: rel, description: spec.description, byProfile },
        );
      }

      expect(entries.length).toBe(CORPUS.length);

      const manifest = {
        generatedBy: "waxlens / build-corpus",
        defaultProfile: "spec",
        fixtures: entries,
      };
      await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    },
    120_000,
  );
});
