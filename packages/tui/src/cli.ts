#!/usr/bin/env node
/**
 * `waxlens` — the Ink TUI for WACZ validation.
 *
 * Imports `@waxlens/core` in-process (no spawn) and renders the
 * resulting `Report` interactively. When stdout or stdin isn't a
 * TTY, falls back silently to the same plain-text renderer
 * `waxlens-validate --plain` uses. For machine-readable JSON, use
 * `waxlens-validate` directly — that's the contract this split
 * exists to enforce.
 *
 * Exit codes match `waxlens-validate`:
 *   0 — validation passed (no error-severity issues)
 *   1 — validation failed (one or more error-severity issues)
 *   2 — operational failure (cannot open the file, etc.)
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import {
  ALL_PROFILES,
  DEFAULT_PROFILE,
  M1_RULES,
  runValidation,
  WaczReader,
  type Report,
  type RuleProfile,
} from "@waxlens/core";
import { renderPlain } from "./render/plain.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { version: string };

interface CliOptions {
  color: boolean;
  tui: boolean;
  profile: RuleProfile;
}

const parseProfile = (raw: string): RuleProfile => {
  if ((ALL_PROFILES as readonly string[]).includes(raw)) return raw as RuleProfile;
  throw new InvalidArgumentError(`Unknown profile "${raw}". Valid: ${ALL_PROFILES.join(", ")}.`);
};

const program = new Command();
program
  .name("waxlens")
  .description("Interactive TUI for WACZ validation (use waxlens-validate for JSON output)")
  .version(manifest.version)
  .argument("<file>", "Path to the .wacz file to validate")
  .option("--no-color", "Disable ANSI colour escapes in plain output")
  .option(
    "--no-tui",
    "Force plain output even when stdout is a TTY (default chooses based on isTTY)",
  )
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
    process.stderr.write(`waxlens: cannot open "${filePath}": ${message}\n`);
    return 2;
  }

  try {
    const result = await runValidation(reader, {
      file: filePath,
      waxlensVersion: manifest.version,
      rules: M1_RULES,
      profile: opts.profile,
    });
    if (!result.ok) return 2;
    const report = result.value;

    if (shouldUseTui(opts)) {
      await runTui(report);
    } else {
      process.stdout.write(renderPlain(report, { color: opts.color }));
    }

    return report.valid ? 0 : 1;
  } finally {
    await reader.close();
  }
}

// `function` declarations rather than `const` arrows so the module-top
// `await program.parseAsync(...)` above can invoke `runCli` (which calls
// these) without tripping over the temporal dead zone.
function shouldUseTui(opts: CliOptions): boolean {
  if (!opts.tui) return false;
  // Both directions matter: Ink writes to stdout (needs TTY for cursor
  // control) and reads from stdin (needs raw-mode keystrokes for
  // navigation). A non-TTY on either side means the interactive surface
  // would be broken; fall back to plain text instead.
  return Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
}

async function runTui(report: Report): Promise<void> {
  const [{ render }, { createElement }, { App }] = await Promise.all([
    import("ink"),
    import("react"),
    import("./app.js"),
  ]);
  const instance = render(createElement(App, { report }));
  await instance.waitUntilExit();
}
