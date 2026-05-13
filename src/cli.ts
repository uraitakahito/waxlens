#!/usr/bin/env node
/**
 * waxlens CLI entry point.
 *
 * Surface as of M1:
 *
 *   waxlens <file>             validate WACZ, plain-text report
 *   waxlens <file> --json      validate, emit JSON report (no plain header)
 *   waxlens <file> --no-color  disable ANSI colour in plain output
 *   waxlens --version
 *
 * Exit codes:
 *   0 — validation passed (no error-severity issues)
 *   1 — validation failed (one or more error-severity issues)
 *   2 — operational failure (cannot open the file, etc.)
 *
 * The `--rule <name>...` and `--severity <level>` filters from the original
 * plan are deferred to M3 — with only 5 rules in the registry, filtering
 * adds surface area without saving meaningful time, and the test
 * matrices were getting noisy.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { renderJson } from "./render/json.js";
import { renderPlain } from "./render/plain.js";
import { runValidation } from "./validate/engine.js";
import { M1_RULES } from "./validate/rules/index.js";
import { WaczReader } from "./wacz/reader.js";

// package.json#version is the source of truth — we read it at runtime so
// the bin never drifts from the published version. Relative to `dist/cli.js`,
// the manifest is one directory up (the package root).
const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { version: string };

interface CliOptions {
  json: boolean;
  color: boolean;
}

const program = new Command();
program
  .name("waxlens")
  .description("TUI validator for WACZ archives produced by BrowserHive")
  .version(manifest.version)
  .argument("<file>", "Path to the .wacz file to validate")
  .option("--json", "Emit a JSON report to stdout instead of the plain text view", false)
  // commander's --no-<flag> idiom: the parsed value is `color: true` by
  // default and flips to `color: false` when `--no-color` is present.
  .option("--no-color", "Disable ANSI colour escapes in plain output")
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
    process.stderr.write(`waxlens: cannot open "${filePath}": ${message}\n`);
    return 2;
  }

  try {
    const result = await runValidation(reader, {
      file: filePath,
      waxlensVersion: manifest.version,
      rules: M1_RULES,
    });
    // runValidation's Result<Report, never> can only be the ok branch —
    // narrow with the same idiom used in `engine.ts`.
    if (!result.ok) return 2;
    const report = result.value;

    const output = opts.json ? renderJson(report) : renderPlain(report, { color: opts.color });
    process.stdout.write(output);

    return report.valid ? 0 : 1;
  } finally {
    await reader.close();
  }
}
