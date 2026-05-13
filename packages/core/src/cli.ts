#!/usr/bin/env node
/**
 * `waxlens-validate` — the validation engine's CLI.
 *
 * Pure machine-and-pipe-friendly surface: a single positional `<file>`,
 * the rule profile selector, and a choice of `--json` (default,
 * stable schema documented in `docs/json-schema.md`) or `--plain` for
 * a colour-aware human summary. No TUI ever; that lives in
 * `@waxlens/tui`'s `waxlens` bin and consumes this package as a
 * library import.
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
import { renderPlain } from "./render/plain.js";
import { DEFAULT_PROFILE, runValidation } from "./validate/engine.js";
import { M1_RULES } from "./validate/rules/index.js";
import type { RuleProfile } from "./validate/types.js";
import { ALL_PROFILES } from "./validate/types.js";
import { WaczReader } from "./wacz/reader.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { version: string };

interface CliOptions {
  /** Default true (JSON). `--plain` flips it to false. */
  json: boolean;
  color: boolean;
  profile: RuleProfile;
}

const parseProfile = (raw: string): RuleProfile => {
  if ((ALL_PROFILES as readonly string[]).includes(raw)) return raw as RuleProfile;
  throw new InvalidArgumentError(`Unknown profile "${raw}". Valid: ${ALL_PROFILES.join(", ")}.`);
};

const program = new Command();
program
  .name("waxlens-validate")
  .description("WACZ validator — emits a machine-readable JSON report by default")
  .version(manifest.version)
  .argument("<file>", "Path to the .wacz file to validate")
  // `--plain` flips the default-on `--json` mode. Both forms map to the
  // same `opts.json` boolean via commander's `--no-<flag>` idiom; we
  // expose the human-readable name (`--plain`) rather than `--no-json`
  // because that's the verb most users actually want to type.
  .option(
    "--plain",
    "Emit colour-aware human-readable text instead of the default JSON report",
    false,
  )
  .option("--no-color", "Disable ANSI colour escapes in plain output")
  .option(
    "--profile <name>",
    `Rule profile (${ALL_PROFILES.join(" | ")}). Defaults to "${DEFAULT_PROFILE}".`,
    parseProfile,
    DEFAULT_PROFILE,
  )
  .action(async (filePath: string, options: CliOptions & { plain: boolean }) => {
    const exitCode = await runCli(filePath, {
      json: !options.plain,
      color: options.color,
      profile: options.profile,
    });
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

    if (opts.json) {
      process.stdout.write(renderJson(report));
    } else {
      process.stdout.write(renderPlain(report, { color: opts.color }));
    }

    return report.valid ? 0 : 1;
  } finally {
    await reader.close();
  }
}
