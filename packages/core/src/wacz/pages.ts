/**
 * pages.jsonl reader。
 *
 * ファイルは JSON-lines: 最初の行は header object (`format`、`id`、
 * `title` を持つ)、それ以降の非空行は entry で、少なくとも
 * `{ url, ts }` を持ち、`id` / `title` は optional。producer は
 * 1 ページ capture では 1 つの entry を出すのが普通だが、replay
 * ツールは multi-page archive のために多数の entry をサポートする。
 *
 * `datapackage.ts` と同じ思想: ここは緩く parse して、semantics は
 * validation rule に任せる。pages-jsonl の field を見る rule
 * (`cdxj/pages-mainpage` 等) はこの parser を経由する。
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
