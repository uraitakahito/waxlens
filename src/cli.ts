#!/usr/bin/env node
/**
 * waxlens CLI entry point.
 *
 * M0 ships only `--version` / `--help`. M1 adds the positional `<file>`
 * argument and validation flags (`--json`, `--no-color`, `--rule`,
 * `--severity`). Keeping the surface minimal until then lets the
 * pack-smoke CI job assert the bin shim works end-to-end without coupling
 * to validation behaviour.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

// package.json#version is the source of truth — we read it at runtime so
// the bin never drifts from the published version. Relative to `dist/cli.js`,
// the manifest is one directory up (the package root).
const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { version: string };

const program = new Command();
program
  .name("waxlens")
  .description("TUI validator for WACZ archives produced by BrowserHive")
  .version(manifest.version);

program.parse(process.argv);
