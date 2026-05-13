/**
 * pages.jsonl reader.
 *
 * The file is JSON-lines: the first line is a header object (carrying
 * `format`, `id`, `title`), every subsequent non-empty line is an entry
 * with at least `{ url, ts }` plus optional `id` / `title`. browserhive
 * emits a single entry per WACZ today; replay tools support many.
 *
 * Same shape philosophy as `datapackage.ts`: parse leniently here, let
 * the validation rules enforce semantics. M1 doesn't have a pages-jsonl
 * rule yet (rule #9, "pages.mainPageURL ↔ CDXJ integrity", lands in M3),
 * but having the parser ready means rules can compose without churn.
 */

export interface PagesJsonlHeader {
  format?: unknown;
  id?: unknown;
  title?: unknown;
  [key: string]: unknown;
}

export interface PagesJsonlEntry {
  id?: unknown;
  url?: unknown;
  ts?: unknown;
  title?: unknown;
  [key: string]: unknown;
}

export interface PagesJsonl {
  header: PagesJsonlHeader | null;
  entries: PagesJsonlEntry[];
  /**
   * 1-based line numbers that failed to parse as JSON. The presence of
   * any entry here is a strong signal of producer corruption.
   */
  parseErrorLines: number[];
}

const parseLine = (line: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
};

export const parsePagesJsonl = (text: string): PagesJsonl => {
  const lines = text.split("\n");
  let header: PagesJsonlHeader | null = null;
  const entries: PagesJsonlEntry[] = [];
  const parseErrorLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.length === 0) continue;
    const parsed = parseLine(line);
    if (parsed === null) {
      parseErrorLines.push(i + 1);
      continue;
    }
    if (header === null) {
      header = parsed;
    } else {
      entries.push(parsed);
    }
  }

  return { header, entries, parseErrorLines };
};
