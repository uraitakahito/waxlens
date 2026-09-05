/**
 * Rule: browserhive/storage-shape(browserhive profile 限定 · >=6.0.0)
 *
 * `storage/origins.jsonl` が在るときの中身と、目録との整合。
 *
 * ファイルの存在自体は違反ではない —— profile では MAY。だが**在ることと
 * `valuesRecorded` は必ず一致しなければならない**。読み手はその値だけを見て、
 * アーカイブ本体を開かずに「このパッケージは保存されていた値を運んでいるか」を
 * 判別する。片方だけ動くと、その判別が嘘になる。
 *
 * 「在るか」と「壊れていないか」はここでは見ない —— それぞれ
 * `datapackage/resources-complete`(ZIP の実体がすべて宣言されているか)と
 * `datapackage/resource-hashes`(宣言と実体の hash 一致)が既に見ている。
 *
 * 確かめるのは 4 つ:
 *
 *   1. `valuesRecorded` とファイルの有無が一致している (**両方向**)
 *   2. 各行が JSON オブジェクトで、必須の member を持っている
 *   3. profile と stage が目録と同じ綴りである
 *   4. 目録で `unreadable` と申告された origin が、ここに行を持っていない
 *
 * 4 が要るのは、両方に書くと「読めなかった」と「読んで値が在った」を同時に
 * 主張することになるため。
 *
 * Spec: https://uraitakahito.github.io/browserhive-specs/wacz-profile/1.1.0/#storage-directory
 */
import { ok } from "../../result.js";
import {
  EXPECTED_STORAGE_PROFILE,
  EXPECTED_STORAGE_STAGE,
  isRecord,
  readCapture,
  readStorageValues,
  STORAGE_ENTRY,
  VALUE_LINE_MEMBERS,
} from "../browserhive-storage.js";
import type { Issue, ValidationRule } from "../domain.js";

const RULE = "browserhive/storage-shape";

/** 目録が `unreadable` と申告した origin。 */
const unreadableOrigins = (storage: unknown): ReadonlySet<string> => {
  const out = new Set<string>();
  if (!isRecord(storage)) return out;
  const origins = storage["origins"];
  if (!Array.isArray(origins)) return out;
  for (const entry of origins) {
    if (!isRecord(entry)) continue;
    if (entry["unreadable"] === true && typeof entry["origin"] === "string") {
      out.add(entry["origin"]);
    }
  }
  return out;
};

export const browserhiveStorageShapeRule: ValidationRule = {
  name: RULE,
  descriptionKey: `${RULE}.desc`,
  conformance: "MUST",
  docs: [
    {
      label: "BrowserHive WACZ Profile §storage directory",
      url: {
        en: "https://uraitakahito.github.io/browserhive-specs/wacz-profile/1.1.0/#storage-directory",
        ja: "https://uraitakahito.github.io/browserhive-specs/wacz-profile/1.1.0/ja/#storage-directory",
      },
    },
  ],
  applicability: {
    excludeProfiles: ["spec", "lenient"],
    profileVersions: { browserhive: ">=6.0.0" },
  },

  run: async (wacz) => {
    const capture = await readCapture(wacz);
    if (capture === undefined) return ok([]);

    const issues: Issue[] = [];
    const push = (messageKey: string, params: Record<string, string>): void => {
      issues.push({ rule: RULE, severity: "error", messageKey, params });
    };

    const storage = capture["storage"];
    const declared = isRecord(storage) ? storage["valuesRecorded"] === true : false;
    const lines = await readStorageValues(wacz);
    const present = lines !== null;

    // **両方向。** 「言ったのに無い」も「あるのに言っていない」も、読み手の判別を
    // 嘘にする。片方だけ見る形にすると、その片方は必ず見落とされる。
    if (declared && !present) {
      push(`${RULE}.declared-but-absent`, { entry: STORAGE_ENTRY });
      return ok(issues);
    }
    if (!declared && present) {
      push(`${RULE}.present-but-undeclared`, { entry: STORAGE_ENTRY });
    }
    if (lines === null) return ok(issues);

    const unreadable = unreadableOrigins(storage);

    for (const { lineNumber, parsed } of lines) {
      const line = String(lineNumber);
      if (parsed === null) {
        push(`${RULE}.not-json`, { entry: STORAGE_ENTRY, line });
        continue;
      }

      const missing = VALUE_LINE_MEMBERS.filter((m) => !(m in parsed));
      if (missing.length > 0) push(`${RULE}.missing-member`, { line, members: missing.join(", ") });

      if (parsed["profile"] !== EXPECTED_STORAGE_PROFILE) {
        push(`${RULE}.unknown-profile`, {
          line,
          found: JSON.stringify(parsed["profile"]),
          expected: EXPECTED_STORAGE_PROFILE,
        });
      }
      if (parsed["stage"] !== EXPECTED_STORAGE_STAGE) {
        push(`${RULE}.unknown-stage`, {
          line,
          found: JSON.stringify(parsed["stage"]),
          expected: EXPECTED_STORAGE_STAGE,
        });
      }

      const areas = parsed["areas"];
      if (!isRecord(areas) || !isRecord(areas["local"]) || !isRecord(areas["session"])) {
        push(`${RULE}.areas-shape`, { line });
      }

      const origin = parsed["origin"];
      if (typeof origin === "string" && unreadable.has(origin)) {
        // 目録が「読めなかった」と言った origin の値が在る。どちらかが嘘。
        push(`${RULE}.unreadable-has-values`, { line, origin });
      }
    }

    return ok(issues);
  },
};
