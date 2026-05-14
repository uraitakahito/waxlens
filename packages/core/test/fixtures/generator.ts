/**
 * WACZ fixture generator。
 *
 * メモリ上で最小だが spec 準拠の WACZ を組み立てる (それ自身は I/O
 * を持たない — 呼び出し側が出力先を選ぶ)。mutation hook を露出して
 * いるので、組み立てロジックを書き直さずに、test が corrupted な
 * バリアントを生成できる。
 *
 * "good.wacz" をチェックイン fixture にしないのはなぜか: 入力は
 * シンプル、producer (browserhive) は進化中で、"good" の baseline は
 * ここで encode する spec を追いかけたい。バイナリ blob をチェック
 * インすると assertion が opaque になる ("ファイルが変わったので
 * test が壊れた")。generator なら diff が review 可能。
 *
 * レイアウトは browserhive の `src/storage/wacz/packager.ts` に従う:
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
// archiver 8 は ESM-only で、format ごとのクラスを export する
// (v7 の factory `archiver("zip", ...)` はもう存在しない)。
// @types/archiver は依然 v7 の surface を tracking しているので
// type shim を src/types/archiver.d.ts に置いている。
import { ZipArchive } from "archiver";

// ---------------------------------------------------------------------------
// 設定 knob — corrupted バリアントが上書きしたいと思う各 field を露出
// する。デフォルトは完全に valid な最小 WACZ を生成する。
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
  /**
   * Producer flavour. Controls indexing layout:
   *
   *   - `"browserhive"` (default): emit a single plain
   *     `indexes/index.cdxj`. Matches BrowserHive's producer
   *     conventions and the `browserhive` rule profile's
   *     expectations.
   *   - `"webrecorder"`: emit `indexes/index.cdx.gz` (gzipped CDXJ
   *     content) paired with `indexes/index.idx` carrying the
   *     `!meta { format: "cdxj-gzip-1.0", filename: "index.cdx.gz" }`
   *     header. Matches Webrecorder's example archives and the
   *     pywb / wacz-creator convention.
   *
   * Independent of `cdxjGzipped` — the older option only rewrote the
   * BrowserHive layout's filename. `producer: "webrecorder"` emits
   * the full pair.
   */
  producer?: "browserhive" | "webrecorder";
}

interface DatapackageResource {
  name: string;
  path: string;
  hash: string;
  bytes: number;
}

// ---------------------------------------------------------------------------
// WARC コンテンツ — 単一の最小 `warcinfo` レコード。CDXJ が参照する
// には十分で、必要なら test 内で手計算できる程度には小さい。形状は
// browserhive の `buildWarcInfoRecord` の出力に揃えている。
// ---------------------------------------------------------------------------

/**
 * 単一の `warcinfo` レコードを組み立てる。`payloadDigestBad` が true
 * のとき、`WARC-Payload-Digest` を意図的に固定の偽値にセットして
 * rule #10 を発火させる。それ以外のときは実体 body から digest を
 * 計算して、デフォルト fixture では rule が pass する。
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
  // bit を 1 つ反転して gzip member が decode できないようにする。
  // gzip *の後* に corrupt させているのは、corruption が iterator に
  // 可視であってほしいため (producer が書こうとした uncompressed な
  // raw bytes に corruption を入れるのではない)。
  if (opts.corruptAt !== undefined && opts.corruptAt < gz.byteLength) {
    // 範囲付き index 書き込み (corruptAt < gz.byteLength)。
    // security/detect-object-injection rule はこの preset では無効。
    // ここでの index アクセスは意図的な fixture mutation。
    gz[opts.corruptAt] = (gz[opts.corruptAt] ?? 0) ^ 0xff;
  }
  return { bytes: gz, recordLength: gz.byteLength, offset: 0 };
};

// sha256:<base32> 用ヘルパ — fixture generator を self-contained に
// 保つために src/wacz/digest.ts のものをミラーしている。
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
  // warcinfo レコード 1 件の 1 行。ここで動かす rule にとって SURT /
  // timestamp は問題にならない — well-formed なら何でも動く。
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
// メインエントリポイント。
// ---------------------------------------------------------------------------

export interface BuiltFixture {
  bytes: Buffer;
}

/** WACZ を完全にメモリ上で組み立てる。zip の bytes を返す。 */
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
  // CDXJ "url" field は replay ツールが lookup する URL。何も
  // override しないとき rule #9 が mainPageURL を cover できるよう、
  // pageUrl を使う。
  const cdxjBody = buildCdxjLine(cdxjFilename, warc.recordLength, warc.offset, pageUrl, {
    ...(options.cdxjOffsetOverride !== undefined && {
      offsetOverride: options.cdxjOffsetOverride,
    }),
    ...(options.cdxjLengthMismatch !== undefined && {
      lengthMismatch: options.cdxjLengthMismatch,
    }),
  });
  const cdxjBytesPlain = Buffer.from(cdxjBody, "utf-8");

  // Index レイアウト — producer + legacy な `cdxjGzipped` knob に依存。
  //
  //   * producer "browserhive" (デフォルト) + cdxjGzipped=false →
  //     `indexes/index.cdxj` の単一 entry (plain text)
  //   * producer "browserhive" + cdxjGzipped=true →
  //     `indexes/index.cdxj.gz` の単一 entry (ペア無し)。
  //     `cdxj/index-not-gzipped` (browserhive profile) AND
  //     `cdxj/index-recognised-by-wabac` (認識可能 index 無し) を
  //     動かすため。
  //   * producer "webrecorder" → `indexes/index.cdx.gz` 加えて
  //     gzip ペアを名指す `!meta` header を持つ
  //     `indexes/index.idx`。Webrecorder / pywb の wacz-creator
  //     出力をミラー。
  const producer = options.producer ?? "browserhive";

  interface IndexEntry {
    name: string;
    bytes: Buffer;
  }
  const indexEntries: IndexEntry[] = [];
  if (producer === "webrecorder") {
    const cdxGz = gzipSync(cdxjBytesPlain);
    indexEntries.push({ name: "indexes/index.cdx.gz", bytes: cdxGz });
    const idxText =
      `!meta ${JSON.stringify({ format: "cdxj-gzip-1.0", filename: "index.cdx.gz" })}\n` + cdxjBody;
    indexEntries.push({ name: "indexes/index.idx", bytes: Buffer.from(idxText, "utf-8") });
  } else {
    const cdxjEntryName = options.cdxjGzipped ? "indexes/index.cdxj.gz" : "indexes/index.cdxj";
    const cdxjBytes = options.cdxjGzipped ? gzipSync(cdxjBytesPlain) : cdxjBytesPlain;
    indexEntries.push({ name: cdxjEntryName, bytes: cdxjBytes });
  }

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
    ...indexEntries.map((e) => ({
      name: e.name.split("/").pop() ?? e.name,
      path: e.name,
      hash: sha256Hex(e.bytes),
      bytes: e.bytes.byteLength,
    })),
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

  // `archiver` を Buffer-collecting な Writable に pipe してメモリ上
  // で zip を組み立てる。tmp ファイルに書いてから読む方式ではなく
  // こうしているのは、test を hermetic に保つため — ケース間で
  // ファイルシステム状態が残らない。
  const chunks: Buffer[] = [];
  const collector = new Writable({
    write(chunk: Buffer, _enc, cb): void {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });

  const zip = new ZipArchive({ zlib: { level: 6 } });
  const finished = new Promise<void>((resolveFinished, rejectFinished) => {
    collector.on("finish", () => {
      resolveFinished();
    });
    collector.on("error", rejectFinished);
    zip.on("error", rejectFinished);
    zip.on("warning", rejectFinished);
  });

  zip.pipe(collector);

  // 内側の warc.gz はデフォルトで STORE (既に gzip 済み — 二重圧縮
  // するとサイズが膨らむだけ)。`warcDeflate` で DEFLATE に切り替えて
  // rule #6 を動かす。
  zip.append(warc.bytes, {
    name: "archive/data.warc.gz",
    store: !(options.warcDeflate ?? false),
  });
  for (const entry of indexEntries) {
    zip.append(entry.bytes, { name: entry.name });
  }
  zip.append(pagesBytes, { name: "pages/pages.jsonl" });
  zip.append(fuzzyBytes, { name: "fuzzy.json" });
  if (!options.omitDatapackage) {
    zip.append(datapackageBytes, { name: "datapackage.json" });
  }

  await zip.finalize();
  await finished;

  return { bytes: Buffer.concat(chunks) };
};

/** 便利関数: WACZ を組み立ててディスクに書き出す。 */
export const buildWaczToFile = async (
  path: string,
  options: FixtureOptions = {},
): Promise<void> => {
  const { bytes } = await buildWacz(options);
  await writeFile(path, bytes);
};
