#!/usr/bin/env node
/**
 * `waxlens-validate` — validation engine の CLI。
 *
 * machine-readable な surface のみ: 単一の positional `<file>`、rule
 * profile selector、stdout への JSON 出力。human-readable な
 * rendering (色、expandable な詳細) は `@waxlens/tui` の `waxlens`
 * bin にあり、そちらがこの package を library としてインポートして
 * 消費する。
 *
 * Exit codes (`exitCodeFor` が単一情報源):
 *   0 — validation 成功 (error 重大度の issue なし)
 *   1 — validation 失敗 (error 重大度の issue が 1 件以上)
 *   2 — operational な失敗 (ファイルが開けない等)
 *
 * 副作用の責務分担:
 *   - `runCli`  outcome を組み立てるだけ (純粋関数寄り; reader の
 *                close は `finally` で行う I/O のみ)
 *   - action    stderr / stdout / `process.exitCode` をここで集約
 *
 * これによって "exit code は何番" を CLI コードに散らさず
 * `exitCodeFor` の switch だけが知る。bin 名 prefix
 * (`waxlens-validate:`) も `runCli` ではなくこの bin の action 内に
 * 留まる — `@waxlens/tui` の bin が `waxlens:` を使う設計と対称。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import { exitCodeFor, type CliOutcome } from "./cli-outcome.js";
import { renderJson } from "./render/json.js";
import { DEFAULT_PROFILE, runValidation } from "./validate/engine.js";
import { DEFAULT_RULES } from "./validate/rules/index.js";
import type { RuleProfile } from "./validate/types.js";
import { ALL_PROFILES } from "./validate/types.js";
import { WaczReader } from "./wacz/reader.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { version: string };

interface CliOptions {
  profile: RuleProfile;
}

const parseProfile = (raw: string): RuleProfile => {
  if ((ALL_PROFILES as readonly string[]).includes(raw)) return raw as RuleProfile;
  throw new InvalidArgumentError(`Unknown profile "${raw}". Valid: ${ALL_PROFILES.join(", ")}.`);
};

const program = new Command();
program
  .name("waxlens-validate")
  .description("WACZ validator — emits a machine-readable JSON report to stdout")
  .version(manifest.version)
  .argument("<file>", "Path to the .wacz file to validate")
  .option(
    "--profile <name>",
    `Rule profile (${ALL_PROFILES.join(" | ")}). Defaults to "${DEFAULT_PROFILE}".`,
    parseProfile,
    DEFAULT_PROFILE,
  )
  .action(async (filePath: string, options: CliOptions) => {
    const outcome = await runCli(filePath, options);
    dispatch(outcome);
    // `process.exit(N)` ではなく `process.exitCode` をセットすることで、
    // stdout の同期 flush と `parseAsync` の Promise の clean な resolve
    // を保証しつつ、Node が event loop drain で自然終了するときに正しい
    // exit code を返す。`runCli` は `reader.close()` を `finally` で
    // await しているので、外側に lingering handle は残らない。
    process.exitCode = exitCodeFor(outcome);
  });

await program.parseAsync(process.argv);

/**
 * outcome に従って副作用 (stdout / stderr) を発火する。exit code は
 * 呼び出し側で `exitCodeFor` を使うので、ここでは触らない。
 *
 * `engineFailed` は `Result<Report, never>` から narrowing のためだけに
 * 生まれる variant で、論理的には到達不能。万一来たら silent (stderr
 * 出さない) のまま exit code 2 になる — 現状の挙動と同じ。
 */
function dispatch(outcome: CliOutcome): void {
  switch (outcome.kind) {
    case "valid":
    case "invalid":
      process.stdout.write(renderJson(outcome.report));
      return;
    case "openFailed": {
      const message =
        outcome.cause instanceof Error ? outcome.cause.message : String(outcome.cause);
      process.stderr.write(`waxlens-validate: cannot open "${outcome.filePath}": ${message}\n`);
      return;
    }
    case "engineFailed":
      return;
  }
}

async function runCli(filePath: string, opts: CliOptions): Promise<CliOutcome> {
  const absolutePath = resolve(filePath);

  let reader: WaczReader;
  try {
    reader = await WaczReader.open(absolutePath);
  } catch (cause) {
    return { kind: "openFailed", filePath, cause };
  }

  try {
    const result = await runValidation(reader, {
      file: filePath,
      waxlensVersion: manifest.version,
      rules: DEFAULT_RULES,
      profile: opts.profile,
    });
    if (!result.ok) return { kind: "engineFailed" };
    const report = result.value;

    return report.valid ? { kind: "valid", report } : { kind: "invalid", report };
  } finally {
    await reader.close();
  }
}
