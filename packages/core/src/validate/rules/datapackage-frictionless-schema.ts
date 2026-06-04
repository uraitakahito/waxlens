/**
 * Rule: datapackage/frictionless-schema(補助)
 *
 * `datapackage.json` を Frictionless Data Package **v1** の公式 JSON
 * Schema(draft-04)で検証する。WACZ 固有ルール(profile-required /
 * resource-hashes / wacz-version)が拾わない「汎用 descriptor として
 * の奇形」(resources が無い、resource に name/path が無い、name が
 * 規約パターン外、など)を warning で早期に knock-out するための補助。
 *
 * 公式スキーマは `additionalProperties: false` を持たないため、
 * `wacz_version` / `mainPageURL` などの WACZ 拡張プロパティは弾かれない
 * (意図どおり)。一方 `resource.name` の小文字パターン等、WACZ より
 * 厳しい箇所があるため severity は `warning` とし、`lenient` profile では
 * 除外する。
 *
 * Schema 出所: https://specs.frictionlessdata.io/schemas/data-package.json
 *   (vendored: ../frictionless/data-package.schema.json、更新手順は
 *    scripts/update-frictionless-schema.sh、改ざん検知は
 *    test/frictionless-schema.test.ts の pin テストを参照)
 */
import { createRequire } from "node:module";
import schema from "../frictionless/data-package.schema.json" with { type: "json" };
import { ok } from "../../result.js";
import { parseDatapackage } from "../../wacz/datapackage.js";
import type { Issue, ValidationRule } from "../domain.js";
import type { ValidateFunction } from "ajv";

// ajv-draft-04 は CJS パッケージ (module.exports = Ajv クラス)。本パッケージは
// esModuleInterop なし + verbatimModuleSyntax のため、ESM の default import では
// 名前空間に解決されてしまい new できない。createRequire で値(クラス)を取り、
// 必要な範囲を構造型で与える(global tsconfig を変えずスコープ内で解決)。
const require = createRequire(import.meta.url);
const Ajv04 = require("ajv-draft-04") as new (opts?: {
  allErrors?: boolean;
  strict?: boolean;
  logger?: false;
}) => { compile: (schema: object) => ValidateFunction };

const DATAPACKAGE_ENTRY = "datapackage.json";

// strict:false = draft-04 の未知キーワード/format で ajv が throw しない。
// logger:false = "unknown format ... ignored" の警告を黙らせる(uri/email/date-time
// 等は構造検証の対象外でよい)。compile は副作用なくモジュール初期化時に 1 度だけ。
const validateSchema = new Ajv04({
  allErrors: true,
  strict: false,
  logger: false,
}).compile(schema);

export const datapackageFrictionlessSchemaRule: ValidationRule = {
  name: "datapackage/frictionless-schema",
  descriptionKey: "datapackage/frictionless-schema.desc",
  severity: "warning",
  // 公式スキーマは WACZ より厳しい箇所があるため warning。legacy トリアージ
  // 用の lenient profile では generic な findings を出したくないので除外する。
  applicability: { excludeProfiles: ["lenient"] },

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(DATAPACKAGE_ENTRY);
    if (!buf) return ok(issues); // 不在は profile-required ルールが報告する。

    const pkg = parseDatapackage(buf.toString("utf-8"));
    if (!pkg) return ok(issues); // JSON 不正 / 非 object も profile-required が報告する。

    if (!validateSchema(pkg)) {
      for (const err of validateSchema.errors ?? []) {
        const at = err.instancePath === "" ? "/" : err.instancePath;
        issues.push({
          rule: "datapackage/frictionless-schema",
          severity: "warning",
          messageKey: "datapackage/frictionless-schema.violation",
          params: { at, detail: err.message ?? "invalid" },
          location: { entry: DATAPACKAGE_ENTRY },
          details: {
            instancePath: err.instancePath,
            keyword: err.keyword,
            params: err.params,
          },
        });
      }
    }

    return ok(issues);
  },
};
