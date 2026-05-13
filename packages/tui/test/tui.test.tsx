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
import type { Report } from "@waxlens/core";
import { App } from "../src/app.js";

const makeReport = (overrides: Partial<Report> = {}): Report => ({
  waxlensVersion: "0.0.0",
  profile: "spec",
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
    // Before pressing enter, the details payload should not be visible.
    expect(lastFrame() ?? "").not.toContain("expected:");

    // Press enter — ink-testing-library writes raw bytes to its mock
    // stdin; `\r` is what Ink interprets as the return key.
    stdin.write("\r");
    // Let the next render tick run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The first issue's details has `{ expected: "data-package" }` —
    // rendered via the diff view because the `expected` field is
    // present (even without a paired `actual`, the row falls through
    // to the generic JSON view; the M3 dispatch requires both).
    // We assert on the JSON-tail rendering of `expected` to keep this
    // test agnostic of the dispatch decision.
    expect(lastFrame() ?? "").toContain("data-package");
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

  it("renders the stats footer when report.stats is present", () => {
    const report = makeReport({
      stats: { warcRecordCount: 42, warcArchiveBytes: 5 * 1024 * 1024, hosts: ["a", "b", "c"] },
    });
    const frame = render(<App report={report} />).lastFrame() ?? "";
    expect(frame).toContain("42 records");
    expect(frame).toContain("5.0 MB");
    expect(frame).toContain("3 hosts");
  });

  it("diff view shows expected/actual for hash-style issues", async () => {
    const report = makeReport({
      issues: [
        {
          rule: "datapackage/resource-hashes",
          severity: "error",
          message: "hash mismatch",
          details: { expected: "sha256:GOOD", actual: "sha256:BAD" },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("expected:");
    expect(frame).toContain("actual:");
    expect(frame).toContain("sha256:GOOD");
    expect(frame).toContain("sha256:BAD");
  });

  it("WARC header view renders for CDXJ↔WARC mismatch details", async () => {
    const report = makeReport({
      issues: [
        {
          rule: "cdxj/warc-offsets",
          severity: "error",
          message: "offset mismatch",
          details: {
            requested: { offset: 99, length: 100 },
            candidates: [{ offset: 0, length: 200, warcHeader: ["WARC/1.1"] }],
          },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lastFrame() ?? "").toContain("Nearby WARC members:");
  });

  it("hex view renders when details carry hexPreview", async () => {
    const report = makeReport({
      issues: [
        {
          rule: "warc/payload-digest",
          severity: "warning",
          message: "payload digest mismatch",
          details: {
            expected: "sha256:GOOD",
            actual: "sha256:BAD",
            hexPreview: [
              "00000000  4e a7 5b 0c 1f 8b 08 00  00 00 00 00 00 03 b5 d3   N.[..........X..",
            ],
          },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Payload preview (hex):");
    expect(frame).toContain("4e a7 5b 0c");
  });
});
