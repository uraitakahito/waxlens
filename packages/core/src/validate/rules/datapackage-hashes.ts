/**
 * Rule: datapackage/resource-hashes
 *
 * `datapackage.json#resources[]` の各 entry は、他の WACZ ファイル
 * (archive/data.warc.gz、indexes/index.cdxj、pages/pages.jsonl、
 * fuzzy.json …) のいずれかに対する `path` + `hash` + `bytes` を
 * 宣言する。hash は entry の *非圧縮* payload に対する
 * `sha256:<hex>`、bytes はそれに対応する length。我々は ZIP の実際
 * の中身からどちらも再計算し、不一致を flag する。
 *
 * Spec: Frictionless Data Package descriptor (WACZ が
 *       `datapackage.json#resources[]` に借用しているフォーマット) は
 *       `hash` を `sha256:<hex>`、`bytes` を整数のファイル長と定義する。
 * Reference producer: browserhive/src/storage/wacz/datapackage.ts:68-83
 *       で、emit するバイト列から hash + length が組み立てられている
 *       様子が直接読める。
 *
 * report で区別する価値のある失敗モード:
 *   - resource が ZIP から欠落           → error
 *   - resource はあるが hash が不一致   → error (expected/actual 付き)
 *   - resource はあるが bytes が不一致  → error (別 issue)
 *   - resources[] が空 / 非配列          → error (producer バグの兆候)
 */
import { ok } from "../../result.js";
import { sha256Hex } from "../../wacz/digest.js";
import { parseDatapackage } from "../../wacz/datapackage.js";
import type { Issue, ValidationRule } from "../domain.js";

const DATAPACKAGE_ENTRY = "datapackage.json";

export const datapackageHashesRule: ValidationRule = {
  name: "datapackage/resource-hashes",
  descriptionKey: "datapackage/resource-hashes.desc",
  conformance: "MUST",
  docs: [
      {
        label: "WACZ §datapackage.json",
        url: {
          en: "https://specs.webrecorder.net/wacz/1.1.1/#datapackage-json",
          ja: "https://uraitakahito.github.io/specs/wacz/1.1.1/#datapackage-json",
        },
      },
      {
        label: "Frictionless Data Resource",
        url: {
          en: "https://specs.frictionlessdata.io/data-resource/",
        },
      },
  ],

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(DATAPACKAGE_ENTRY);
    if (!buf) return ok(issues); // profile rule が不在を既に報告している。

    const pkg = parseDatapackage(buf.toString("utf-8"));
    if (!pkg) return ok(issues); // profile rule が parse 失敗を既に報告している。

    const resources = pkg.resources;
    if (!Array.isArray(resources) || resources.length === 0) {
      issues.push({
        rule: "datapackage/resource-hashes",
        severity: "error",
        messageKey: "datapackage/resource-hashes.no-resources",
        params: { entry: DATAPACKAGE_ENTRY },
        location: { entry: DATAPACKAGE_ENTRY },
      });
      return ok(issues);
    }

    for (const res of resources) {
      const path = res.path;
      const expectedHash = res.hash;
      const expectedBytes = res.bytes;

      if (typeof path !== "string" || path.length === 0) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          messageKey: "datapackage/resource-hashes.invalid-path",
          params: { entry: DATAPACKAGE_ENTRY },
          location: { entry: DATAPACKAGE_ENTRY },
          details: { resource: res },
        });
        continue;
      }

      const actualBuf = await wacz.readEntry(path);
      if (!actualBuf) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          messageKey: "datapackage/resource-hashes.resource-missing",
          params: { path, entry: DATAPACKAGE_ENTRY },
          location: { entry: path },
        });
        continue;
      }

      const actualHash = sha256Hex(actualBuf);
      if (typeof expectedHash !== "string" || expectedHash.length === 0) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          messageKey: "datapackage/resource-hashes.no-hash",
          params: { path, entry: DATAPACKAGE_ENTRY },
          location: { entry: path },
          details: { actual: actualHash },
        });
      } else if (expectedHash !== actualHash) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          messageKey: "datapackage/resource-hashes.hash-mismatch",
          params: { path },
          location: { entry: path },
          details: { expected: expectedHash, actual: actualHash },
        });
      }

      const actualBytes = actualBuf.byteLength;
      if (typeof expectedBytes === "number" && expectedBytes !== actualBytes) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          messageKey: "datapackage/resource-hashes.byte-mismatch",
          params: { path },
          location: { entry: path },
          details: { expected: expectedBytes, actual: actualBytes },
        });
      }
    }

    return ok(issues);
  },
};
