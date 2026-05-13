/**
 * WACZ fixture generator.
 *
 * Builds a minimal but spec-conformant WACZ in memory (no I/O of its own —
 * the caller chooses the output path) and exposes mutation hooks so tests
 * can produce corrupted variants without rewriting the assembly logic.
 *
 * Why this exists rather than a "good.wacz" checked-in fixture: the inputs
 * are simple, the producers (browserhive) are evolving, and we want the
 * "good" baseline to track the spec we encode here. Checking in a binary
 * blob would make the assertions opaque ("the test broke because the file
 * changed") whereas the generator's diff is reviewable.
 *
 * Layout follows browserhive's `src/storage/wacz/packager.ts`:
 *
 *   archive/data.warc.gz       STORE
 *   pages/pages.jsonl          DEFLATE
 *   indexes/index.cdxj         DEFLATE
 *   fuzzy.json                 DEFLATE
 *   datapackage.json           DEFLATE
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Writable } from "node:stream";
import { gzipSync } from "node:zlib";
// archiver 8 is ESM-only and exports per-format classes (the v7 factory
// `archiver("zip", ...)` no longer exists). Type shim lives in
// src/types/archiver.d.ts because @types/archiver still tracks the v7
// surface.
import { ZipArchive } from "archiver";

// ---------------------------------------------------------------------------
// Configuration knobs — every field that a corrupted variant might want to
// override is exposed. Defaults produce a fully-valid minimal WACZ.
// ---------------------------------------------------------------------------

export interface FixtureOptions {
  taskId?: string;
  pageUrl?: string;
  pageTitle?: string;
  capturedAt?: string;
  software?: string;
  waczVersion?: string;
  /**
   * `profile` field of datapackage.json. Set to `null` to OMIT the field
   * entirely (covers rule #1 "missing profile" case); set to a string to
   * override the value (covers "wrong profile" case).
   */
  profile?: string | null;
  /**
   * Override the body of `datapackage.json#resources[]`. When `undefined`,
   * the generator computes hashes from the actual content (the "good"
   * baseline). Pass `(default) => default.map(...)` to mutate specific
   * resources — e.g. corrupt a hash to exercise rule #5.
   */
  mutateResources?: (defaults: DatapackageResource[]) => DatapackageResource[];
  /** Replace the CDXJ filename field on every entry (rule #3). */
  cdxjFilenameOverride?: string;
  /**
   * When true, gzip the cdxj body and rename to `index.cdxj.gz` (rule #4).
   * The generator switches the zip entry name accordingly.
   */
  cdxjGzipped?: boolean;
  /**
   * When true, omit `datapackage.json` entirely. Lets rule #1 / #5 see the
   * "absent" branch.
   */
  omitDatapackage?: boolean;
}

interface DatapackageResource {
  name: string;
  path: string;
  hash: string;
  bytes: number;
}

// ---------------------------------------------------------------------------
// WARC content — a single tiny `warcinfo` record. Enough for the CDXJ to
// reference, and small enough that we can compute its hash by hand in tests
// when needed. The shape mirrors browserhive's `buildWarcInfoRecord` output.
// ---------------------------------------------------------------------------

const buildWarcInfoBytes = (software: string): Buffer => {
  const headers = [
    "WARC/1.1",
    "WARC-Type: warcinfo",
    "WARC-Record-ID: <urn:uuid:00000000-0000-0000-0000-000000000001>",
    "WARC-Date: 2026-05-13T00:00:00Z",
    "Content-Type: application/warc-fields",
    `software: ${software}`,
    "",
    "",
  ].join("\r\n");
  const body = `software: ${software}\r\n`;
  // headers already ends with \r\n\r\n; append body and terminator
  return Buffer.from(`${headers}${body}\r\n\r\n`, "utf-8");
};

const buildWarcGz = (software: string): { bytes: Buffer; recordLength: number; offset: number } => {
  const raw = buildWarcInfoBytes(software);
  const gz = gzipSync(raw);
  return { bytes: gz, recordLength: gz.byteLength, offset: 0 };
};

const buildCdxjLine = (filename: string, length: number, offset: number): string => {
  // Single line for the warcinfo record. SURT / timestamp don't matter for
  // the rules we exercise — any well-formed values work.
  const json = JSON.stringify({
    url: "about:warcinfo",
    mime: "application/warc-fields",
    status: "0",
    digest: "sha256:0000",
    length: String(length),
    offset: String(offset),
    filename,
  });
  return `about:warcinfo 20260513000000 ${json}\n`;
};

const buildPagesJsonl = (
  taskId: string,
  pageUrl: string,
  pageTitle: string,
  ts: string,
): string => {
  const header = JSON.stringify({ format: "json-pages-1.0", id: taskId, title: pageTitle });
  const entry = JSON.stringify({ id: taskId, url: pageUrl, ts, title: pageTitle });
  return `${header}\n${entry}\n`;
};

const buildFuzzyJson = (): string => `${JSON.stringify({ rules: [] }, null, 2)}\n`;

const sha256Hex = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

// ---------------------------------------------------------------------------
// Main entrypoint.
// ---------------------------------------------------------------------------

export interface BuiltFixture {
  bytes: Buffer;
}

/** Build a WACZ entirely in memory. Returns the zip bytes. */
export const buildWacz = async (options: FixtureOptions = {}): Promise<BuiltFixture> => {
  const taskId = options.taskId ?? "00000000-0000-0000-0000-000000000001";
  const pageUrl = options.pageUrl ?? "https://example.com/";
  const pageTitle = options.pageTitle ?? "Example";
  const capturedAt = options.capturedAt ?? "2026-05-13T00:00:00.000Z";
  const software = options.software ?? "waxlens-fixture/0.0.0";
  const waczVersion = options.waczVersion ?? "1.1.1";

  const warc = buildWarcGz(software);

  const cdxjFilename = options.cdxjFilenameOverride ?? "data.warc.gz";
  const cdxjBody = buildCdxjLine(cdxjFilename, warc.recordLength, warc.offset);
  const cdxjBytesPlain = Buffer.from(cdxjBody, "utf-8");
  const cdxjBytes = options.cdxjGzipped ? gzipSync(cdxjBytesPlain) : cdxjBytesPlain;
  const cdxjEntryName = options.cdxjGzipped ? "indexes/index.cdxj.gz" : "indexes/index.cdxj";

  const pagesBody = buildPagesJsonl(taskId, pageUrl, pageTitle, capturedAt);
  const pagesBytes = Buffer.from(pagesBody, "utf-8");

  const fuzzyBody = buildFuzzyJson();
  const fuzzyBytes = Buffer.from(fuzzyBody, "utf-8");

  const defaultResources: DatapackageResource[] = [
    {
      name: "data.warc.gz",
      path: "archive/data.warc.gz",
      hash: sha256Hex(warc.bytes),
      bytes: warc.bytes.byteLength,
    },
    {
      name: cdxjEntryName.split("/").pop() ?? "index.cdxj",
      path: cdxjEntryName,
      hash: sha256Hex(cdxjBytes),
      bytes: cdxjBytes.byteLength,
    },
    {
      name: "pages.jsonl",
      path: "pages/pages.jsonl",
      hash: sha256Hex(pagesBytes),
      bytes: pagesBytes.byteLength,
    },
    {
      name: "fuzzy.json",
      path: "fuzzy.json",
      hash: sha256Hex(fuzzyBytes),
      bytes: fuzzyBytes.byteLength,
    },
  ];

  const resources = options.mutateResources
    ? options.mutateResources(defaultResources)
    : defaultResources;

  const datapackage: Record<string, unknown> = {
    wacz_version: waczVersion,
    name: `waxlens-fixture-${taskId}`,
    software,
    created: capturedAt,
    mainPageURL: pageUrl,
    mainPageDate: capturedAt,
    title: pageTitle,
    resources,
  };
  if (options.profile !== null) {
    datapackage["profile"] = options.profile ?? "data-package";
  }
  const datapackageBytes = Buffer.from(`${JSON.stringify(datapackage, null, 2)}\n`, "utf-8");

  // Assemble the zip in memory by piping `archiver` to a Buffer-collecting
  // Writable. Done this way (rather than write-to-tmpfile-then-read) so the
  // tests stay hermetic — no filesystem state survives between cases.
  const chunks: Buffer[] = [];
  const collector = new Writable({
    write(chunk: Buffer, _enc, cb): void {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });

  const zip = new ZipArchive({ zlib: { level: 6 } });
  const finished = new Promise<void>((resolveFinished, rejectFinished) => {
    collector.on("finish", () => resolveFinished());
    collector.on("error", rejectFinished);
    zip.on("error", rejectFinished);
    zip.on("warning", rejectFinished);
  });

  zip.pipe(collector);

  // STORE for the inner warc.gz (already gzipped — double-compressing only
  // inflates). browserhive does the same.
  zip.append(warc.bytes, { name: "archive/data.warc.gz", store: true });
  zip.append(cdxjBytes, { name: cdxjEntryName });
  zip.append(pagesBytes, { name: "pages/pages.jsonl" });
  zip.append(fuzzyBytes, { name: "fuzzy.json" });
  if (!options.omitDatapackage) {
    zip.append(datapackageBytes, { name: "datapackage.json" });
  }

  await zip.finalize();
  await finished;

  return { bytes: Buffer.concat(chunks) };
};

/** Convenience: build a WACZ and write it to disk. */
export const buildWaczToFile = async (
  path: string,
  options: FixtureOptions = {},
): Promise<void> => {
  const { bytes } = await buildWacz(options);
  await writeFile(path, bytes);
};
