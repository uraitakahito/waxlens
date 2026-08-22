/**
 * 壊し方の一覧。
 *
 * 1 つの壊し方は「何をするか」と「それを検証すると何が出るはずか」を対で持つ。
 * 対にしておくと `--list` がそのまま案内になり、後で自動で答え合わせをしたく
 * なったときの入力にもなる —— 判定を人に任せる今の形を変えずに済む。
 */

/** アーカイブが持つ tls member(検証はしない。壊すのに必要な形だけ)。 */
export interface TlsMember {
  hosts: Record<string, Record<string, unknown> | null>;
  chains: Record<string, string[]>;
}

export interface Mutation {
  readonly name: string;
  /** これを壊したアーカイブを検証すると出るはずの messageKey。 */
  readonly expects: string;
  /**
   * 書き換える ZIP エントリ。
   *
   * `datapackage.json` 以外を選んだ場合、break-wacz が resources の hash と
   * bytes を書き直す —— 壊した覚えのない `datapackage/resource-hashes` が
   * 一緒に鳴ると、どちらが目当ての反応か読めなくなる。
   */
  readonly target: string;
  /**
   * エントリのバイト列を書き換え、新しいバイト列と「何をしたか」を返す。
   *
   * **壊せない入力では throw する。** 黙って何もせずに終わると、検証が緑のままで
   * 「rule が検出できていない」と読まれる —— 実際には壊れていないだけなのに。
   * 壊し方の嘘は rule の欠陥に化けるので、ここは失敗を隠さない。
   */
  readonly apply: (data: Buffer) => { readonly data: Buffer; readonly what: string };
}

export const DATAPACKAGE = "datapackage.json";
export const AXTREE = "accessibility/axtree.jsonl";

interface Datapackage {
  "browserhive:capture"?: { tls?: TlsMember };
  [key: string]: unknown;
}

/** `datapackage.json` の tls を書き換える壊し方を、エントリ単位の形へ包む。 */
const onTls = (
  name: string,
  expects: string,
  mutate: (tls: TlsMember) => string,
): Mutation => ({
  name,
  expects,
  target: DATAPACKAGE,
  apply: (data) => {
    const dp = JSON.parse(data.toString("utf8")) as Datapackage;
    const tls = dp["browserhive:capture"]?.tls;
    if (tls === undefined) {
      throw new Error("browserhive:capture.tls がありません (browserhive の WACZ ですか)");
    }
    const what = mutate(tls);
    return { data: Buffer.from(`${JSON.stringify(dp, null, 2)}\n`, "utf8"), what };
  },
});

/** `accessibility/axtree.jsonl` の 1 行目を書き換える壊し方を包む。 */
const onAxtree = (
  name: string,
  expects: string,
  mutate: (snapshot: Record<string, unknown>) => string,
): Mutation => ({
  name,
  expects,
  target: AXTREE,
  apply: (data) => {
    const lines = data.toString("utf8").split("\n").filter((l) => l.trim() !== "");
    const first = lines[0];
    if (first === undefined) throw new Error("axtree.jsonl が空です");
    const snapshot = JSON.parse(first) as Record<string, unknown>;
    const what = mutate(snapshot);
    lines[0] = JSON.stringify(snapshot);
    return { data: Buffer.from(`${lines.join("\n")}\n`, "utf8"), what };
  },
});

/** 木の最初のノードを返す(壊す相手として)。 */
const firstNode = (snapshot: Record<string, unknown>): Record<string, unknown> => {
  const tree = snapshot["tree"];
  if (!Array.isArray(tree) || tree.length === 0) throw new Error("tree が空です");
  const node: unknown = tree[0];
  if (typeof node !== "object" || node === null) throw new Error("ノードが読めません");
  return node as Record<string, unknown>;
};

/** chainRef を持つ host を、鍵の順に並べて返す。 */
const hostsWithChain = (tls: TlsMember): { host: string; ref: string }[] =>
  Object.entries(tls.hosts)
    .flatMap(([host, observed]) => {
      const ref: unknown = observed?.["chainRef"];
      return typeof ref === "string" ? [{ host, ref }] : [];
    })
    .sort((a, b) => a.host.localeCompare(b.host));

/** 証明書が 2 通以上あるチェーンを 1 つ選ぶ。 */
const pickMultiCertChain = (tls: TlsMember): { host: string; ref: string } => {
  const found = hostsWithChain(tls).find((h) => (tls.chains[h.ref]?.length ?? 0) >= 2);
  if (found === undefined) {
    throw new Error("2 通以上のチェーンを持つ host がありません。この壊し方は使えません");
  }
  return found;
};

export const MUTATIONS: readonly Mutation[] = [
  onTls("swap-intermediate", "browserhive/tls-chain.broken-link", (tls) => {
    // DER は正しいまま、繋がりだけを壊す。別 host のチェーンから中間を借りる。
    const target = pickMultiCertChain(tls);
    const donor = hostsWithChain(tls).find(
      (h) => h.ref !== target.ref && (tls.chains[h.ref]?.length ?? 0) >= 2,
    );
    if (donor === undefined) throw new Error("差し替え元になる別のチェーンがありません");
    const chain = tls.chains[target.ref];
    const from = tls.chains[donor.ref];
    if (chain === undefined || from?.[1] === undefined) {
      throw new Error("チェーンの中身が足りません");
    }
    chain[1] = from[1];
    return `${target.host} のチェーンの中間を ${donor.host} のものへ差し替え`;
  }),
  onTls("reverse-chain", "browserhive/tls-chain.leaf-not-first", (tls) => {
    const target = pickMultiCertChain(tls);
    tls.chains[target.ref]?.reverse();
    return `${target.host} のチェーンの並びを逆にした(リーフが末尾へ)`;
  }),
  onTls("drop-chains", "browserhive/tls-chain.dangling-ref", (tls) => {
    const refs = hostsWithChain(tls);
    if (refs.length === 0) throw new Error("chainRef を持つ host がありません");
    tls.chains = {};
    return `chains を空にした(${String(refs.length)} 件の chainRef が宙に浮く)`;
  }),
  onTls("garbage-der", "browserhive/tls-chain.unparseable", (tls) => {
    const target = hostsWithChain(tls)[0];
    if (target === undefined) throw new Error("chainRef を持つ host がありません");
    // base64 としては読めるが、証明書ではないもの。
    tls.chains[target.ref] = ["bm90IGEgY2VydGlmaWNhdGU="];
    return `${target.host} のチェーンを証明書でない base64 に差し替え`;
  }),
  onTls("san-drift", "browserhive/tls-san.drift", (tls) => {
    const entry = Object.entries(tls.hosts).find(
      ([, observed]) => Array.isArray(observed?.["san"]),
    );
    if (entry === undefined) throw new Error("san を持つ host がありません");
    const [host, observed] = entry;
    if (observed === null) throw new Error("unreachable");
    const san = observed["san"];
    if (!Array.isArray(san)) throw new Error("unreachable");
    // 証明書には無い名前を足す。数が変わるので突き合わせで落ちる。
    observed["san"] = [...(san as string[]), "not-in-the-certificate.example"];
    return `${host} の san に、証明書が持たない名前を 1 つ足した`;
  }),

  onAxtree("axtree-drop-level", "browserhive/axtree-shape.missing-member", (snapshot) => {
    // 木そのものを落とす。刈り込み規則ではなく、スナップショットの形の検査。
    delete snapshot["tree"];
    return "スナップショットから tree を落とした";
  }),
  onAxtree("axtree-unknown-property", "browserhive/axtree-shape.unknown-property", (snapshot) => {
    // profile が許していない property を 1 つ足す。producer が刈り込み規則を
    // 変えたのに版を上げなかった、という形をなぞる。
    firstNode(snapshot)["focusable"] = true;
    return "最初のノードに focusable を足した(この profile には無い property)";
  }),
  onAxtree("axtree-keep-generic", "browserhive/axtree-shape.collapsed-role", (snapshot) => {
    const tree = snapshot["tree"];
    if (!Array.isArray(tree)) throw new Error("tree が配列ではありません");
    // 畳まれているはずの role を差し込む。
    tree.unshift({ role: "generic", children: [] });
    return "畳まれているはずの generic ノードを木の先頭に差し込んだ";
  }),
  onAxtree("axtree-wrong-profile", "browserhive/axtree-shape.unknown-profile", (snapshot) => {
    snapshot["profile"] = "browserhive:axtree/99";
    return "profile を browserhive:axtree/99 に書き換えた";
  }),
];
