/**
 * スクロール窓の純計算。total 個のアイテムを、高さ height(=表示できる個数)の窓で
 * 見せるときの可視範囲 [start, end) を返す。
 *
 * - `focused` 指定時はカーソルが窓に入るよう offset を補正(リスト追従)。
 * - 未指定なら baseOffset をそのまま使う(キー駆動の自由スクロール)。
 * - offset は常に [0, max(0, total - height)] にクランプ。
 * - height <= 0(未計測)や total <= 0 は空窓を返す。
 *
 * I/O も React も持たないので hermetic にテストできる。height の「実測」は呼び出し側
 * (ScrollList が useBoxMetrics で得た値)が渡す。ここでは推定を一切しない。
 */
export interface ScrollWindow {
  start: number;
  end: number;
  offset: number;
  atTop: boolean;
  atBottom: boolean;
}

export const scrollWindow = (
  baseOffset: number,
  total: number,
  height: number,
  focused?: number,
): ScrollWindow => {
  if (height <= 0 || total <= 0) {
    return { start: 0, end: 0, offset: 0, atTop: true, atBottom: true };
  }
  let off = baseOffset;
  if (focused !== undefined) {
    if (focused < off) off = focused;
    else if (focused >= off + height) off = focused - height + 1;
  }
  const max = Math.max(0, total - height);
  off = Math.min(Math.max(0, off), max);
  return {
    start: off,
    end: Math.min(total, off + height),
    offset: off,
    atTop: off === 0,
    atBottom: off >= max,
  };
};

/** offset を delta だけ動かして [0, max(0, total - height)] にクランプ。 */
export const clampOffset = (offset: number, delta: number, total: number, height: number): number => {
  const max = Math.max(0, total - height);
  return Math.min(Math.max(0, offset + delta), max);
};
