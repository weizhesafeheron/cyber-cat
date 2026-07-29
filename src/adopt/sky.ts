import { RAIN_WIND } from './constants.js';
import type { RainBox, RainField } from './rain.js';

/**
 * 雨夜画布。
 *
 * 只画三样东西：夜色、远处霓虹的光晕、雨。
 * **不要往这里加家具、窗框、沙发。** 那是 ADR 0004 明确废弃的「赛博公寓一角」，
 * 领养窗口保留雨夜是因为世界观载体转移到了「猫本身与文案」，雨是氛围的最后一处
 * 落点，不是把房间搬进来的借口。
 *
 * 与 paws.ts 同一个分法：这个类只管画，雨滴的位置与回收在 rain.ts（纯逻辑、有测试）。
 */

/** 夜色：上深下浅，浅的那头是远处城市透过雨幕的地光。 */
const NIGHT_TOP = '#070a16';
const NIGHT_BOTTOM = '#1a2140';

/** 地面：猫脚下那条比夜色更暗的湿地。 */
const GROUND_INK = '#0d1226';

/** 地面线上的一道反光。淡到几乎看不出是条线，但足以让猫踩在实处。 */
const GROUND_SHEEN = 'rgba(140, 190, 214, 0.22)';

/** 两团霓虹光晕。x 是画面宽度的比例，r 是半径占宽度的比例。 */
const NEONS: readonly { x: number; y: number; r: number; color: string }[] = [
  { x: 0.18, y: 0.34, r: 0.3, color: 'rgba(246, 82, 160, 0.16)' },
  { x: 0.82, y: 0.26, r: 0.26, color: 'rgba(77, 238, 234, 0.13)' },
];

/** 雨丝颜色。偏青的冷白，与霓虹同一套色系。 */
const RAIN_INK = 'rgba(180, 214, 232, 1)';

/** 雨丝宽度，CSS 像素。1 像素在高 dpr 屏上太细，会看起来像噪点。 */
const RAIN_WIDTH = 1.2;

export class SkyCanvas {
  private readonly ctx: CanvasRenderingContext2D;
  private box: RainBox = { w: 1, h: 1 };
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** dpr 或窗口尺寸变化时重设后备缓冲。 */
  resize(box: RainBox, dpr: number): void {
    this.box = box;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(box.w * dpr));
    this.canvas.height = Math.max(1, Math.round(box.h * dpr));
    this.canvas.style.width = `${box.w}px`;
    this.canvas.style.height = `${box.h}px`;
  }

  /**
   * 画一帧。
   *
   * 夜色与霓虹每帧重画而不是缓存成一张离屏位图：这个窗口只活一次领养流程，
   * 一块 464×190 的渐变每帧重画的代价远小于多一层缓存失效的逻辑。
   *
   * `groundY` 是猫脚下地面线在画面里的 CSS y，湿地就从那里往下铺。
   */
  paint(field: RainField, groundY: number): void {
    const ctx = this.ctx;
    const { w, h } = this.box;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const night = ctx.createLinearGradient(0, 0, 0, h);
    night.addColorStop(0, NIGHT_TOP);
    night.addColorStop(1, NIGHT_BOTTOM);
    ctx.fillStyle = night;
    ctx.fillRect(0, 0, w, h);

    for (const n of NEONS) {
      const cx = n.x * w;
      const cy = n.y * h;
      const r = n.r * w;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      glow.addColorStop(0, n.color);
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }

    // 湿地压在雨之下：雨落到地面线以下还看得见反而像玻璃后面的雨。
    ctx.fillStyle = GROUND_INK;
    ctx.fillRect(0, groundY, w, h - groundY);
    // 地面线上一条极淡的反光。**没有它猫看起来是浮着的** - 湿地本身太暗，
    // 又被下方那道渐变盖掉，画面上就没有任何东西指出「地在哪」。
    ctx.fillStyle = GROUND_SHEEN;
    ctx.fillRect(0, groundY, w, 1);

    ctx.strokeStyle = RAIN_INK;
    ctx.lineWidth = RAIN_WIDTH;
    ctx.lineCap = 'round';
    for (const d of field.drops) {
      ctx.globalAlpha = d.alpha;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      // 雨丝拖在下落方向的**后面**，斜率就是风偏系数本身 -
      // 另取一个数会让雨丝的倾角与它实际飘的方向不一致，看起来像在横着漂。
      ctx.lineTo(d.x - d.len * RAIN_WIND, d.y - d.len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
