/**
 * datapackage.json schema (Frictionless Data Package).
 *
 * We intentionally keep the zod schema *loose*: every WACZ-mandated field
 * (`profile`, `wacz_version`, `resources[*].hash`, …) is typed as
 * `unknown` so individual validation rules can produce a precise diagnosis
 * instead of zod failing the whole parse at the first missing key. The
 * shape we DO enforce is "it's a JSON object" — `passthrough()` keeps
 * extra fields, since producers commonly emit `mainPageURL`, `software`,
 * etc. and other producer-specific keys.
 *
 * Spec: WACZ 1.1 §datapackage.json (built on the Frictionless Data
 *       Package descriptor).
 * Reference producer: browserhive's `src/storage/wacz/datapackage.ts`.
 */
import { z } from "zod";

/**
 * Per-resource record inside `resources[]`. Every field is `.optional()` —
 * not because the spec allows omission, but because rule implementations
 * (datapackage-hashes.ts) want to surface a *specific* "this resource is
 * missing field X" issue rather than have zod reject the whole parse.
 *
 * NB: zod v4 made `z.unknown()` non-optional by default (a breaking change
 * from v3). The `.optional()` suffix restores the v3-equivalent shape we
 * want for permissive WACZ parsing.
 */
export const DatapackageResourceSchema = z
  .object({
    name: z.unknown().optional(),
    path: z.unknown().optional(),
    hash: z.unknown().optional(),
    bytes: z.unknown().optional(),
  })
  .passthrough();

export const DatapackageSchema = z
  .object({
    profile: z.unknown().optional(),
    // snake_case key required by the WACZ spec; lint's naming-convention
    // rule isn't enabled in this preset, so no eslint-disable is needed.
    wacz_version: z.unknown().optional(),
    name: z.unknown().optional(),
    software: z.unknown().optional(),
    created: z.unknown().optional(),
    mainPageURL: z.unknown().optional(),
    mainPageDate: z.unknown().optional(),
    title: z.unknown().optional(),
    resources: z.array(DatapackageResourceSchema).optional(),
  })
  .passthrough();

export type DatapackageResource = z.infer<typeof DatapackageResourceSchema>;
export type Datapackage = z.infer<typeof DatapackageSchema>;

/**
 * Parse the raw JSON text. Returns `null` for any failure (not JSON, or
 * not even an object) — the caller's rule reports the specific reason as
 * an Issue, so this layer only needs to gatekeep "did it shape into an
 * object at all".
 */
export const parseDatapackage = (text: string): Datapackage | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const result = DatapackageSchema.safeParse(raw);
  return result.success ? result.data : null;
};
