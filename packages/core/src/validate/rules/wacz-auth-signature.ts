/**
 * Rule: wacz-auth/signature
 *
 * `datapackage-digest.json` の `signedData` が、**それ自身の中身と辻褄が合って
 * いるか**。
 *
 * 確かめるのは 2 つだけ:
 *
 *   1. `signature` が、`domainCert` の先頭証明書の鍵で `hash` を覆っている
 *   2. その証明書が `domain` を覆っている
 *
 * ## 2 つだけである理由
 *
 * wacz-auth の検証は 4 段ある。残りの 2 段 —— チェーンが信頼できる root へ辿り
 * 着くか、timestamp が有効か —— は**呼ぶ側が持ち込む知識**を要求する。
 * この rule はそれを採らない。`browserhive/tls-chain` が同じ問いに先に答えて
 * いる: 「ルートストアは検査する側のもので、時とともに変わる。『今日通る
 * アーカイブが来年落ちる』判定は、アーカイブについての事実ではない」。
 *
 * ここが答えるのも同じ —— **このパッケージが持っているものだけで言えるか**。
 * trust anchor と RFC 3161 は `capping verify` の持ち場で、あちらは 4 段すべてを
 * `ok / failed / skipped` の 3 値で報告する。
 *
 * ## それでも塞がる穴
 *
 * 「改竄された `signedData` は waxlens を通り、`capping verify` でだけ落ちる」と
 * 記録されていた穴は、これで閉じる。改竄は 1 の署名検証を壊すので、anchor を
 * 一切持ち込まずに検出できる。`datapackage/digest` は `hash` が
 * `datapackage.json` と一致するかまでは見るが、**その `hash` に誰が署名したかは
 * 見ていない**。
 *
 * ## 署名が無いアーカイブについては何も言わない
 *
 * `signedData` の不在は違反ではない —— wacz-auth には匿名形式もあり、署名自体が
 * SHOULD。エントリごと無い場合は `datapackage/digest.absent` が既に扱っている。
 *
 * Spec: https://specs.webrecorder.net/wacz-auth/0.1.0/
 */
import { X509Certificate, verify as cryptoVerify } from "node:crypto";
import { Buffer } from "node:buffer";

import { ok } from "../../result.js";
import type { Issue, ValidationRule } from "../domain.js";

const RULE = "wacz-auth/signature";
const DIGEST_ENTRY = "datapackage-digest.json";

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * PEM のチェーンを先頭から証明書へ。1 本でも壊れていれば `null`。
 *
 * `browserhive-tls.ts` の `parseChain` は使えない —— あちらは base64 DER の配列を
 * 受ける形で、`domainCert` は PEM のブロックが連なった 1 つの文字列。
 */
const parsePemChain = (pem: string): X509Certificate[] | null => {
  const blocks = pem.match(PEM_BLOCK) ?? [];
  if (blocks.length === 0) return null;
  try {
    return blocks.map((block) => new X509Certificate(block));
  } catch {
    return null;
  }
};

export const waczAuthSignatureRule: ValidationRule = {
  // docs-site/src/lib/extract.ts がソースを正規表現で読むので、
  // ここは定数ではなくリテラルで書く。
  name: "wacz-auth/signature",
  descriptionKey: "wacz-auth/signature.desc",
  conformance: "MUST",
  docs: [
    {
      label: "wacz-auth 0.1.0 §Domain-Ownership Identity",
      url: {
        en: "https://specs.webrecorder.net/wacz-auth/0.1.0/",
        ja: "https://uraitakahito.github.io/specs/wacz-auth/0.1.0/",
      },
    },
  ],

  run: async (wacz) => {
    const issues: Issue[] = [];
    const push = (messageKey: string, params: Record<string, string>): void => {
      issues.push({ rule: RULE, severity: "error", messageKey, params });
    };

    const raw = await wacz.readEntry(DIGEST_ENTRY);
    // エントリの不在は datapackage/digest の持ち場。
    if (raw === undefined) return ok(issues);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf-8"));
    } catch {
      // 読めない JSON も datapackage/digest が既に報告している。重ねない。
      return ok(issues);
    }
    if (!isRecord(parsed)) return ok(issues);

    const signedData = parsed["signedData"];
    // 署名を持たないアーカイブは違反ではない。
    if (!isRecord(signedData)) return ok(issues);

    const hash = signedData["hash"];
    const signature = signedData["signature"];
    const domain = signedData["domain"];
    const domainCert = signedData["domainCert"];

    const missing = (["hash", "signature", "domain", "domainCert"] as const).filter(
      (m) => typeof signedData[m] !== "string",
    );
    if (missing.length > 0) {
      push(`${RULE}.missing-member`, { members: missing.join(", ") });
      // 揃っていない形に暗号の検査を当てても、言えることは増えない。
      return ok(issues);
    }

    const chain = parsePemChain(domainCert as string);
    const leaf = chain?.[0];
    if (leaf === undefined) {
      push(`${RULE}.cert-unparseable`, {});
      return ok(issues);
    }

    // 1. 署名。対象は `hash` の**文字列そのもの** —— `sha256:` の接頭辞を含み、
    //    末尾に改行を付けない。producer が署名したのと同じバイト列でなければ、
    //    正しい署名でも通らない。
    const signed = ((): boolean => {
      try {
        return cryptoVerify(
          "sha256",
          Buffer.from(hash as string),
          leaf.publicKey,
          Buffer.from(signature as string, "base64"),
        );
      } catch {
        // 壊れた base64 も、鍵と合わない曲線も、ここでは同じ「検証できない」。
        return false;
      }
    })();
    if (!signed) {
      push(`${RULE}.signature-mismatch`, {});
    }

    // 2. 名乗ったドメインを、署名した証明書と突き合わせる。`checkHost` は TLS の
    //    クライアントと同じ照合規則 (ワイルドカードと subjectAltName を含む) を
    //    当てる —— CN を手で比べる形にすると、そこが食い違う。
    if (leaf.checkHost(domain as string) === undefined) {
      push(`${RULE}.domain-mismatch`, { domain: domain as string });
    }

    // 問題が無くても「何を確かめたか」を残す。出さないと、署名を検証していない
    // アーカイブと、検証して通ったアーカイブが同じ見た目になる。
    if (issues.length === 0) {
      issues.push({
        rule: RULE,
        severity: "info",
        messageKey: `${RULE}.verified`,
        params: { domain: domain as string },
      });
    }

    return ok(issues);
  },
};
