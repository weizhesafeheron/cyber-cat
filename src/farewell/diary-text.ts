import type { WorldEvent, WorldEventKind } from '../world/index.js';

/**
 * 日记文案（**临时实现，归 issue #14**）。
 *
 * issue #14 做「猫咪日记 + 回归气泡」，日记的正式文案渲染是它的产出，
 * 而且要按性格分化语气（CONTEXT.md 的「猫咪日记」）。告别页要「翻看它的一生日记」，
 * 又不能等那张票，所以这里先给一份最小的：**每种事件一句话，不看性格**。
 * #14 合进来之后把这个文件删掉、把 text.ts 里的引用换成它的渲染函数即可 -
 * 这里刻意只导出一个 `diaryLine(event, name)`，换的时候只有一处要改。
 *
 * 两条即使换实现也应当保留的约定：
 * - **日记是猫的日记**，主语是猫，不是用户。所以「你点了食盆」不在这里，
 *   世界层压根不把用户动作写进日记（见 world/tick.ts 的 emit）。
 * - **不恐怖、不搞笑**（issue #13 的验收项）。生病与死亡那几条用平静的陈述，
 *   不用惊叹号，也不拿它开玩笑。
 */

/** `{name}` 会被换成猫的名字。 */
const LINES: Readonly<Record<WorldEventKind, string>> = {
  adopted: '{name}跟着你回家了。',
  woke: '睡醒了，伸了个懒腰。',
  sleptAtNight: '夜里睡下了。',
  napped: '找了个地方打盹。',
  ate: '吃了一顿饭。',
  ateGreedy: '听见倒粮的声音就冲过来了，吃得很急。',
  fedByOwner: '碗里有了新的粮。',
  petted: '被摸了摸头，蹭了回来。',
  petRefused: '睡着的时候被碰到，甩了一下尾巴。',
  gazedOutWindow: '在窗边坐了很久，看着外面。',
  groomed: '认真理了一遍毛。',
  scratched: '磨了磨爪子。',
  zoomies: '半夜忽然跑了起来，绕着屋子冲了几圈。',
  hungry: '碗是空的，在食盆边来回走。',
  starving: '饿了很久，对着门口叫。',
  fellSick: '{name}病了，趴在角落不太动。',
  sickLingers: '还在病着，一整天没怎么起来。',
  medicated: '喝下了药。',
  cured: '病好了，重新走动起来。',
  recoveredFromWeakness: '力气回来了。',
  died: '{name}在这里陪了你 {days} 天，然后离开了。',
};

/** 认不出的事件（存档比代码新，或者事件种类被改过）用它兜底。 */
const FALLBACK = '这一天过去了。';

/**
 * 把一条事件渲染成一句话。
 *
 * `{days}` 这类占位取自 event.data - 事件里只放结构化数据、不放文案
 * （world/types.ts 的 WorldEvent 注释），填空是呈现层的事。
 */
export function diaryLine(event: WorldEvent, name: string): string {
  const template = LINES[event.kind] ?? FALLBACK;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (key === 'name') return name;
    const v = event.data?.[key];
    // 缺数据时把占位整段去掉而不是留一个 {days}：日记会在告别页上被逐字读，
    // 露出模板痕迹比少一个数字难看得多。
    return v == null ? '' : String(Math.round(v));
  });
}
