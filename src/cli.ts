#!/usr/bin/env node
/**
 * waxlens CLI entry point.
 *
 * Surface as of M2:
 *
 *   waxlens <file>             validate WACZ; TUI when stdout is a TTY,
 *                              plain text otherwise (auto-fallback for pipes)
 *   waxlens <file> --json      validate, emit JSON report to stdout
 *   waxlens <file> --no-color  disable ANSI colour in plain output
 *   waxlens <file> --no-tui    force plain output even when stdout is a TTY
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
 *
 * TUI dispatch:
 *   - `--json` always wins (machine-readable mode).
 *   - `--no-tui` forces plain text.
 *   - When stdout *or* stdin is not a TTY, we silently fall back to plain.
 *     stdin matters because Ink's `useInput` needs raw-mode keystrokes;
 *     a non-TTY stdin makes the TUI inert and confusing.
 *   - The TUI module is dynamically imported so non-TUI runs (the bulk
 *     of CI usage) don't pay the cost of loading React + Ink.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { renderJson } from "./render/json.js";
import { renderPlain } from "./render/plain.js";
import { runValidation } from "./validate/engine.js";
import { M1_RULES } from "./validate/rules/index.js";
import type { Report } from "./validate/types.js";
import { WaczReader } from "./wacz/reader.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { version: string };

interface CliOptions {
  json: boolean;
  color: boolean;
  tui: boolean;
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
  .option(
    "--no-tui",
    "Force plain output even when stdout is a TTY (the default chooses based on isTTY)",
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
    });
    // runValidation's Result<Report, never> can only be the ok branch —
    // narrow with the same idiom used in `engine.ts`.
    if (!result.ok) return 2;
    const report = result.value;

    if (opts.json) {
      process.stdout.write(renderJson(report));
    } else if (shouldUseTui(opts)) {
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
// these) without tripping over the temporal dead zone. The .action
// callback fires synchronously during parseAsync, *before* later
// const-initialisations would run — a classic ESM-top-level-await
// hazard. Function declarations are hoisted, const arrows are not.
function shouldUseTui(opts: CliOptions): boolean {
  if (!opts.tui) return false;
  // Both directions matter: Ink writes to stdout (needs TTY for cursor
  // control) and reads from stdin (needs raw-mode keystrokes for
  // navigation). A non-TTY on either side means the interactive surface
  // would be broken; fall back to plain text instead.
  return Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
}

/**
 * Run the Ink TUI. Dynamic import so non-TUI runs (CI, pipes, --json) don't
 * pay the React + Ink cold-start cost — `dist/render/tui.js` and its
 * dependencies are not loaded unless we actually need them.
 */
async function runTui(report: Report): Promise<void> {
  const [{ render }, { createElement }, { App }] = await Promise.all([
    import("ink"),
    import("react"),
    import("./render/tui.js"),
  ]);
  const instance = render(createElement(App, { report }));
  await instance.waitUntilExit();
}
