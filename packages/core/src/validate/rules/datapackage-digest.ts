/**
 * Rule: datapackage/digest
 *
 * WACZ §5.2.5: `datapackage-digest.json` を root に置いて、`datapackage.json`
 * (ひいては WACZ 全体)をハッシュで検証できるようにすべきである(SHOULD)。
 * 存在する場合は次を MUST とする:
 *   - `path`: 文字列 "datapackage.json"
 *   - `hash`: `datapackage.json` の暗号学的ハッシュ
 *
 * 観点:
 *   1. 不在 → warning(SHOULD 存在。lenient では info)
 *   2. 存在するが path/hash が無い/不正 → error
 *   3. hash が実 datapackage.json の sha256 と不一致 → error(expected/actual)
 *
 * hash 計算は `datapackage/resource-hashes` と同じ `sha256Hex` を使う。
 *
 * Spec: https://specs.webrecorder.net/wacz/1.1.1/#datapackage-digest-json
 */
import { ok } from "../../result.js";
import { sha256Hex } from "../../wacz/digest.js";
import type { Issue, ValidationRule } from "../domain.js";
import { datapackageOf, DATAPACKAGE_ENTRY } from "../datapackage-source.js";

const DIGEST_ENTRY = "datapackage-digest.json";

export const datapackageDigestRule: ValidationRule = {
  name: "datapackage/digest",
  descriptionKey: "datapackage/digest.desc",
  conformance: "SHOULD",
  docs: [
      {
        label: "WACZ §datapackage-digest.json",
        url: {
          en: "https://specs.webrecorder.net/wacz/1.1.1/#datapackage-digest-json",
          ja: "https://uraitakahito.github.io/specs/wacz/1.1.1/#datapackage-digest-json",
        },
      },
  ],
  applicability: {
    severityByProfile: {
      // 不在は SHOULD 未達なので lenient では info まで下げる。
      //
      // 内容が壊れている系 (.invalid-json / .bad-path / .no-hash /
      // .hash-mismatch) は**あえて列挙しない** = lenient でも error のまま。
      // digest があるのに合わないのはアーカイブ改変の疑いを意味するので、
      // トリアージ目的の profile でも埋もれさせない。
      lenient: { "datapackage/digest.absent": "info" },
    },
  },

  run: async (wacz) => {
    const issues: Issue[] = [];
    const raw = await wacz.readEntry(DIGEST_ENTRY);

    if (!raw) {
      issues.push({
        rule: "datapackage/digest",
        severity: "warning",
        messageKey: "datapackage/digest.absent",
        params: { section: "5.2.5" },
      });
      return ok(issues);
    }

    let digest: { path?: unknown; hash?: unknown };
    try {
      digest = JSON.parse(raw.toString("utf-8")) as { path?: unknown; hash?: unknown };
    } catch {
      issues.push({
        rule: "datapackage/digest",
        severity: "error",
        messageKey: "datapackage/digest.invalid-json",
        params: { section: "5.2.5", entry: DIGEST_ENTRY },
        location: { entry: DIGEST_ENTRY },
      });
      return ok(issues);
    }

    if (digest.path !== DATAPACKAGE_ENTRY) {
      issues.push({
        rule: "datapackage/digest",
        severity: "error",
        messageKey: "datapackage/digest.bad-path",
        params: { section: "5.2.5", entry: DIGEST_ENTRY },
        location: { entry: DIGEST_ENTRY },
      });
    }

    // ここだけは解析済みのオブジェクトではなく **ファイルそのもの** が要る ——
    // digest はバイト列のハッシュだから。
    const { bytes: dp } = await datapackageOf(wacz);
    if (typeof digest.hash !== "string" || digest.hash.length === 0) {
      issues.push({
        rule: "datapackage/digest",
        severity: "error",
        messageKey: "datapackage/digest.no-hash",
        params: { section: "5.2.5", entry: DIGEST_ENTRY },
        location: { entry: DIGEST_ENTRY },
      });
    } else if (dp) {
      const actual = sha256Hex(dp);
      if (digest.hash !== actual) {
        issues.push({
          rule: "datapackage/digest",
          severity: "error",
          messageKey: "datapackage/digest.hash-mismatch",
          params: { section: "5.2.5", entry: DIGEST_ENTRY },
          location: { entry: DIGEST_ENTRY },
          details: { expected: actual, actual: digest.hash },
        });
      }
    }

    return ok(issues);
  },
};
