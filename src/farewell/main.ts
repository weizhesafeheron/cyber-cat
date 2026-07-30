/**
 * 告别页的入口。
 *
 * 职责边界：这个文件只做三件事 - 把档案里的数据画到页面上、把点击翻译成状态迁移、
 * 把「再养一只」报给宠物窗口。**判断一律不在这里**：
 * 陪伴记录与日记分组在 text.ts、日记文案在 diary-text.ts、入档与陪伴天数在
 * src/memorial/、交接顺序在 handoff.ts，它们都有测试。
 *
 * **这一页是只读的。** 它读 memorial.json，不碰 world.json，也不改任何世界状态 -
 * 世界状态只有宠物窗口持有（与挂件窗口同一条不变量，见 app/props.ts）。
 * 用户要再养一只时，它只是报一声。
 *
 * 呈现要求（issue #13）：**安静，不恐怖，不搞笑。** 具体取舍写在 farewell.html
 * 的样式注释里 - 那些是「安静」在这一页真正的落点，改样式前先读一遍。
 */
import { announceAdoptAnother, closeFarewell, contentReady, inTauri } from '../app/ipc.js';
import { mountChrome } from '../chrome/index.js';
import { loadMemorial } from '../app/persist.js';
import { emptyMemorial } from '../memorial/index.js';
import type { Memorial } from '../memorial/index.js';
import {
  ACTIONS,
  CatRenderer,
  makeMicro,
  materializeCat,
  motionTuningFor,
  stepMicro,
  tuneMotionPose,
} from '../render/index.js';
import { CatDisplay } from '../app/display.js';
import { PORTRAIT_H, PORTRAIT_SCALE, PORTRAIT_W } from './constants.js';
import { requestAnotherCat } from './handoff.js';
import { archiveRows, companionLine, diaryByDay, lifeLine } from './text.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ui = {
  name: $('name'),
  life: $('life'),
  companion: $('companion'),
  diary: $('diary'),
  archive: $('archive'),
  note: $('note'),
  again: $<HTMLButtonElement>('again'),
};

const renderer = new CatRenderer();
// 画布按遗照区域钳制放大倍数，不按整窗 - 与领养窗口同一条理由（见 display.ts 的
// boxOf）：按整窗算会在分数 dpr 下算出更高的画布，猫的头会被裁掉。
const display = new CatDisplay($<HTMLCanvasElement>('portrait'), PORTRAIT_SCALE, () => ({
  w: PORTRAIT_W,
  h: PORTRAIT_H,
}));

/** 本地时区偏移，分钟（东八区 = 480）。JS 的 getTimezoneOffset 符号相反。 */
const tzOffsetMinutes = (): number => -new Date().getTimezoneOffset();

let archive: Memorial = emptyMemorial();
/** 正在看哪一只（archive.cats 的下标）。-1 = 档案是空的。 */
let viewing = -1;

function applyGeometry(): void {
  const root = document.documentElement.style;
  root.setProperty('--portrait-w', `${PORTRAIT_W}px`);
  root.setProperty('--portrait-h', `${PORTRAIT_H}px`);
  display.applyScale();
  if (viewing >= 0) paintPortrait();
}

/**
 * 画遗照。**一张静态的照片，没有动画。**
 *
 * 坐姿、眼睛睁着、微动作全关：这是它活着时的样子。
 * 试过趴姿与蜷卧（`lie` / `curl`）- 那两个读起来像遗体，与「不恐怖」相冲。
 * 微动作（眨眼、抖耳朵）也必须关掉：会动的就不是照片了，而一只在遗照里眨眼的猫
 * 反而更让人不安。
 */
function paintPortrait(): void {
  const identity = archive.cats[viewing]!.identity;
  const { seed } = identity;
  const cat = materializeCat(identity);
  const micro = stepMicro(makeMicro(seed), 0, { blink: false, ear: false, tilt: false });
  const tuning = motionTuningFor(identity.motion ? { motion: identity.motion } : undefined, 'sit');
  display.paint(
    renderer.render(cat, tuneMotionPose('sit', ACTIONS['sit'].make(0, cat, micro), tuning, cat)),
  );
  display.place(PORTRAIT_W / 2);
}

/** 切到某一只猫：遗照、陪伴记录、日记全部重写。 */
function showEntry(index: number): void {
  viewing = index;
  const entry = archive.cats[index]!;

  paintPortrait();
  ui.name.textContent = entry.identity.name;
  ui.life.textContent = lifeLine(entry, tzOffsetMinutes());
  ui.companion.textContent = companionLine(entry);

  const days = diaryByDay(entry, tzOffsetMinutes());
  if (days.length === 0) {
    // 日记有条数上限（DIARY_MAX_ENTRIES），但至少领养那一条总在，所以这里通常
    // 走不到。留着是因为一份手工改过的档案可以让它发生。
    ui.diary.replaceChildren(el('p', 'empty', '没有留下日记。'));
  } else {
    ui.diary.replaceChildren(
      ...days.map((day) => {
        const box = el('div', 'day');
        box.append(el('div', 'when', `第 ${day.nth} 天 · ${day.day}`));
        for (const line of day.lines) {
          box.append(el('p', line.important ? 'important' : '', line.text));
        }
        return box;
      }),
    );
  }
  // 换猫之后从头看，否则会停在上一只日记的滚动位置上。
  ui.diary.scrollTop = 0;
  markCurrent();
}

function el(tag: string, cls = '', text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** 档案列表。点一行翻到那只猫 - 「死后可在猫的档案中回看」就是这个动作。 */
function renderArchive(): void {
  const rows = archiveRows(archive, tzOffsetMinutes());
  if (rows.length === 0) {
    ui.archive.replaceChildren(el('p', 'empty', '还没有留档的猫。'));
    return;
  }
  ui.archive.replaceChildren(
    ...rows.map((row) => {
      const button = el('button', 'cat') as HTMLButtonElement;
      button.type = 'button';
      button.dataset['index'] = String(row.index);
      button.append(
        el('span', 'n', row.name),
        el('span', 'b', row.breed),
        el('span', 's', `${row.span} · ${row.days} 天`),
      );
      button.addEventListener('click', () => showEntry(row.index));
      return button;
    }),
  );
  markCurrent();
}

/** 标出正在看的那一行。列表是倒序的，所以按 data-index 比对而不是按位置。 */
function markCurrent(): void {
  ui.archive.querySelectorAll<HTMLElement>('.cat').forEach((node) => {
    node.setAttribute('aria-current', node.dataset['index'] === String(viewing) ? 'true' : 'false');
  });
}

/** 档案读不出来时的样子。按钮仍然可用 - 用户至少还能再养一只。 */
function showNothing(message: string): void {
  ui.name.textContent = '它离开了';
  ui.life.textContent = '';
  ui.companion.textContent = message;
  ui.diary.replaceChildren();
  renderArchive();
}

ui.again.addEventListener('click', () => {
  // 连点两次会开出两个领养窗口。Rust 侧是幂等的，但按钮立刻失效更直接。
  ui.again.disabled = true;
  if (!inTauri) {
    console.info('[cyber-cat] 告别页（浏览器调试模式）：真机上这里会打开领养窗口');
    return;
  }
  void requestAnotherCat({
    announce: announceAdoptAnother,
    close: closeFarewell,
  }).catch((err: unknown) => {
    // 报不出去时窗口还在（handoff 的失效方向），让用户能再点一次。
    ui.again.disabled = false;
    ui.note.textContent = '没能开始领养，再试一次';
    console.error('[cyber-cat] 报出「再养一只」失败：', err);
  });
});

// 跨屏拖动或系统缩放变化时重算，保持像素锐利
window.addEventListener('resize', () => applyGeometry());
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () =>
  applyGeometry(),
);

/**
 * 启动顺序：读档案 → 画好整页 → 通知显示窗口。
 *
 * **与另外两个窗口的不同之处：这里的首帧要等一次读文件。**
 * 宠物窗口与领养窗口都是「同步画完第一帧再 contentReady」，因为它们随后要起
 * requestAnimationFrame，而 rAF 对隐藏窗口不触发（踩过两次，见 lib.rs 的
 * content_ready）。告别页是一张静态页面，压根没有帧循环，所以先 await 读文件是
 * 安全的 - 代价只是窗口晚出现几毫秒，收益是**窗口一出现内容就是全的**，
 * 不会先闪一个空页面再填上去。
 *
 * 档案读坏了也要把窗口显示出来：这一页同时是「领养新猫」的入口。
 */
async function boot(): Promise<void> {
  try {
    archive = (await loadMemorial()) ?? emptyMemorial();
  } catch (err) {
    console.error('[cyber-cat] 读猫的档案失败：', err);
    showNothing('猫的档案读不出来了。');
    ui.note.textContent = '档案文件可能损坏，宠物窗口不会覆盖它。';
    return;
  }

  if (archive.cats.length === 0) {
    showNothing('档案里还没有它的记录。');
    return;
  }
  // 默认看最近离开的那只 - 打开这一页的人想看的就是它。
  showEntry(archive.cats.length - 1);
  renderArchive();
  ui.note.textContent = '再养一只不会有任何惩罚，它们都还在档案里。';
}

/*
 * 自绘的标题条。这一页不可缩放，所以没有把手。
 *
 * 也接一下 Esc：与日记同一条手势。关掉告别页不退出应用（farewell.rs），
 * 所以这里不像领养窗口那样需要在提示里警告什么。
 */
mountChrome({ close: { hint: '关闭', close: () => void closeFarewell() } });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') void closeFarewell();
});

applyGeometry();
void boot()
  .catch((err: unknown) => {
    console.error('[cyber-cat] 告别页初始化失败：', err);
  })
  .finally(() => {
    void contentReady(true).catch((err: unknown) => {
      console.error('[cyber-cat] 显示告别页失败：', err);
    });
  });
