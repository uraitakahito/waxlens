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
  /**
   * When true, store the WARC entry as DEFLATE rather than STORE
   * (browserhive's invariant from packager.ts). Triggers rule #6.
   */
  warcDeflate?: boolean;
  /**
   * When set, flip a single byte at this offset of the WARC.gz bytes
   * before placing them in the zip. Used to break the gzip member
   * decoding (rule #7).
   */
  warcCorruptAt?: number;
  /**
   * When set, override the CDXJ `offset` field on every entry with this
   * value (string form, matching the producer convention). Used to
   * exercise rule #8.
   */
  cdxjOffsetOverride?: string;
  /**
   * When true, replace the CDXJ `length` field with a sentinel value
   * that won't match the actual WARC member length. Used to exercise
   * the length-mismatch branch of rule #8.
   */
  cdxjLengthMismatch?: boolean;
  /**
   * Override datapackage.mainPageURL. When this differs from `pageUrl`
   * (the URL recorded in pages.jsonl / CDXJ), rule #9 fires.
   */
  mainPageUrlOverride?: string;
  /**
   * When set, replace the body of `fuzzy.json` with the given string
   * verbatim — useful for "not JSON" / "missing rules" variants
   * (rule #11).
   */
  fuzzyOverride?: string;
  /**
   * When true, inject a deliberately-wrong `WARC-Payload-Digest` header
   * into the warcinfo record. Triggers rule #10.
   */
  payloadDigestBad?: boolean;
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

/**
 * Build a single `warcinfo` record. When `payloadDigestBad` is true, the
 * record's `WARC-Payload-Digest` is deliberately set to a fixed bogus
 * value so rule #10 fires; otherwise the digest is computed from the
 * actual body so the rule passes on the default fixture.
 */
const buildWarcInfoBytes = (software: string, payloadDigestBad: boolean): Buffer => {
  const body = `software: ${software}\r\n`;
  const bodyBuf = Buffer.from(body, "utf-8");
  const digest = payloadDigestBad
    ? "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    : sha256Base32(bodyBuf);
  const headers = [
    "WARC/1.1",
    "WARC-Type: warcinfo",
    "WARC-Record-ID: <urn:uuid:00000000-0000-0000-0000-000000000001>",
    "WARC-Date: 2026-05-13T00:00:00Z",
    `WARC-Payload-Digest: ${digest}`,
    `Content-Length: ${String(bodyBuf.byteLength)}`,
    "Content-Type: application/warc-fields",
    "",
    "",
  ].join("\r\n");
  return Buffer.concat([Buffer.from(headers, "utf-8"), bodyBuf, Buffer.from("\r\n\r\n", "utf-8")]);
};

const buildWarcGz = (
  software: string,
  opts: { payloadDigestBad: boolean; corruptAt?: number },
): { bytes: Buffer; recordLength: number; offset: number } => {
  const raw = buildWarcInfoBytes(software, opts.payloadDigestBad);
  const gz = gzipSync(raw);
  // Flip a single bit so the gzip member can no longer be decoded. Done
  // *after* gzip so the corruption is visible to the iterator (not to the
  // uncompressed raw bytes the producer thought it was writing).
  if (opts.corruptAt !== undefined && opts.corruptAt < gz.byteLength) {
    // Bounded-index write (corruptAt < gz.byteLength). The
    // security/detect-object-injection rule isn't enabled in this
    // preset; index access here is intentional fixture mutation.
    gz[opts.corruptAt] = (gz[opts.corruptAt] ?? 0) ^ 0xff;
  }
  return { bytes: gz, recordLength: gz.byteLength, offset: 0 };
};

// sha256:<base32> helper — mirrored from src/wacz/digest.ts so the fixture
// generator stays self-contained.
const sha256Base32 = (bytes: Buffer): string => {
  const digest = createHash("sha256").update(bytes).digest();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of digest) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      const ch = alphabet[(value >> bits) & 0x1f];
      if (ch !== undefined) out += ch;
    }
  }
  if (bits > 0) {
    const ch = alphabet[(value << (5 - bits)) & 0x1f];
    if (ch !== undefined) out += ch;
  }
  return `sha256:${out}`;
};

const buildCdxjLine = (
  filename: string,
  length: number,
  offset: number,
  cdxjUrl: string,
  opts: { offsetOverride?: string; lengthMismatch?: boolean },
): string => {
  // Single line for the warcinfo record. SURT / timestamp don't matter for
  // the rules we exercise — any well-formed values work.
  const json = JSON.stringify({
    url: cdxjUrl,
    mime: "application/warc-fields",
    status: "0",
    digest: "sha256:0000",
    length: opts.lengthMismatch ? String(length + 999) : String(length),
    offset: opts.offsetOverride ?? String(offset),
    filename,
  });
  return `${cdxjUrl} 20260513000000 ${json}\n`;
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

  const warc = buildWarcGz(software, {
    payloadDigestBad: options.payloadDigestBad ?? false,
    ...(options.warcCorruptAt !== undefined && { corruptAt: options.warcCorruptAt }),
  });

  const cdxjFilename = options.cdxjFilenameOverride ?? "data.warc.gz";
  // The CDXJ "url" field is the URL replay tools look up. Use pageUrl so
  // rule #9 sees the mainPageURL covered when nothing else overrides it.
  const cdxjBody = buildCdxjLine(cdxjFilename, warc.recordLength, warc.offset, pageUrl, {
    ...(options.cdxjOffsetOverride !== undefined && {
      offsetOverride: options.cdxjOffsetOverride,
    }),
    ...(options.cdxjLengthMismatch !== undefined && {
      lengthMismatch: options.cdxjLengthMismatch,
    }),
  });
  const cdxjBytesPlain = Buffer.from(cdxjBody, "utf-8");
  const cdxjBytes = options.cdxjGzipped ? gzipSync(cdxjBytesPlain) : cdxjBytesPlain;
  const cdxjEntryName = options.cdxjGzipped ? "indexes/index.cdxj.gz" : "indexes/index.cdxj";

  const pagesBody = buildPagesJsonl(taskId, pageUrl, pageTitle, capturedAt);
  const pagesBytes = Buffer.from(pagesBody, "utf-8");

  const fuzzyBody = options.fuzzyOverride ?? buildFuzzyJson();
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
    mainPageURL: options.mainPageUrlOverride ?? pageUrl,
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

  // STORE for the inner warc.gz by default (already gzipped — double-
  // compressing only inflates). `warcDeflate` flips this to DEFLATE so
  // we can exercise rule #6.
  zip.append(warc.bytes, {
    name: "archive/data.warc.gz",
    store: !(options.warcDeflate ?? false),
  });
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
