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
 * Exit codes:
 *   0 — validation 成功 (error 重大度の issue なし)
 *   1 — validation 失敗 (error 重大度の issue が 1 件以上)
 *   2 — operational な失敗 (ファイルが開けない等)
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import { renderJson } from "./render/json.js";
import { DEFAULT_PROFILE, runValidation } from "./validate/engine.js";
import { M1_RULES } from "./validate/rules/index.js";
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
    // `process.exit(N)` ではなく `process.exitCode` をセットすることで、
    // stdout の同期 flush と `parseAsync` の Promise の clean な resolve
    // を保証しつつ、Node が event loop drain で自然終了するときに正しい
    // exit code を返す。`runCli` は `reader.close()` を `finally` で
    // await しているので、外側に lingering handle は残らない。
    process.exitCode = await runCli(filePath, options);
  });

await program.parseAsync(process.argv);

async function runCli(filePath: string, opts: CliOptions): Promise<number> {
  const absolutePath = resolve(filePath);

  let reader: WaczReader;
  try {
    reader = await WaczReader.open(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`waxlens-validate: cannot open "${filePath}": ${message}\n`);
    return 2;
  }

  try {
    const result = await runValidation(reader, {
      file: filePath,
      waxlensVersion: manifest.version,
      rules: M1_RULES,
      profile: opts.profile,
    });
    // `Result<Report, never>` は ok 分岐しか取りえないが、strict mode
    // では narrowing check が必要。
    if (!result.ok) return 2;
    const report = result.value;

    process.stdout.write(renderJson(report));

    return report.valid ? 0 : 1;
  } finally {
    await reader.close();
  }
}
