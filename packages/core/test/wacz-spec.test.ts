// @module-tag wacz
/**
 * `sectionForSpecPath` — §5.2 必須 path → spec 小節番号の単一の真実。
 * rule(issue の section)と entries(ReportEntry.expectedSection)が共用する
 * ので、ここで対応を pin する。
 */
import { describe, expect, it } from "vitest";
import { sectionForSpecPath } from "../src/validate/wacz-spec.js";

describe("sectionForSpecPath", () => {
  it("特定 path / ディレクトリ placeholder / 実ファイルを小節に解決する", () => {
    expect(sectionForSpecPath("datapackage.json")).toBe("5.2.4");
    expect(sectionForSpecPath("pages/pages.jsonl")).toBe("5.2.3");
    expect(sectionForSpecPath("archive/")).toBe("5.2.1");
    expect(sectionForSpecPath("archive/data.warc.gz")).toBe("5.2.1");
    expect(sectionForSpecPath("indexes/")).toBe("5.2.2");
    expect(sectionForSpecPath("indexes/index.cdxj")).toBe("5.2.2");
  });

  it("§5.2 の対象外 path は undefined", () => {
    expect(sectionForSpecPath("fuzzy.json")).toBeUndefined();
    expect(sectionForSpecPath("datapackage-digest.json")).toBeUndefined();
  });
});
