/**
 * WaczReader
 *
 * Thin wrapper over `yauzl-promise` that exposes WACZ-shaped accessors:
 *   - `entryNames()` — list of zip entry paths
 *   - `readEntry(name)` — full Buffer of an entry (eager)
 *   - `getEntryMeta(name)` — { compressionMethod, compressedSize, uncompressedSize }
 *     so rules can assert e.g. `archive/data.warc.gz` is STORE (method 0)
 *
 * yauzl-promise is callback-based underneath; `.entries()` returns an async
 * iterator. We iterate once at `open()` time to build a name → entry map.
 * Real-world WACZ archives have a few dozen entries at most, so the memory
 * cost (one entry record per file) is negligible and the map gives O(1)
 * lookups for the validation rules.
 *
 * The reader keeps the zip handle open until `close()` is called — rule
 * runners do this in `finally` so a failed validation can't leak fds.
 */
import { open as openZip, type Entry, type ZipFile } from "yauzl-promise";

/**
 * Compression method numbers from the zip spec (PKWARE APPNOTE.TXT §4.4.5).
 * Only two matter for WACZ today: STORE (no compression) and DEFLATE.
 */
export const ZIP_COMPRESSION_STORE = 0;
export const ZIP_COMPRESSION_DEFLATE = 8;

export interface ZipEntryMeta {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
}

export class WaczReader {
  private readonly zip: ZipFile;
  private readonly entries: Map<string, Entry>;

  private constructor(zip: ZipFile, entries: Map<string, Entry>) {
    this.zip = zip;
    this.entries = entries;
  }

  static async open(path: string): Promise<WaczReader> {
    const zip = await openZip(path);
    const entries = new Map<string, Entry>();
    for await (const entry of zip) {
      // yauzl's Entry exposes `filename` (the in-zip path). Directory
      // entries end with `/`; we keep them in the map so callers that
      // care can detect them, but the M1 rules only look at file entries.
      entries.set(entry.filename, entry);
    }
    return new WaczReader(zip, entries);
  }

  entryNames(): string[] {
    return Array.from(this.entries.keys());
  }

  hasEntry(name: string): boolean {
    return this.entries.has(name);
  }

  /**
   * Per-entry metadata without reading the payload. Used by rules that only
   * care about how an entry was stored in the zip (e.g. rule #6: WARC must
   * be STORE so the inner gzip isn't double-compressed).
   */
  getEntryMeta(name: string): ZipEntryMeta | undefined {
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    return {
      name: entry.filename,
      compressionMethod: entry.compressionMethod,
      compressedSize: Number(entry.compressedSize),
      uncompressedSize: Number(entry.uncompressedSize),
    };
  }

  /**
   * Read the full uncompressed payload of an entry. WACZ archives are
   * bounded in practice by producer-side caps (browserhive: 200 MB, pywb /
   * browsertrix-crawler: configurable but rarely above a few GB), so
   * loading whole entries into a Buffer is acceptable today — the
   * alternative (streaming + on-the-fly hashing) becomes worth the
   * complexity only if we ever need to validate multi-GB archives.
   */
  async readEntry(name: string): Promise<Buffer | undefined> {
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    const stream = await entry.openReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async close(): Promise<void> {
    await this.zip.close();
  }
}
