/**
 * 1 回の検証のあいだ、`datapackage.json` を 1 度だけ読んで解析する。
 *
 * かつては 8 つの rule と 3 つの helper がそれぞれ読んでいた。`WaczReader.readEntry`
 * は呼ばれるたびに zip から展開し直すので、同じファイル (標本で 4.5 KB) を 11 回
 * 解いて 10 回 `JSON.parse` していた。
 *
 * **ただし直す理由は速さではない。** 「不在のとき何をするか」の判断が 11 か所に
 * 散っていたことのほう —— 実際、そのうち 5 か所は「誰が不在を報告するか」を
 * 間違えて書いていた (存在しない `profile-required` を名指ししていたものが 2 つ、
 * 報告しない `datapackage/profile` を名指ししていたものが 3 つ)。判断が 1 か所に
 * 在れば、その説明も 1 か所で済む。
 *
 * `bytes` も返すのは `datapackage/digest` のため。あの rule は解析済みの
 * オブジェクトではなく、**ファイルそのもののハッシュ** を要る。
 */
import { parseDatapackage, type Datapackage } from "../wacz/datapackage.js";
import type { WaczReader } from "../wacz/reader.js";

export const DATAPACKAGE_ENTRY = "datapackage.json";

export interface DatapackageSource {
  /** エントリが無ければ `undefined`。 */
  readonly bytes: Buffer | undefined;
  /** 無い / JSON として読めない / object に shape できない場合は `null`。 */
  readonly parsed: Datapackage | null;
}

/**
 * reader ごとに 1 度だけ。
 *
 * **WeakMap にしてある。** reader は検証ごとに `WaczReader.open()` で作られて
 * 閉じられる (`daemon/handlers.ts`、`validate-cli`)。モジュール変数に持つと、
 * 2 つ目の WACZ の検証が 1 つ目の datapackage を読む —— 全 rule が別の
 * アーカイブについて判定し、しかも緑のまま通る。
 *
 * **入れるのは値ではなく Promise。** 解決済みの値を入れると、同じ tick で
 * 2 つの rule が呼んだとき両方が読みに行く。Promise なら 2 人目は待つ側に回る。
 */
const cache = new WeakMap<WaczReader, Promise<DatapackageSource>>();

export const datapackageOf = (wacz: WaczReader): Promise<DatapackageSource> => {
  const hit = cache.get(wacz);
  if (hit !== undefined) return hit;

  const pending = (async (): Promise<DatapackageSource> => {
    const bytes = await wacz.readEntry(DATAPACKAGE_ENTRY);
    return {
      bytes,
      parsed: bytes === undefined ? null : parseDatapackage(bytes.toString("utf-8")),
    };
  })();

  cache.set(wacz, pending);
  return pending;
};
