#!/usr/bin/env node
/**
 * `waxlens-break` —— WACZ をわざと壊し、rule が反応することを確かめるための道具。
 *
 * validator の「緑」は 2 通りの意味を持つ: 検査して問題が無かったのか、そもそも
 * 検査していないのか。区別する方法は 1 つで、**壊して赤くなるところを見る**こと。
 * その 1 手間を毎回スクリプトに書き直さずに済むよう、壊し方をここに集める。
 *
 * 判定はしない。壊した WACZ を書き出すところまでで、赤くなったかは
 * `waxlens-validate` に渡して読む —— 道具が「壊した」と「検出された」の両方を
 * 名乗ると、どちらが嘘をついたのか分からなくなる。
 *
 * publish しない (`private`)。壊し方はまだ browserhive の `tls` に固有で、他の
 * rule に効く形が見えていない —— 製品の bin に上げるのはその後で足りる。
 */
import { createWriteStream } from "node:fs";
import { argv, exit, stdout } from "node:process";
import { pipeline } from "node:stream/promises";
import { Command } from "commander";
import { ZipArchive } from "archiver";
import { open } from "yauzl-promise";
import { MUTATIONS, type TlsMember } from "./mutations.js";

const DATAPACKAGE = "datapackage.json";

interface Datapackage {
  "browserhive:capture"?: { tls?: TlsMember };
  [key: string]: unknown;
}

/** zip の全 entry を名前 → 中身で読み出す。 */
const readEntries = async (path: string): Promise<Map<string, Buffer>> => {
  const zip = await open(path);
  const out = new Map<string, Buffer>();
  try {
    for await (const entry of zip) {
      if (entry.filename.endsWith("/")) continue;
      const stream = await entry.openReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      out.set(entry.filename, Buffer.concat(chunks));
    }
  } finally {
    await zip.close();
  }
  return out;
};

const writeZip = async (path: string, entries: Map<string, Buffer>): Promise<void> => {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const sink = createWriteStream(path);
  const done = pipeline(archive, sink);
  for (const [name, data] of entries) archive.append(data, { name });
  await archive.finalize();
  await done;
};

const main = async (): Promise<void> => {
  const program = new Command()
    .name("waxlens-break")
    .description("WACZ をわざと壊し、rule が反応することを確かめる (開発用)")
    .argument("[source]", "壊す元の .wacz")
    .argument("[dest]", "書き出す先の .wacz")
    .option("-m, --mutation <name>", "壊し方の名前")
    .option("-l, --list", "壊し方の一覧を出す")
    .parse(argv);

  const opts = program.opts<{ mutation?: string; list?: boolean }>();
  const [source, dest] = program.args;

  if (opts.list === true || source === undefined || dest === undefined) {
    stdout.write("壊し方と、それが出させる報告:\n\n");
    for (const m of MUTATIONS) stdout.write(`  ${m.name.padEnd(20)} → ${m.expects}\n`);
    stdout.write("\n  例: waxlens-break sample.wacz broken.wacz -m swap-intermediate\n");
    return;
  }

  const mutation = MUTATIONS.find((m) => m.name === opts.mutation);
  if (mutation === undefined) {
    // 名前を間違えたまま「壊した」と思い込むのが最悪なので、黙って既定を選ばない。
    stdout.write(`壊し方 '${opts.mutation ?? "(未指定)"}' は知りません。--list を見てください\n`);
    exit(2);
    return;
  }

  const entries = await readEntries(source);
  const raw = entries.get(DATAPACKAGE);
  if (raw === undefined) throw new Error(`${source}: ${DATAPACKAGE} がありません`);

  const dp = JSON.parse(raw.toString("utf8")) as Datapackage;
  const tls = dp["browserhive:capture"]?.tls;
  if (tls === undefined) {
    throw new Error(`${source}: browserhive:capture.tls がありません (browserhive の WACZ ですか)`);
  }

  const what = mutation.apply(tls);
  entries.set(DATAPACKAGE, Buffer.from(`${JSON.stringify(dp, null, 2)}\n`, "utf8"));
  await writeZip(dest, entries);

  stdout.write(`壊しました: ${what}\n`);
  stdout.write(`  → ${dest}\n`);
  stdout.write(`期待する報告: ${mutation.expects}\n`);
};

await main();
