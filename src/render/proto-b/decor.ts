/** 非部件装饰：地面阴影、睡觉 Zzz。直接画在缓冲上。 */

const SHADOW_COLOR = 'rgba(21, 17, 38, 0.4)';
const ZZZ_COLOR = '#aeb8e8';

export function drawShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  groundY: number,
  scale: number,
): void {
  if (scale <= 0) return;
  ctx.fillStyle = SHADOW_COLOR;
  const rx = Math.round(30 * scale);
  ctx.fillRect(cx - rx + 4, groundY + 2, rx * 2 - 8, 1);
  ctx.fillRect(cx - rx, groundY + 3, rx * 2, 2);
  ctx.fillRect(cx - rx + 5, groundY + 5, rx * 2 - 10, 1);
}

/** 像素 Z 字：3×5。 */
function drawZ(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillRect(x, y, 3 * s, s);
  ctx.fillRect(x + 2 * s, y + s, s, s);
  ctx.fillRect(x + s, y + 2 * s, s, s);
  ctx.fillRect(x, y + 3 * s, s, s);
  ctx.fillRect(x, y + 4 * s, 3 * s, s);
}

export function drawZzz(ctx: CanvasRenderingContext2D, t: number): void {
  const cycle = 2.6;
  for (let i = 0; i < 3; i++) {
    const u = (((t / cycle + i * 0.34) % 1) + 1) % 1;
    if (u > 0.85) continue;
    const alpha = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.7;
    ctx.globalAlpha = Math.max(0, alpha) * 0.9;
    ctx.fillStyle = ZZZ_COLOR;
    const s = i === 2 ? 2 : 1;
    const x = 96 + i * 7 + Math.round(Math.sin(u * Math.PI * 2 + i) * 2);
    const y = 56 - Math.round(u * 26) - i * 3;
    drawZ(ctx, x, y, s);
  }
  ctx.globalAlpha = 1;
}
