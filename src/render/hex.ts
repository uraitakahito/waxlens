/**
 * Hex-dump line formatter.
 *
 * Produces classic `xxd`-style output that both renderers (plain text +
 * Ink TUI) can drop straight into a detail view. Each line covers 16
 * bytes:
 *
 *   00000000  4e a7 5b 0c 1f 8b 08 00  00 00 00 00 00 03 b5 d3   N.[..........X..
 *
 * Bytes outside the printable ASCII range are rendered as `.` in the
 * trailing ASCII column. Hex bytes are space-separated with a wider gap
 * after the 8th byte (xxd convention) so the human eye can quickly find
 * a specific column.
 */

const BYTES_PER_LINE = 16;
const HALF = 8;

/**
 * Render a Buffer slice as a sequence of hex-dump lines. The `offsetBase`
 * is added to the byte index so callers tracking real-file offsets get
 * accurate column labels (the WARC member that lives at file offset
 * 1024 still labels its first hex row `00000400`, not `00000000`).
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
