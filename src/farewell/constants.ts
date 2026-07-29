import { H, W } from '../render/index.js';
import { TARGET_SCALE } from '../app/stage.js';

/**
 * 告别页的可调数值。
 *
 * 与领养窗口同一条纪律（adopt/constants.ts）：**一次性流程，数字必须集中**。
 * 真机上想再看一遍告别页得先让一只猫死掉，散在四个文件里的话谁都不会去调。
 */

/**
 * 遗照里猫的放大倍数。
 *
 * 比桌面上（TARGET_SCALE = 3）大一档：遗照是这一页唯一的画面，
 * 而桌面上那个尺寸是为了「在余光里活着」定的，摆在一张纪念页正中会显得太小。
 */
export const PORTRAIT_SCALE = TARGET_SCALE + 1;

/** 遗照区域的 CSS 尺寸，逻辑像素。按放大后的精灵尺寸给，四周留一点余白。 */
export const PORTRAIT_W = W * PORTRAIT_SCALE;
export const PORTRAIT_H = H * PORTRAIT_SCALE;

/**
 * 告别页窗口的客户区尺寸，CSS 逻辑像素。
 *
 * 比领养窗口（464 × 468）大一些，因为这一页要同时放三块内容：
 * 遗照与陪伴记录、可翻的一生日记、历任猫的档案。
 *
 * **高度给得下但不铺满屏**：日记与档案两块都各自滚动（overflow-y: auto），
 * 所以窗口高度不需要随日记条数变化 - 那才是这个尺寸能写死的原因。
 * 600 是在 macOS 13 英寸（工作区高 830）上留出上下余量的值。
 */
export const FAREWELL_W = 520;
export const FAREWELL_H = 600;
