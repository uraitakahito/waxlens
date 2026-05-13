/**
 * archiver 8.x 用の最小 type shim。
 *
 * archiver 8 は ESM 専用で、v7 の factory 関数
 * (`archiver(format, options)`) は廃止され、format ごとのクラス
 * (`new ZipArchive(opts)`) に置き換えられた。DefinitelyTyped の
 * `@types/archiver` はまだ v7 の factory 形しか追っていないので、
 * このコードベースが消費する surface についてだけ class API を
 * declaration-merge で重ねている。
 *
 * `@types/archiver@^8` が upstream に出たらこのファイルは削除する。
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
