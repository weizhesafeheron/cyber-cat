/**
 * 猫咪日记窗口的入口。
 *
 * 职责边界：这个文件只做三件事 - 读存档、把渲染好的日记塞进 DOM、按 Esc 关窗。
 * **判断一律不在这里**：文案在 text.ts，分组也在 text.ts，它们都有测试。
 *
 * **这一页是只读的。** 它自己去读存档文件，而不是等宠物窗口把状态推过来。
 * 两条理由：
 * 1. 日记条目只在有新事件时才变，而宠物窗口**每次产生事件都会立刻存盘**
 *    （main.ts 的 `r.events.length > 0` 那一支），所以文件里的日记从不落后。
 * 2. 少一条状态通路。推送方案要多一套 ready / sync 握手（挂件那边就是这么做的，
 *    见 app/props.ts），而挂件必须那样是因为它要显示碗里的实时份数；
 *    日记不需要实时，为它引入握手只是多一处能不一致的地方。
 *
 * 代价：日记打开着的时候不会自己刷新。可以接受 - 用户是来翻看的，不是来盯着的。
 */
import { contentReady, closeDiary, inTauri } from '../app/ipc.js';
import { loadWorld } from '../app/persist.js';
import { makeCat } from '../render/index.js';
import { companionDays, worldNow } from '../world/index.js';
import type { World } from '../world/index.js';
import { DIARY_VISIBLE_ENTRIES } from './constants.js';
import { groupDiary } from './text.js';
import type { DiaryDay } from './text.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const who = $('who');
const meta = $('meta');
const empty = $<HTMLParagraphElement>('empty');
const daysBox = $('days');

/** 把一天渲染成 DOM。用 textContent 而不是拼 innerHTML - 名字是用户输入的。 */
function dayNode(day: DiaryDay): HTMLElement {
  const box = document.createElement('div');
  box.className = 'day';
  const title = document.createElement('h2');
  title.textContent = day.label;
  box.append(title);
  const list = document.createElement('ul');
  for (const entry of day.entries) {
    const li = document.createElement('li');
    if (entry.important) li.className = 'important';
    const time = document.createElement('time');
    time.textContent = entry.time;
    const text = document.createElement('p');
    text.textContent = entry.text;
    li.append(time, text);
    list.append(li);
  }
  box.append(list);
  return box;
}

function render(world: World): void {
  const cat = makeCat(world.identity.breed, world.identity.seed);
  const name = world.identity.name;
  const days = companionDays(world, world.diedAt ?? worldNow(world));

  who.textContent = world.dead ? `${name} · 已经离开` : name;
  meta.textContent = world.dead
    ? `陪了你 ${days} 天 · 共 ${world.diary.length} 条`
    : `第 ${days} 天 · 共 ${world.diary.length} 条`;

  const grouped = groupDiary(world.diary, cat, world.tzOffsetMinutes, DIARY_VISIBLE_ENTRIES);
  daysBox.replaceChildren(...grouped.map(dayNode));
  // 「刚领养完就打开」是真会发生的：那时日记里只有到家那一条。
  const bare = grouped.length === 0;
  empty.hidden = !bare;
  if (bare) empty.textContent = `${name} 还没来得及写下什么。过一阵再来看。`;
}

/** 读不到存档时也要给一句人话，不能停在「读取存档中……」上。 */
function renderMissing(): void {
  who.textContent = '没有日记';
  meta.textContent = '';
  empty.hidden = false;
  empty.textContent = '读不到存档。日记是猫自己写的，得先有一只猫。';
  daysBox.replaceChildren();
}

// 按 Esc 关窗。日记是一页看完就走的东西，伸手去点标题栏是多余的一步。
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') void closeDiary();
});

/**
 * 启动顺序：读存档 → 渲染第一屏 → 通知 Rust 显示窗口。
 *
 * **显示必须排在渲染之后。** 窗口以 visible: false 建出来（diary.rs），
 * 这是防白闪的唯一手段，而日记页是深色的，白底闪一下很显眼（ADR 0003）。
 * 读存档失败也要照样显示 - 一个永远不出现的窗口会让用户以为菜单项坏了。
 */
async function boot(): Promise<void> {
  try {
    const world = await loadWorld();
    if (world) render(world);
    else renderMissing();
  } catch (err) {
    console.error('[cyber-cat] 渲染日记失败：', err);
    renderMissing();
  }
  await contentReady(true);
}

void boot();

// 浏览器里直接打开 /diary.html 调试排版时没有存档可读，走的是 renderMissing。
if (!inTauri) console.info('[cyber-cat] 浏览器调试模式：没有存档可读，日记会是空的');
