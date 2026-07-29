import { GROUND, H, W } from '../render/index.js';

/**
 * 舞台窗口的几何常量（[ADR 0007](../../docs/adr/0007-stage-window-and-motion-layer.md)）。
 *
 * 宠物窗口不是「刚好套住猫」的框，而是一个**舞台**：容纳猫本体加身后一小段爪印。
 * 舞台只在猫接近边缘时整体挪一次，猫在舞台内逐帧移动。
 *
 * **这里的两个尺寸必须与 src-tauri/tauri.conf.json 里 pet 窗口的 width/height
 * 一致**，配置是 JSON 没法 import 常量，所以由 test/app/display.test.ts 直接读
 * 那个文件来守着。
 */

/** 目标逻辑放大倍数。实际设备缩放会取整并按窗口钳制，见 display.ts。 */
export const TARGET_SCALE = 3;

/** 舞台宽度是几倍精灵宽。3 倍 = 猫身后约两个身位的爪印空间。 */
export const STAGE_SPRITE_SPAN = 3;

/** 舞台客户区宽度，CSS 逻辑像素。 */
export const STAGE_W = W * TARGET_SCALE * STAGE_SPRITE_SPAN;

/**
 * 舞台客户区高度，CSS 逻辑像素。
 *
 * 精灵在 3 倍下是 168，这里给到 200 是为了让 display.ts 的 DPI 钳制不咬人：
 * `deviceScaleFor` 会按客户区上限把缩放钳下去，而 dpr = 1.5 时 3×1.5 取整成 5，
 * 5 倍的精灵高需要 56×5/1.5 ≈ 186.7 CSS 像素。给 190 只剩 3 像素余量，
 * 分数 dpi（Windows 150%）下再有一点点差异猫就会被缩小一档。
 *
 * 宽度方向不需要这份余量：舞台是精灵的 3 倍宽，钳制在宽度上永远不会生效。
 */
export const STAGE_H = 200;

/**
 * 猫脚下的地面线距舞台下沿的距离，以精灵像素计。
 *
 * 精灵在舞台里是贴底居中的，地面线在精灵缓冲的 y = GROUND 行，
 * 所以它离舞台下沿正好 H - GROUND 个精灵像素。爪印落在这一行上。
 */
export const GROUND_FROM_BOTTOM = H - GROUND;
