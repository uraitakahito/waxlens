/**
 * `--server <url>` の値オブジェクト。`ServerEndpoint.parse` だけが生成でき
 * (private constructor で封印)、`ws://` / `wss://` + host を持つ URL のみを通す。
 * これにより startDaemon / connect は「検証済み ServerEndpoint」だけを受け取り、
 * 未検証の文字列はコンパイル時に弾かれる(core の AbsolutePath と同じ発想を class で)。
 */
import { InvalidArgumentError } from "commander";

export class ServerEndpoint {
  readonly url: URL;

  // 外から new させず、生成経路を parse に一本化する(※ param-property は lint 禁止 → 明示代入)。
  private constructor(url: URL) {
    this.url = url;
  }

  static parse(raw: string): ServerEndpoint {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new InvalidArgumentError(`"${raw}" is not a URL. Expected e.g. ws://127.0.0.1:7333.`);
    }
    // ws/wss は WHATWG の special scheme。host が空だと new URL が throw する
    // (上の catch で弾かれる)ので、scheme さえ確認すれば host は必ず非空。
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new InvalidArgumentError(`--server must be a ws:// or wss:// URL (got "${url.protocol}//…").`);
    }
    return new ServerEndpoint(url);
  }
}
