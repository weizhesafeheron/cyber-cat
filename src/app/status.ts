import {
  SICK_TO_DEATH_HOURS,
  STARVE_TO_SICK_HOURS,
  companionDays,
  worldNow,
} from '../world/index.js';
import type { CatStatus, World } from '../world/index.js';
import type { TrayStatusPayload } from './persist.js';

/**
 * 托盘上的状态文案。
 *
 * 文案放在应用层而不是世界层：世界层只产出结构化状态（CatStatus 与四个数值），
 * 怎么说给人听是呈现的事。把中文塞进世界层会让它需要跟着 UI 语言变。
 */

const STATUS_LABEL: Record<CatStatus, string> = {
  ok: '状态不错',
  sleeping: '睡着了',
  hungry: '饿了 · 碗是空的',
  starving: '在挨饿',
  sick: '生病了',
  dead: '已经离开',
};

const pct = (v: number): string => `${Math.round(v)}%`;

/** 总体一句话。托盘菜单第一行与 tooltip 都用它。 */
export function summaryLine(world: World, status: CatStatus): string {
  const name = world.identity.name;
  if (status === 'dead') {
    return `${name} · 已经离开 · 陪了你 ${companionDays(world, world.diedAt ?? worldNow(world))} 天`;
  }
  if (status === 'sick') {
    const left = Math.max(0, SICK_TO_DEATH_HOURS - world.sickHours);
    return `${name} · 生病了 · 还有 ${Math.round(left)} 小时`;
  }
  if (status === 'starving') {
    const left = Math.max(0, STARVE_TO_SICK_HOURS - world.starveHours);
    return `${name} · 在挨饿 · ${Math.round(left)} 小时后会生病`;
  }
  const bowl = world.bowl > 0 ? ' · 碗里有粮' : '';
  return `${name} · ${STATUS_LABEL[status]}${bowl}`;
}

export function trayStatus(world: World, status: CatStatus): TrayStatusPayload {
  return {
    summary: summaryLine(world, status),
    hunger: `饱食度 ${pct(world.needs.hunger)}`,
    energy: `精力 ${pct(world.needs.energy)}`,
    mood: `心情 ${pct(world.needs.mood)}`,
    bond: `亲密度 ${pct(world.bond)}`,
    // 两个入口的可用性在这一层算，不在 Rust 侧算：
    // Rust 那边只会 set_enabled，条件写在那里就没有测试能碰到它。
    //
    // **喂药只在生病时可用**（mvp-scope 4 / issue #13 的验收项）。
    // `&& !dead` 不是多余的：死亡分支不会把 sick 清掉（那是它的病历，
    // 告别页与档案都还要用），只看 sick 的话猫死后喂药项会一直亮着 -
    // 点了没有任何反应（applyAction 首行就挡住了死亡后的输入），
    // 而一个亮着却没反应的菜单项比灰着更糟。
    medicate: world.sick && !world.dead,
    // 告别页那个入口反过来：只有猫离开之后才有东西可看。
    memorial: world.dead,
  };
}
