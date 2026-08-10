// @module-tag corpus
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

const DATAPACKAGE_ENTRY = "datapackage.json";

/**
 * 絶対パスの fixture を開く。`fileTransport` は branded な `AbsolutePath` しか
 * 受けないので、その変換 (と失敗の潰し方) をここ 1 箇所に閉じる。
 */
const openFixture = async (absPath: string): Promise<WaczReader> => {
  const source = parseReportSource(absPath);
  if (!source.ok || source.value.kind !== "file") {
    throw new Error(`unreachable: ${absPath} did not parse as a file source`);
  }
  return WaczReader.open(fileTransport(source.value.path));
};

/**
 * 標本が宣言する `$schema` を、書き出した WACZ から実測する。
 *
 * 生成元の `spec.options` ではなく成果物から読む — manifest の `issues` と
 * 同じで、記録するのは「宣言したつもり」ではなく「実際に入っているもの」。
 * descriptor 不在 (datapackage-absent) / JSON として読めない / `$schema` が
 * 文字列でない、はすべて `null` に落とす。ここは観測であって検査ではないので、
 * 理由の区別は rule 側 (datapackage/*) の責務。
 *
 * `parseDatapackage()` は使わない。あれは permissive な shape 変換で失敗を
 * `null` に潰すが、ここで欲しいのは「ファイルに何と書いてあるか」なので生の
 * `JSON.parse` が正しい層。
 */
const declaredSchema = async (absPath: string): Promise<string | null> => {
  const reader = await openFixture(absPath);
  try {
    const buf = await reader.readEntry(DATAPACKAGE_ENTRY);
    if (buf === undefined) return null;
    const raw: unknown = JSON.parse(buf.toString("utf8"));
    if (typeof raw !== "object" || raw === null) return null;
    const value = (raw as Record<string, unknown>)["$schema"];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  } finally {
    await reader.close();
  }
};

const validateFixture = async (absPath: string, profile: RuleProfile): Promise<ProfileResult> => {
  const reader = await openFixture(absPath);
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

        // 何を名乗っているか (Data Package v2 の `$schema`)。宣言が無ければ null。
        const $schema = await declaredSchema(abs);

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
            ? { file: rel, description: spec.description, $schema, expect: byProfile["spec"] }
            : { file: rel, description: spec.description, $schema, byProfile },
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
