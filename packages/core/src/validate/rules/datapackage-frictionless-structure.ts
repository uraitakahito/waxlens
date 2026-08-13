/**
 * Rule: datapackage/frictionless-structure(MUST/error)
 *
 * Frictionless Data Package の **構造**要件だけを error で検証する:
 *   - 最上位 `resources` が空でない配列であること
 *   - 各 resource が `name` と、`path`(または `data`)を持つこと
 *
 * これらは正当な WACZ なら必ず満たすので error にしても誤検知しない。一方
 * `resource.name` の小文字パターン等、WACZ より厳しい stylistic な検証は
 * 補助ルール {@link datapackageFrictionlessSchemaRule}(SHOULD/warning)が
 * 引き続き担当する(構造違反は両方に出るが、error=必ず直す / warning=スキーマ
 * 注記、と役割が異なるので許容)。
 *
 * datapackage.json の不在 / JSON 不正は `datapackage/profile-required` が
 * 具体的に報告するので、このルールは object に shape できたときだけ動く。
 *
 * Spec: WACZ 1.1.1 — datapackage は FRICTIONLESS-DATA-PACKAGE に MUST 準拠。
 *   構造要件の出所: https://specs.frictionlessdata.io/data-package/#required-properties
 *   (resources は必須・1 件以上)/ https://specs.frictionlessdata.io/data-resource/
 *   (resource は name と path|data を持つ)。
 */
import { ok } from "../../result.js";
import { parseDatapackage } from "../../wacz/datapackage.js";
import type { Issue, ValidationRule } from "../domain.js";

const DATAPACKAGE_ENTRY = "datapackage.json";

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export const datapackageFrictionlessStructureRule: ValidationRule = {
  name: "datapackage/frictionless-structure",
  descriptionKey: "datapackage/frictionless-structure.desc",
  conformance: "MUST",
  docs: [
      {
        label: "Frictionless Data Package §required",
        url: {
          en: "https://specs.frictionlessdata.io/data-package/#required-properties",
        },
      },
      {
        label: "Frictionless Data Resource",
        url: {
          en: "https://specs.frictionlessdata.io/data-resource/",
        },
      },
  ],
  // 構造 MUST は spec / browserhive で error。legacy トリアージ用の lenient では
  // generic な指摘を出したくないので除外する(frictionless-schema と同方針)。
  applicability: { excludeProfiles: ["lenient"] },

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(DATAPACKAGE_ENTRY);
    if (!buf) return ok(issues); // 不在は profile-required が報告する。

    const pkg = parseDatapackage(buf.toString("utf-8"));
    if (!pkg) return ok(issues); // JSON 不正 / 非 object も profile-required が報告する。

    const resources = pkg.resources;
    if (!Array.isArray(resources) || resources.length === 0) {
      issues.push({
        rule: "datapackage/frictionless-structure",
        severity: "error",
        messageKey: "datapackage/frictionless-structure.no-resources",
        location: { entry: DATAPACKAGE_ENTRY },
      });
      return ok(issues); // resources が無ければ per-resource 検査は無意味。
    }

    resources.forEach((resource, index) => {
      // `.loose()` passthrough なので `data` は型に出ない。構造型で読む。
      const data = (resource as Record<string, unknown>)["data"];
      if (!isNonEmptyString(resource.name)) {
        issues.push({
          rule: "datapackage/frictionless-structure",
          severity: "error",
          messageKey: "datapackage/frictionless-structure.resource-missing-name",
          params: { index },
          location: { entry: DATAPACKAGE_ENTRY },
        });
      }
      if (!isNonEmptyString(resource.path) && data === undefined) {
        issues.push({
          rule: "datapackage/frictionless-structure",
          severity: "error",
          messageKey: "datapackage/frictionless-structure.resource-missing-path-or-data",
          params: { index },
          location: { entry: DATAPACKAGE_ENTRY },
        });
      }
    });

    return ok(issues);
  },
};
