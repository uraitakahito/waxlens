#!/usr/bin/env node
/**
 * `waxlens-validate` — the validation engine's CLI.
 *
 * Machine-readable surface only: a single positional `<file>`, a rule
 * profile selector, and JSON output to stdout. Human-readable
 * rendering (colours, expandable details) lives in `@waxlens/tui`'s
 * `waxlens` bin, which consumes this package as a library import.
 *
 * Exit codes:
 *   0 — validation passed (no error-severity issues)
 *   1 — validation failed (one or more error-severity issues)
 *   2 — operational failure (cannot open the file, etc.)
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
    const exitCode = await runCli(filePath, options);
    process.exit(exitCode);
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
    // `Result<Report, never>` can only be the ok branch — narrowing
    // check is still needed under strict mode.
    if (!result.ok) return 2;
    const report = result.value;

    process.stdout.write(renderJson(report));

    return report.valid ? 0 : 1;
  } finally {
    await reader.close();
  }
}
