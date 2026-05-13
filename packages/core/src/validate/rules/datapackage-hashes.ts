/**
 * Rule: datapackage/resource-hashes
 *
 * `datapackage.json#resources[]` の各 entry は、他の WACZ ファイル
 * (archive/data.warc.gz、indexes/index.cdxj、pages/pages.jsonl、
 * fuzzy.json …) のいずれかに対する `path` + `hash` + `bytes` を
 * 宣言する。hash は entry の *非圧縮* payload に対する
 * `sha256:<hex>`、bytes はそれに対応する length。我々は zip の実際
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
 *   - resource が zip から欠落           → error
 *   - resource はあるが hash が不一致   → error (expected/actual 付き)
 *   - resource はあるが bytes が不一致  → error (別 issue)
 *   - resources[] が空 / 非配列          → error (producer バグの兆候)
 */
import { ok } from "../../result.js";
import { sha256Hex } from "../../wacz/digest.js";
import { parseDatapackage } from "../../wacz/datapackage.js";
import type { Issue, ValidationRule } from "../types.js";

const DATAPACKAGE_ENTRY = "datapackage.json";

export const datapackageHashesRule: ValidationRule = {
  name: "datapackage/resource-hashes",
  description: `${DATAPACKAGE_ENTRY} resource hashes must match the WACZ contents`,
  severity: "error",

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
        message: `${DATAPACKAGE_ENTRY} has no "resources" array (or it is empty)`,
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
          message: `${DATAPACKAGE_ENTRY} resource is missing or has an invalid "path"`,
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
          message: `Resource "${path}" listed in ${DATAPACKAGE_ENTRY} is missing from the WACZ`,
          location: { entry: path },
        });
        continue;
      }

      const actualHash = sha256Hex(actualBuf);
      if (typeof expectedHash !== "string" || expectedHash.length === 0) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          message: `Resource "${path}" has no "hash" in ${DATAPACKAGE_ENTRY}`,
          location: { entry: path },
          details: { actual: actualHash },
        });
      } else if (expectedHash !== actualHash) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          message: `Resource "${path}" hash mismatch`,
          location: { entry: path },
          details: { expected: expectedHash, actual: actualHash },
        });
      }

      const actualBytes = actualBuf.byteLength;
      if (typeof expectedBytes === "number" && expectedBytes !== actualBytes) {
        issues.push({
          rule: "datapackage/resource-hashes",
          severity: "error",
          message: `Resource "${path}" byte length mismatch`,
          location: { entry: path },
          details: { expected: expectedBytes, actual: actualBytes },
        });
      }
    }

    return ok(issues);
  },
};
