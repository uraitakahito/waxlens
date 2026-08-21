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
   * tls を書き換え、何をしたかを返す。
   *
   * **壊せない入力では throw する。** 黙って何もせずに終わると、検証が緑のままで
   * 「rule が検出できていない」と読まれる —— 実際には壊れていないだけなのに。
   * 壊し方の嘘は rule の欠陥に化けるので、ここは失敗を隠さない。
   */
  readonly apply: (tls: TlsMember) => string;
}

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
  {
    name: "swap-intermediate",
    expects: "browserhive/tls-chain.broken-link",
    apply: (tls) => {
      // DER は正しいまま、繋がりだけを壊す。別 host のチェーンから中間を借りる。
      const target = pickMultiCertChain(tls);
      const donor = hostsWithChain(tls).find(
        (h) => h.ref !== target.ref && (tls.chains[h.ref]?.length ?? 0) >= 2,
      );
      if (donor === undefined) {
        throw new Error("差し替え元になる別のチェーンがありません");
      }
      const chain = tls.chains[target.ref];
      const from = tls.chains[donor.ref];
      if (chain === undefined || from?.[1] === undefined) {
        throw new Error("チェーンの中身が足りません");
      }
      chain[1] = from[1];
      return `${target.host} のチェーンの中間を ${donor.host} のものへ差し替え`;
    },
  },
  {
    name: "reverse-chain",
    expects: "browserhive/tls-chain.leaf-not-first",
    apply: (tls) => {
      const target = pickMultiCertChain(tls);
      tls.chains[target.ref]?.reverse();
      return `${target.host} のチェーンの並びを逆にした(リーフが末尾へ)`;
    },
  },
  {
    name: "drop-chains",
    expects: "browserhive/tls-chain.dangling-ref",
    apply: (tls) => {
      const refs = hostsWithChain(tls);
      if (refs.length === 0) throw new Error("chainRef を持つ host がありません");
      tls.chains = {};
      return `chains を空にした(${String(refs.length)} 件の chainRef が宙に浮く)`;
    },
  },
  {
    name: "garbage-der",
    expects: "browserhive/tls-chain.unparseable",
    apply: (tls) => {
      const target = hostsWithChain(tls)[0];
      if (target === undefined) throw new Error("chainRef を持つ host がありません");
      // base64 としては読めるが、証明書ではないもの。
      tls.chains[target.ref] = ["bm90IGEgY2VydGlmaWNhdGU="];
      return `${target.host} のチェーンを証明書でない base64 に差し替え`;
    },
  },
  {
    name: "san-drift",
    expects: "browserhive/tls-san.drift",
    apply: (tls) => {
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
    },
  },
];
