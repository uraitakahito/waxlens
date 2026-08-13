/**
 * throw された何か (`unknown`) を、人が読んで次の一手が決まる 1 行にする。
 *
 * 素朴に `error.message` だけを読むと、**AWS SDK 由来の失敗で情報がゼロになる**。
 * SDK は本文の無い応答 (`HeadObject` = HTTP HEAD) でエラーを組み立てるとき、
 * 説明文を埋められず `message` に `"UnknownError"` という placeholder を入れる。
 * 実際に投げられるものを覗くとこうなっている:
 *
 * | 失敗            | name       | message        | httpStatusCode |
 * | --------------- | ---------- | -------------- | -------------- |
 * | ファイルが無い  | `Error`    | `ENOENT: …`    | —              |
 * | 接続拒否        | `Error`    | `connect …`    | —              |
 * | S3 404          | `NotFound` | `UnknownError` | 404            |
 * | S3 403          | `Unknown`  | `UnknownError` | 403            |
 *
 * 上 2 つは `message` で足りていて、触ると悪化する。下 2 つは `message` が死んで
 * いて、生きているのは `name` と status。**403 は `name` も `"Unknown"` なので、
 * status を出さないと 404 と区別が付かない。**
 *
 * よってここは「使える部品を集めて繋ぐ」形にする。汎用的すぎる `name` と
 * placeholder の `message` を落とし、HTTP status があれば添える。
 */

/** `name` に入っていても何も言っていない値。落として構わない。 */
const UNINFORMATIVE_NAMES = new Set(["Error", "TypeError", "RangeError"]);

/**
 * AWS SDK が「本文が無くて説明文を作れなかった」ときに `message` へ入れる
 * placeholder。内容ではないので落とす。
 */
const PLACEHOLDER_MESSAGE = "UnknownError";

/** `$metadata.httpStatusCode` を、SDK に依存せず構造だけで取り出す。 */
const httpStatusOf = (error: object): number | undefined => {
  const metadata: unknown = (error as { $metadata?: unknown }).$metadata;
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const code: unknown = (metadata as { httpStatusCode?: unknown }).httpStatusCode;
  return typeof code === "number" ? code : undefined;
};

export const describeCause = (cause: unknown): string => {
  if (!(cause instanceof Error)) return String(cause);

  const name = UNINFORMATIVE_NAMES.has(cause.name) ? undefined : cause.name;
  const message =
    cause.message === PLACEHOLDER_MESSAGE || cause.message === "" ? undefined : cause.message;
  const status = httpStatusOf(cause);

  const head = [name, message].filter((part) => part !== undefined).join(": ");
  const parts = [head, status === undefined ? undefined : `(HTTP ${String(status)})`].filter(
    (part) => part !== undefined && part !== "",
  );

  // 全部落ちることがある (name も message も無く status も無い)。空文字を返すと
  // 呼び手の `cannot open "x": ` が尻切れになるので、その場合だけ生の message
  // まで戻る。
  return parts.length > 0 ? parts.join(" ") : cause.message;
};
