// @module-tag tui
/**
 * `render/tree.ts`(flat entries → §5.1 ツリー / マーカー)の純関数テスト。
 */
import { describe, expect, it } from "vitest";
import type { ReportEntry } from "@waxlens/protocol";
import { buildEntryTree, entryMarker, flattenTree } from "../src/render/tree.js";

const entry = (path: string, over: Partial<ReportEntry> = {}): ReportEntry => ({
  path,
  present: true,
  expectedBy: [],
  issues: [],
  ...over,
});

describe("buildEntryTree / flattenTree", () => {
  it("flat path を §5.1 風ツリーに組み直し、罫線 prefix を付ける", () => {
    const tree = buildEntryTree([
      entry("archive/data.warc.gz"),
      entry("datapackage.json"),
      entry("pages/pages.jsonl"),
    ]);
    const rendered = flattenTree(tree).map((r) => r.connector + r.name);
    expect(rendered).toEqual([
      "├── archive",
      "│   └── data.warc.gz",
      "├── datapackage.json",
      "└── pages",
      "    └── pages.jsonl",
    ]);
  });

  it("中間ディレクトリ(dir)には entry を付けず、葉だけが entry を持つ", () => {
    const rows = flattenTree(buildEntryTree([entry("archive/data.warc.gz")]));
    const dir = rows.find((r) => r.name === "archive");
    const leaf = rows.find((r) => r.name === "data.warc.gz");
    expect(dir?.isDir).toBe(true);
    expect(dir?.entry).toBeUndefined();
    expect(leaf?.entry?.path).toBe("archive/data.warc.gz");
  });
});

describe("entryMarker", () => {
  it("error issue → ✗ / error", () => {
    const m = entryMarker(entry("x", { issues: [{ rule: "r", severity: "error" }] }));
    expect(m).toEqual({ glyph: "✗", rules: ["r"], tone: "error" });
  });
  it("warning issue → ⚠ / warning", () => {
    expect(entryMarker(entry("x", { issues: [{ rule: "r", severity: "warning" }] })).tone).toBe(
      "warning",
    );
  });
  it("declared-but-missing → 理由つき (missing) / error", () => {
    const m = entryMarker(entry("x", { present: false, expectedBy: ["datapackage"] }));
    expect(m.glyph).toBe("(missing — declared in datapackage)");
    expect(m.tone).toBe("error");
  });
  it("§5.2 MUST 欠落 → required by §5.2 を併記 / error", () => {
    const m = entryMarker(entry("x", { present: false, expectedBy: ["wacz-spec"] }));
    expect(m.glyph).toBe("(missing — required by §5.2)");
    expect(m.tone).toBe("error");
  });
  it("clean file → グリフ無し / none", () => {
    expect(entryMarker(entry("x"))).toEqual({ glyph: "", rules: [], tone: "none" });
  });
  it("dir (entry なし) → none", () => {
    expect(entryMarker(undefined).tone).toBe("none");
  });
});
