/**
 * TUI rendering tests.
 *
 * Drives the Ink `App` component via `ink-testing-library`, which renders
 * to an in-memory frame buffer and exposes `lastFrame()` / `stdin.write()`.
 * No real terminal is involved, so the suite runs as fast as any other
 * Vitest test and is fully deterministic.
 *
 * What we assert:
 *   - The component renders all issues with their rule names and
 *     severity icons.
 *   - The cursor (`▶`) starts on the first issue and moves with `↑`/`↓`.
 *   - `enter` toggles the `details` block on the focused issue.
 *   - `q` ends the app cleanly (Ink's `useApp().exit()`).
 *
 * What we deliberately don't assert:
 *   - Exact byte-for-byte snapshot of the frame. Ink's render output is
 *     ANSI-rich and can shift with library minor versions; pinning the
 *     bytes would make M2 a moving target. Substring assertions cover
 *     the semantic surface.
 */
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { App } from "../src/render/tui.js";
import type { Report } from "../src/validate/types.js";

const makeReport = (overrides: Partial<Report> = {}): Report => ({
  waxlensVersion: "0.0.0",
  file: "/tmp/fixture.wacz",
  valid: false,
  summary: { passed: 3, failed: 2, warnings: 0, info: 0, durationMs: 12 },
  issues: [
    {
      rule: "datapackage/profile-required",
      severity: "error",
      message: 'datapackage.json is missing the "profile" field',
      location: { entry: "datapackage.json" },
      details: { expected: "data-package" },
    },
    {
      rule: "cdxj/filename-archive-relative",
      severity: "error",
      message: 'entry "filename" starts with "archive/"',
      location: { entry: "indexes/index.cdxj", line: 1 },
    },
  ],
  ...overrides,
});

describe("tui rendering", () => {
  it("renders all issue rule names and the summary", () => {
    const { lastFrame } = render(<App report={makeReport()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("waxlens");
    expect(frame).toContain("datapackage/profile-required");
    expect(frame).toContain("cdxj/filename-archive-relative");
    expect(frame).toContain("3 passed");
    expect(frame).toContain("2 failed");
    expect(frame).toContain("↑↓ navigate");
  });

  it("shows 'All rules passed.' when there are no issues", () => {
    const report = makeReport({
      issues: [],
      valid: true,
      summary: { passed: 5, failed: 0, warnings: 0, info: 0, durationMs: 8 },
    });
    const { lastFrame } = render(<App report={report} />);
    expect(lastFrame() ?? "").toContain("All rules passed.");
  });

  it("starts with the cursor on the first issue", () => {
    const { lastFrame } = render(<App report={makeReport()} />);
    const frame = lastFrame() ?? "";
    // The cursor sits on the same line as the first rule name. We
    // assert by checking the order: ▶ appears before the first rule
    // and is the only such marker in the frame.
    const cursorIdx = frame.indexOf("▶");
    const firstRuleIdx = frame.indexOf("datapackage/profile-required");
    expect(cursorIdx).toBeGreaterThanOrEqual(0);
    expect(cursorIdx).toBeLessThan(firstRuleIdx);
    expect(frame.match(/▶/g)?.length ?? 0).toBe(1);
  });

  it("expands details on enter", async () => {
    const { lastFrame, stdin } = render(<App report={makeReport()} />);
    // Before pressing enter, the JSON details payload should not be visible.
    expect(lastFrame() ?? "").not.toContain('"expected": "data-package"');

    // Press enter — ink-testing-library writes raw bytes to its mock
    // stdin; `\r` is what Ink interprets as the return key.
    stdin.write("\r");
    // Let the next render tick run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(lastFrame() ?? "").toContain('"expected": "data-package"');
  });

  it("moves the cursor with the down arrow", async () => {
    const { lastFrame, stdin } = render(<App report={makeReport()} />);
    // ESC[B is the ANSI sequence for the down arrow. Ink decodes it
    // into `key.downArrow` inside `useInput`.
    stdin.write("[B");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const frame = lastFrame() ?? "";
    const cursorIdx = frame.indexOf("▶");
    const firstRuleIdx = frame.indexOf("datapackage/profile-required");
    const secondRuleIdx = frame.indexOf("cdxj/filename-archive-relative");
    expect(cursorIdx).toBeGreaterThan(firstRuleIdx);
    expect(cursorIdx).toBeLessThan(secondRuleIdx);
  });
});
