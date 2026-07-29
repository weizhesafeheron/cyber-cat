import { describe, expect, it } from 'vitest';
import { diaryText } from '../../src/diary/index.js';
import { makeCat } from '../../src/render/index.js';
import {
  archiveRows,
  companionLine,
  diaryByDay,
  formatDay,
  lifeLine,
} from '../../src/farewell/text.js';
import { emptyMemorial, enshrine } from '../../src/memorial/index.js';
import type { Memorial, MemorialEntry } from '../../src/memorial/index.js';
import type { WorldEvent, WorldEventKind } from '../../src/world/index.js';
import { DAY, HOUR, makeWorld } from '../world/helpers.js';

/**
 * 告别页的文案层。
 *
 * 这里测的是**告别页上该有的数据都在、且算得对**（验收项：陪伴天数、喂食次数、
 * 抚摸次数、可翻看一生日记）。「安静、不恐怖、不搞笑」只有人眼能判断，
 * 自动化能守住的是它旁边那些会算错的东西。
 */

const TZ = 480; // 东八区

function entry(patch: Partial<MemorialEntry> = {}): MemorialEntry {
  return {
    identity: { breed: 'orange', seed: 42, bornAt: Date.UTC(2026, 5, 1, 0, 0, 0), name: '小橘' },
    diedAt: Date.UTC(2026, 6, 5, 0, 0, 0),
    stats: { feedCount: 51, petCount: 120 },
    diary: [],
    ...patch,
  };
}

describe('日期', () => {
  it('按本地时区折算，不随运行机器的 TZ 变', () => {
    // UTC 的 2026-07-04 20:00 在东八区已经是 7 月 5 日。
    const at = Date.UTC(2026, 6, 4, 20, 0, 0);
    expect(formatDay(at, TZ)).toBe('2026-07-05');
    expect(formatDay(at, 0)).toBe('2026-07-04');
  });
});

describe('陪伴记录', () => {
  it('生卒两个日期与品种都在一行里', () => {
    const line = lifeLine(entry(), TZ);
    expect(line).toContain('橘猫');
    expect(line).toContain('2026-06-01');
    expect(line).toContain('2026-07-05');
  });

  it('陪伴天数、喂食次数、抚摸次数三项齐全且数值正确', () => {
    const line = companionLine(entry());
    expect(line).toContain('34'); // 06-01 到 07-05 共 34 天
    expect(line).toContain('51');
    expect(line).toContain('120');
  });

  it('不足一天也说「1 天」，不说 0 天', () => {
    const short = entry({ diedAt: Date.UTC(2026, 5, 1, 5, 0, 0) });
    expect(companionLine(short)).toContain('1 天');
  });

  it('从没喂过、从没摸过也照实写 0，不隐藏 - 那也是这段关系的一部分', () => {
    const line = companionLine(entry({ stats: { feedCount: 0, petCount: 0 } }));
    expect(line).toMatch(/喂食\s*0/);
    expect(line).toMatch(/抚摸\s*0/);
  });
});

describe('一生日记', () => {
  const born = Date.UTC(2026, 5, 1, 0, 0, 0);
  const ev = (kind: WorldEventKind, at: number): WorldEvent => ({ kind, at, important: false });

  it('按天分组，同一天的条目归在一起', () => {
    const days = diaryByDay(
      entry({
        diary: [
          ev('adopted', born + 1 * HOUR),
          ev('ate', born + 3 * HOUR),
          ev('napped', born + DAY + 2 * HOUR),
        ],
      }),
      TZ,
    );
    expect(days).toHaveLength(2);
    expect(days[0]!.lines).toHaveLength(2);
    expect(days[1]!.lines).toHaveLength(1);
  });

  it('分组按时间先后，不按事件在数组里的顺序', () => {
    const days = diaryByDay(
      entry({ diary: [ev('ate', born + 5 * DAY), ev('adopted', born)] }),
      TZ,
    );
    expect(days.map((d) => d.day)).toEqual(['2026-06-01', '2026-06-06']);
  });

  it('每一天带一句「第几天」，用户才知道自己翻到哪儿了', () => {
    const days = diaryByDay(entry({ diary: [ev('adopted', born), ev('ate', born + 4 * DAY)] }), TZ);
    expect(days[0]!.nth).toBe(1);
    expect(days[1]!.nth).toBe(5);
  });

  it('日记为空时给出的是空分组，而不是一个空白的一天', () => {
    expect(diaryByDay(entry(), TZ)).toEqual([]);
  });

  it('每条都渲染成一句人话，不出现事件的英文名', () => {
    const days = diaryByDay(
      entry({ diary: [ev('fellSick', born + HOUR), ev('zoomies', born + 2 * HOUR)] }),
      TZ,
    );
    for (const line of days[0]!.lines) {
      expect(line.text.length).toBeGreaterThan(0);
      expect(line.text).not.toMatch(/[a-zA-Z]/);
    }
  });
});

describe('日记文案', () => {
  /** 全部事件种类。少一个就会在告别页上露出兜底文案。 */
  const ALL: WorldEventKind[] = [
    'adopted',
    'woke',
    'sleptAtNight',
    'napped',
    'ate',
    'ateGreedy',
    'fedByOwner',
    'petted',
    'petRefused',
    'gazedOutWindow',
    'groomed',
    'scratched',
    'zoomies',
    'hungry',
    'starving',
    'fellSick',
    'sickLingers',
    'medicated',
    'cured',
    'recoveredFromWeakness',
    'died',
  ];

  // 告别页里的日记文案用的就是猫咪日记那一份（ticket 13 合并时统一）。
  // 这里只守「告别页这条路上每种事件都有话可说」，文案本身的性格分化由
  // test/diary/text.test.ts 负责。
  const CAT = makeCat('orange', 20260728);

  it('每一种事件都有自己的一句话，没有两种共用同一句', () => {
    const said = new Set<string>();
    for (const kind of ALL) {
      const text = diaryText({ kind, at: 0, important: false }, CAT);
      expect(text.length).toBeGreaterThan(0);
      said.add(text);
    }
    expect(said.size).toBe(ALL.length);
  });

  it('认不出的事件给一句兜底，不抛错也不露出英文名', () => {
    const text = diaryText({ kind: 'someFutureKind' as WorldEventKind, at: 0, important: false }, CAT);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('someFutureKind');
  });

  it('死亡那条带上陪伴天数（事件里就有这个数）', () => {
    const text = diaryText({ kind: 'died', at: 0, important: true, data: { days: 34 } }, CAT);
    expect(text).toContain('34');
  });
});

describe('猫的档案列表', () => {
  function archiveOf(names: string[]): Memorial {
    let archive = emptyMemorial();
    const base = makeWorld({ hour: 9 });
    names.forEach((name, i) => {
      archive = enshrine(archive, {
        ...base,
        identity: { ...base.identity, seed: 100 + i, name },
        dead: true,
        diedAt: base.clock + (i + 1) * 10 * DAY,
      });
    });
    return archive;
  }

  it('最近离开的排最前 - 档案是从现在往回翻的', () => {
    const rows = archiveRows(archiveOf(['第一只', '第二只', '第三只']), TZ);
    expect(rows.map((r) => r.name)).toEqual(['第三只', '第二只', '第一只']);
  });

  it('每一行都有名字、品种、生卒与陪伴天数', () => {
    const row = archiveRows(archiveOf(['小橘']), TZ)[0]!;
    expect(row.name).toBe('小橘');
    expect(row.breed).toBe('橘猫');
    expect(row.span).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(row.days).toBeGreaterThan(0);
  });

  it('空档案给空列表', () => {
    expect(archiveRows(emptyMemorial(), TZ)).toEqual([]);
  });
});
