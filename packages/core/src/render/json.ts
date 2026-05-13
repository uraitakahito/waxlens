/**
 * JSON renderer.
 *
 * Emits the `Report` exactly as produced by the engine — no field
 * reshuffling, no derived fields beyond what `Report` already declares.
 * The shape is documented in `tasks/todo.md` as the M1-stable schema and
 * will be lifted to `docs/json-schema.md` in M4.
 *
 * Stable serialization: 2-space indent. Determinism matters for snapshot
 * tests; the engine already emits issues in rule registration order, so
 * a plain `JSON.stringify` is reproducible byte-for-byte.
 */
import type { Report } from "../validate/types.js";

export const renderJson = (report: Report): string => `${JSON.stringify(report, null, 2)}\n`;
