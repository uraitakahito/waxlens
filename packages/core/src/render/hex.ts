/**
 * Hex dump 行フォーマッタ。
 *
 * 両 renderer (plain text + Ink TUI) が詳細 view にそのまま流し込める
 * よう、classic な `xxd` スタイルの出力を生成する。各行は 16 バイトを
 * カバー:
 *
 *   00000000  4e a7 5b 0c 1f 8b 08 00  00 00 00 00 00 03 b5 d3   N.[..........X..
 *
 * printable ASCII 範囲外のバイトは末尾の ASCII カラムでは `.` として
 * 表示する。hex バイトはスペース区切りで、8 バイト目の後にやや広い
 * 区切りを入れる (xxd の慣習)。これにより目で特定カラムを素早く
 * 追える。
 */

const BYTES_PER_LINE = 16;
const HALF = 8;

/**
 * Buffer の slice を hex-dump 行列として render する。`offsetBase` は
 * バイトインデックスに加算されるので、実ファイルの offset を追って
 * いる呼び出し側でも正しいカラムラベルが得られる (ファイル offset
 * 1024 にある WARC member は、最初の hex 行を `00000000` ではなく
 * `00000400` とラベル付けする)。
 */
export const formatHexLines = (bytes: Buffer, offsetBase = 0, maxBytes = 256): string[] => {
  const lines: string[] = [];
  const slice = bytes.subarray(0, Math.min(bytes.byteLength, maxBytes));
  for (let i = 0; i < slice.byteLength; i += BYTES_PER_LINE) {
    const chunk = slice.subarray(i, Math.min(i + BYTES_PER_LINE, slice.byteLength));
    lines.push(formatLine(offsetBase + i, chunk));
  }
  if (bytes.byteLength > maxBytes) {
    lines.push(`… (${String(bytes.byteLength - maxBytes)} bytes truncated)`);
  }
  return lines;
};

const formatLine = (offset: number, chunk: Buffer): string => {
  const offsetHex = offset.toString(16).padStart(8, "0");

  const hexParts: string[] = [];
  for (let i = 0; i < BYTES_PER_LINE; i++) {
    if (i < chunk.byteLength) {
      const byte = chunk[i];
      if (byte !== undefined) {
        hexParts.push(byte.toString(16).padStart(2, "0"));
      } else {
        hexParts.push("  ");
      }
    } else {
      hexParts.push("  ");
    }
  }
  const hexCol = hexParts.slice(0, HALF).join(" ") + "  " + hexParts.slice(HALF).join(" ");

  let ascii = "";
  for (const b of chunk) {
    ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
  }

  return `${offsetHex}  ${hexCol}  ${ascii}`;
};
