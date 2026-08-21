import { defineConfig } from "vitest/config";

import { TEST_TAGS } from "./test-tags.js";

/**
 * Root config — exists so `--ui` can show the whole workspace at once.
 *
 * `pnpm test` stays `pnpm -r test`, which runs each package through its own
 * `vitest.config.ts`. This file does not duplicate those: `projects` points at
 * the same directories, so each package still supplies its own `include` and
 * `environment`, and there is exactly one place per package where that is
 * written down. What this adds is a single process that has all of them, which
 * is what the UI needs — three separate `vitest --ui` runs would be three
 * browser tabs that cannot show a cross-package run.
 *
 * `@waxlens/protocol` is absent because it has no tests. It is the wire
 * contract itself; listing it here would produce an empty project in the UI
 * that reads as "tests missing" rather than "nothing to run".
 */
export default defineConfig({
  test: {
    projects: ["packages/contract", "packages/core", "packages/validate-cli", "packages/daemon", "packages/devtools", "packages/tui"],
    tags: TEST_TAGS,
  },
});
