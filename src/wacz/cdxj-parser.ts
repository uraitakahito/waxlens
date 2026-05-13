/**
 * CDXJ parser.
 *
 * Each non-empty line of `indexes/index.cdxj` has the shape:
 *
 *   <surt-url> <yyyymmddhhmmss> <json>
 *
 * Lines are separated by `\n`. Empty lines and a trailing newline are
 * tolerated. The first two whitespace-separated tokens are the SURT and
 * the 14-digit timestamp; everything after the second space is the JSON
 * object describing the record (url / mime / status / digest / length /
 * offset / filename). See browserhive's `src/storage/wacz/cdxj.ts` for
 * the producer side.
 *
 * Splitting strategy: the JSON value itself contains spaces (`": "` etc.),
 * so naïve `.split(" ")` would corrupt it. We find the first two space
 * indices and slice — `String#indexOf` two times is faster and clearer
 * than a regex with capture groups for what amounts to a fixed shape.
 */
import { err, ok, type Result } from "../result.js";

export interface CdxjEntry {
  /** SURT (Sort-friendly URI Reordering Transform) of the captured URL. */
  surt: string;
  /** 14-digit timestamp `yyyymmddhhmmss`. */
  timestamp: string;
  /** Parsed JSON object (whatever the producer wrote — typed as Record for downstream rules to narrow). */
  fields: Record<string, unknown>;
}

export interface CdxjLineError {
  /** 1-based line number in the source CDXJ text. */
  line: number;
  /** The offending line (truncated to 200 chars to keep error reports bounded). */
  rawLine: string;
  reason:
    | "missing-fields" // Couldn't find two whitespace separators.
    | "invalid-json" // The JSON tail did not parse.
    | "json-not-object" // The JSON parsed but wasn't an object literal.
    | "empty-surt-or-timestamp"; // First two tokens empty.
}

export interface CdxjParseResult {
  entries: CdxjEntry[];
  errors: CdxjLineError[];
}

const MAX_RAW_LINE_LEN = 200;

/**
 * Parse a CDXJ document. Always returns a result with both arrays — the
 * caller decides whether the presence of `errors` is a validation failure
 * or just informational. (M1's CDXJ-related rule cares only about the
 * parsed entries' `filename` field, so per-line parse errors land in the
 * `errors` array without short-circuiting.)
 */
export const parseCdxj = (text: string): CdxjParseResult => {
  const entries: CdxjEntry[] = [];
  const errors: CdxjLineError[] = [];

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    if (rawLine.length === 0) continue;

    const parsed = parseLine(rawLine);
    if (parsed.ok) {
      entries.push(parsed.value);
    } else {
      errors.push({
        line: i + 1,
        rawLine: rawLine.slice(0, MAX_RAW_LINE_LEN),
        reason: parsed.error,
      });
    }
  }

  return { entries, errors };
};

const parseLine = (line: string): Result<CdxjEntry, CdxjLineError["reason"]> => {
  const firstSpace = line.indexOf(" ");
  if (firstSpace === -1) return err("missing-fields");
  const secondSpace = line.indexOf(" ", firstSpace + 1);
  if (secondSpace === -1) return err("missing-fields");

  const surt = line.slice(0, firstSpace);
  const timestamp = line.slice(firstSpace + 1, secondSpace);
  const json = line.slice(secondSpace + 1);

  if (surt.length === 0 || timestamp.length === 0) {
    return err("empty-surt-or-timestamp");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(json);
  } catch {
    return err("invalid-json");
  }

  if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
    return err("json-not-object");
  }

  return ok({
    surt,
    timestamp,
    fields: parsedJson as Record<string, unknown>,
  });
};
