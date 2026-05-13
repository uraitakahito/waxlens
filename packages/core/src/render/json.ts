/**
 * JSON renderer。
 *
 * engine が生成する `Report` をそのまま出力する — field の並べ替えも、
 * `Report` が宣言していない派生 field の追加もしない。shape の
 * ドキュメントは `tasks/todo.md` で M1-stable schema として書かれていて、
 * M4 で `docs/json-schema.md` に格上げされる予定。
 *
 * 安定したシリアライゼーション: 2 スペースインデント。snapshot test では
 * 決定性が重要だが、engine は rule 登録順で issue を出力し、ここでは
 * 単純な `JSON.stringify` を使うので、バイト単位で再現可能。
 */
import type { Report } from "../validate/types.js";

export const renderJson = (report: Report): string => `${JSON.stringify(report, null, 2)}\n`;
