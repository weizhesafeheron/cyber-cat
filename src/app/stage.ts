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
 * 两笔加起来的：**猫的画布 + 头顶留给台词气泡的净空**。
 *
 * 猫那一笔要留 DPI 钳制的余量。精灵在 3 倍下是 168，而 `deviceScaleFor` 会按客户区
 * 上限把缩放钳下去：dpr = 1.5 时 3×1.5 取整成 5，5 倍的精灵高需要 56×5/1.5 ≈ 186.7
 * CSS 像素。曾经给 190，只剩 3 像素余量，分数 dpi（Windows 150%）下再有一点点差异
 * 猫就会被缩小一档。
 *
 * 台词气泡是舞台里的覆盖画布，画在猫的画布**之上**。猫的精灵缓冲里放不下它；
 * 保留当前高度也保证移除旧回归提示时不会改变窗口落地点和猫的显示比例。
 *
 * 240 = 186.7（最坏缩放下的猫）+ 台词净空 + 余量。
 * 台词的位置换算由 test/say/bubble.test.ts 守着，别凭感觉往下调。
 *
 * 代价是透明区变大了 20%，而穿透是整窗一刀切的（ADR 0006）。接受它：判定失效的
 * 方向是「一律穿透」，变大的只是误判窗口期里可能挡住的面积。
 *
 * 宽度方向不需要这份余量：舞台是精灵的 3 倍宽，钳制在宽度上永远不会生效。
 */
export const STAGE_H = 240;

/**
 * 猫脚下的地面线距舞台下沿的距离，以精灵像素计。
 *
 * 精灵在舞台里是贴底居中的，地面线在精灵缓冲的 y = GROUND 行，
 * 所以它离舞台下沿正好 H - GROUND 个精灵像素。爪印落在这一行上。
 */
export const GROUND_FROM_BOTTOM = H - GROUND;
