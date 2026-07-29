import type { MicroOut } from './micro.js';
import { clamp } from './rng.js';
import type { Cat, Pose } from './types.js';

/** 缓入缓出。 */
const ease = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export interface ActionOpts {
  /** 趴下时尾巴扫地（心情好的表现）。 */
  tailSweep?: boolean;
}

export interface ActionDef {
  label: string;
  loop: boolean;
  /** 走路的位移速度，px/s。由调用方驱动实际位置，动作本身只负责腿的相位。 */
  travel?: number;
  /** 一个完整循环的时长，秒。仅非等速循环的动作需要。 */
  period?: number;
  make(t: number, cat: Cat, mi: MicroOut, opts?: ActionOpts): Pose;
}

/**
 * 动作标识。
 *
 * 显式列出而不是从 ACTIONS 反推，这样 ACTIONS 可以标注成
 * Record<ActionKey, ActionDef> - 否则 satisfies 会让每个动作保留各自的字面
 * 签名（例如 sleep.make 只声明一个参数），调用处按统一契约传参就会报类型错。
 */
export type ActionKey =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'lie'
  | 'sleep'
  | 'groom'
  | 'eat'
  | 'yawn'
  | 'stretch'
  | 'pounce';

/**
 * 动作库。t 是动作的局部时间（秒）。
 *
 * 十个基础动作，全部经 prototype ② 验收。
 * 动作的可读性来自**整体姿态的位移**，不是细节 - 在 72x56 这个尺度上，
 * 只靠一两个像素变化的动作等于没有动作（舔毛就是被这条否决重做的）。
 */
export const ACTIONS: Record<ActionKey, ActionDef> = {
  idle: {
    label: '站立呼吸',
    loop: true,
    make(t, _cat, mi) {
      return {
        form: 'stand',
        breath: Math.sin((t * 2 * Math.PI) / 3.2) * 0.035,
        tailWave: 0.5,
        tailPhase: t * 1.8,
        eyeOpen: mi.eyeOpen,
        earFlickL: mi.earFlickL,
        earFlickR: mi.earFlickR,
        tilt: mi.tilt,
      };
    },
  },

  walk: {
    label: '走路',
    loop: true,
    travel: 22,
    make(t, cat, mi) {
      // 活跃的猫步频更快。
      const hz = 2.2 + cat.personality.active * 0.8;
      const p = t * hz * Math.PI * 2;
      const lo = (ph: number): number => Math.round(2.2 * Math.sin(p + ph));
      const lf = (ph: number): number => Math.max(0, Math.sin(p + ph + Math.PI / 2)) * 1.8;
      // 对角步态：同侧前后腿相位错开。
      return {
        form: 'stand',
        dy: Math.round(Math.abs(Math.sin(p)) * -1),
        breath: 0,
        legOx: [lo(0), lo(Math.PI), lo(Math.PI * 1.35), lo(Math.PI * 0.35)],
        legLift: [lf(0), lf(Math.PI), lf(Math.PI * 1.35), lf(Math.PI * 0.35)],
        tailAng: 0.55,
        tailCurl: 1.1,
        tailWave: 0.7,
        tailPhase: t * 3,
        headDY: Math.round(Math.sin(p * 2) * 0.6),
        eyeOpen: mi.eyeOpen,
      };
    },
  },

  sit: {
    label: '坐下',
    loop: true,
    make(t, _cat, mi) {
      return {
        form: 'sit',
        breath: Math.sin((t * 2 * Math.PI) / 3.4) * 0.03,
        tailWave: 0.8,
        tailPhase: t * 2.2,
        eyeOpen: mi.eyeOpen,
        earFlickL: mi.earFlickL,
        earFlickR: mi.earFlickR,
        tilt: mi.tilt,
      };
    },
  },

  lie: {
    label: '趴下（面包）',
    loop: true,
    make(t, _cat, mi, opts) {
      const sweep = opts?.tailSweep ?? false;
      return {
        form: 'lie',
        breath: Math.sin((t * 2 * Math.PI) / 3.8) * 0.05,
        tailWave: sweep ? 1.4 : 0.3,
        tailPhase: t * (sweep ? 2.6 : 1.2),
        eyeOpen: Math.min(mi.eyeOpen, 0.85),
        earFlickL: mi.earFlickL,
        earFlickR: mi.earFlickR,
      };
    },
  },

  sleep: {
    label: '睡觉',
    loop: true,
    make(t) {
      return {
        form: 'curl',
        breath: Math.sin((t * 2 * Math.PI) / 4.6) * 0.06,
        eyeOpen: 0,
        zzz: t,
      };
    },
  },

  groom: {
    label: '舔毛',
    loop: true,
    make(t) {
      // 头明显地上下点，低头时舌头碰到抬起的前爪。
      // 只让舌头一个像素闪烁的版本已被否决 - 那样几乎看不出在做什么。
      const cyc = Math.sin(t * 7);
      const nod = Math.max(0, cyc);
      return {
        form: 'sit',
        breath: 0,
        headDX: 0.5,
        headDY: 2 + nod * 3.5,
        tilt: -1,
        muzzleDY: nod * 1.2,
        tongue: cyc > 0.25,
        eyeOpen: 0.25,
        pawLift: 5 + Math.round(nod * 1.5),
        tailWave: 0.4,
        tailPhase: t * 1.5,
      };
    },
  },

  eat: {
    label: '吃饭',
    loop: true,
    make(t, cat) {
      const bob = Math.sin(t * 7);
      return {
        form: 'stand',
        // 食盆的位置。ticket 08 落地后食盆改为独立挂件，这里应停止设置。
        bowl: 34 + (cat.bodyRW + 8),
        headDX: 2,
        headDY: 7 + Math.round(bob * 1.2),
        muzzleDY: 0.5,
        mouth: bob > 0.4 ? 0.3 : 0,
        eyeOpen: 0.5,
        tailAng: 0.5,
        tailCurl: 1,
        tailWave: 0.25,
        tailPhase: t,
        breath: 0,
      };
    },
  },

  yawn: {
    label: '打哈欠',
    loop: true,
    period: 3.4,
    make(t, _cat, mi) {
      const k = (t % 3.4) / 3.4;
      let m = 0;
      if (k < 0.2) m = ease(k / 0.2);
      else if (k < 0.55) m = 1;
      else if (k < 0.75) m = 1 - ease((k - 0.55) / 0.2);
      return {
        form: 'sit',
        breath: 0,
        mouth: m,
        eyeOpen: m > 0.4 ? 0 : mi.eyeOpen,
        headDY: -Math.round(m * 2),
        muzzleDY: m * 1.5,
        tailWave: 0.3,
        tailPhase: t,
      };
    },
  },

  stretch: {
    label: '伸懒腰',
    loop: true,
    period: 3.8,
    make(t, _cat, mi) {
      const k = (t % 3.8) / 3.8;
      let s = 0;
      if (k < 0.25) s = ease(k / 0.25);
      else if (k < 0.7) s = 1 + Math.sin(t * 18) * 0.015; // 保持时微微颤
      else if (k < 0.9) s = 1 - ease((k - 0.7) / 0.2);
      s = clamp(s, 0, 1.05);
      return {
        form: 'stand',
        stretchX: 1 + s * 0.28,
        squashY: 1 - s * 0.18,
        dy: Math.round(s * 2.5),
        headDY: Math.round(s * 5),
        headDX: s * 2,
        legScale: 1 - s * 0.25,
        tailAng: 1.15,
        tailCurl: 2 - s,
        tailWave: 0.2,
        tailPhase: t,
        eyeOpen: s > 0.5 ? 0 : mi.eyeOpen,
        mouth: s > 0.8 ? 0.35 : 0,
      };
    },
  },

  pounce: {
    label: '扑跳',
    loop: true,
    period: 4.2,
    make(t, _cat, mi) {
      const T = t % 4.2;
      const base: Pose = {
        form: 'stand',
        eyeOpen: 1,
        tailWave: 1.2,
        tailPhase: t * 4,
        tailAng: 0.4,
        tailCurl: 0.8,
      };
      if (T < 1.3) {
        // 蓄力：压低身体 + 屁股扭动
        const wig = Math.sin(T * 14) * (T > 0.4 ? 1 : 0);
        return {
          ...base,
          squashY: 0.82,
          dy: 2,
          legScale: 0.6,
          dx: -6,
          headDY: 2,
          tailAng: 1.3 + wig * 0.12,
          pupilDX: 1,
        };
      }
      if (T < 1.85) {
        // 腾空：抛物线 + 拉伸 + 四脚离地。
        // airborne 是必须的 - 少了它腿会被拉长贴地，看起来像身体原地伸缩。
        const k = (T - 1.3) / 0.55;
        const arc = 4 * k * (1 - k);
        return {
          ...base,
          stretchX: 1.22,
          squashY: 0.85,
          dx: Math.round(-6 + k * 16),
          dy: Math.round(-arc * 9) + 2,
          airborne: arc * 9 - 1,
          legScale: 0.5,
          legOx: [4, 3, -3, -4],
          headDY: -1,
          eyeOpen: 1,
          pupilDX: 1,
        };
      }
      if (T < 2.15) {
        // 落地压缩 + 尘土
        const k = (T - 1.85) / 0.3;
        return {
          ...base,
          squashY: 0.72 + k * 0.2,
          stretchX: 1.08,
          dx: 10,
          dy: 1,
          legScale: 0.7,
          dust: k,
        };
      }
      if (T < 3.4) {
        // 得意地坐下环顾
        return {
          form: 'sit',
          dx: 10,
          breath: 0.02,
          eyeOpen: mi.eyeOpen,
          tailWave: 1.3,
          tailPhase: t * 3.5,
        };
      }
      // 走回原位
      const k = (T - 3.4) / 0.8;
      return { ...base, dx: Math.round(10 - 16 * k), eyeOpen: mi.eyeOpen };
    },
  },
};

/** 展示顺序，与 prototype ② 的按钮顺序一致。 */
export const ACTION_KEYS: readonly ActionKey[] = [
  'idle',
  'walk',
  'sit',
  'lie',
  'sleep',
  'groom',
  'eat',
  'yawn',
  'stretch',
  'pounce',
];
