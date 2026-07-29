import { NAME_MAX_CHARS } from './constants.js';

/**
 * 名字的规范化与校验。
 *
 * 名字是猫身份的一部分（CONTEXT.md 的「领养」），它会进存档、进托盘文案、
 * 以后还要进日记 - 所以这里是**系统边界**，必须在入口挡住脏输入。
 * 一个带控制字符的名字会在托盘菜单里表现成截断的一行，而那时已经查不回
 * 输入的这一刻了。
 *
 * 同一套规则在两端各用一次：领养窗口按它校验输入，宠物窗口按它复核跨窗口
 * 收到的载荷（见 identity.ts）。两端各写一份迟早会漂移。
 */

export type NameCheck =
  | { readonly ok: true; readonly name: string }
  /** 理由要能直接显示给用户，因此写成人话，不是错误码。 */
  | { readonly ok: false; readonly reason: string };

/** 码点数。'🐱'.length 是 2，用 length 判长度会让 emoji 名字凭空少一半额度。 */
function charCount(s: string): number {
  return [...s].length;
}

/**
 * 规范化一个用户输入的名字。
 *
 * 顺序是有讲究的：**先把空白折叠成普通空格，再剔除控制字符。**
 * 制表符与换行既是空白也是控制字符，反过来做会把它们直接删掉，
 * 「小\t黑」就成了「小黑」而不是「小 黑」 - 用户敲的是一个分隔，不是没敲。
 */
export function normalizeName(raw: string): NameCheck {
  const collapsed = raw.replace(/\s+/gu, ' ');
  // 剔除 C0 与 C1 控制字符、以及零宽字符。
  // 前者会把界面排版搅乱；后者更阴：一个全是零宽空格的名字能通过任何非空检查，
  // 之后托盘菜单里显示的是一只没有名字的猫，而存档里的名字看起来「不是空的」。
  const cleaned = collapsed.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]/gu, '');
  const name = cleaned.trim();

  if (name.length === 0) return { ok: false, reason: '还没给它起名字' };
  if (charCount(name) > NAME_MAX_CHARS) {
    return { ok: false, reason: `名字最多 ${NAME_MAX_CHARS} 个字` };
  }
  return { ok: true, name };
}
