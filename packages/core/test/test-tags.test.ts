// @module-tag docs
/**
 * The tag vocabulary and its use have to stay in step.
 *
 * `strictTags` (on by default) catches one direction: a test using a tag that
 * the config never declared fails the whole run. It cannot catch the other
 * two, and both make filtering untrustworthy in the same quiet way —
 * `--tagsFilter frictionless` returning fewer tests than it should looks
 * exactly like "there are fewer tests than you thought".
 *
 * - A test file with no tag at all is invisible to every filter.
 * - A declared-but-unused tag pads `--listTags` with names that match nothing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";
import { join } from "node:path";

import { TEST_TAGS } from "../../../test-tags.js";

const WORKSPACE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Every test file in the workspace, relative to the repo root. */
const testFiles = (): string[] =>
  globSync("packages/*/test/**/*.test.{ts,tsx}", { cwd: WORKSPACE_ROOT }).sort();

const declaredTags = (): string[] => TEST_TAGS.map((t) => t.name).sort();

/** Tags a file claims, whether file-wide (`@module-tag`) or per-test (`tags: [...]`). */
const tagsUsedIn = (relative: string): string[] => {
  const source = readFileSync(join(WORKSPACE_ROOT, relative), "utf8");
  const moduleTags = [...source.matchAll(/@module-tag\s+([\w\-/]+)/g)].map((m) => m[1] ?? "");
  const inlineTags = [...source.matchAll(/tags:\s*\[([^\]]*)\]/g)].flatMap((m) =>
    [...(m[1] ?? "").matchAll(/["']([\w\-/]+)["']/g)].map((t) => t[1] ?? ""),
  );
  return [...moduleTags, ...inlineTags];
};

describe("test tags", () => {
  it("every test file carries at least one", () => {
    // A file without a tag is not "untagged" from a reader's point of view —
    // it simply never appears, which reads as "no test covers that".
    const untagged = testFiles().filter((f) => tagsUsedIn(f).length === 0);

    expect(untagged, "test files with no @module-tag").toEqual([]);
  });

  it("declares no tag that nothing uses", () => {
    // An unused name in `--listTags` is worse than absent: it invites a filter
    // that silently matches nothing.
    const used = new Set(testFiles().flatMap(tagsUsedIn));
    const unused = declaredTags().filter((t) => !used.has(t));

    expect(unused, "tags declared in vitest.config.ts but never applied").toEqual([]);
  });

  it("uses no tag that is not declared", () => {
    // `strictTags` already fails the run for this, so the assertion is a
    // belt-and-braces reader's note more than a guard — but it names the file
    // and tag, where the runtime error names only the tag.
    const declared = new Set(declaredTags());
    const offenders = testFiles().flatMap((f) =>
      tagsUsedIn(f)
        .filter((t) => !declared.has(t))
        .map((t) => `${f}: ${t}`),
    );

    expect(offenders).toEqual([]);
  });
});
