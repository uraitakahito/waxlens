/**
 * Minimal type shim for archiver 8.x.
 *
 * archiver 8 is ESM-only and dropped the v7 factory function
 * (`archiver(format, options)`) in favour of per-format classes
 * (`new ZipArchive(opts)`). DefinitelyTyped's `@types/archiver` still
 * tracks the v7 factory shape, so we declaration-merge the class API on
 * top of it for the surface this codebase consumes.
 *
 * Same shape browserhive uses (see browserhive/src/types/archiver.d.ts).
 * Drop this file once `@types/archiver@^8` lands upstream.
 */
declare module "archiver" {
  export class ZipArchive {
    constructor(options?: { zlib?: { level?: number } });
    append(source: Buffer | string, data: { name: string; store?: boolean }): this;
    finalize(): Promise<void>;
    pipe<T>(destination: T): T;
    on(event: "error" | "warning", listener: (err: Error & { code?: string }) => void): this;
  }
}
