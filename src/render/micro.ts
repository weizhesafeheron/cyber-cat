import { mulberry32 } from './rng.js';

/**
 * 微动作层。
 *
 * 随机眨眼、耳朵抖动、偶尔歪头这些小动作是「活着的感觉」的主要来源 -
 * prototype ② 逐个关闭对比验证过，贡献远大于它们的实现成本。
 *
 * **必须与基础动作正交。** 微动作有自己的状态与时序，动作库只是把结果读进
 * pose 里，不要把微动作烧进某个具体动作的定义。
 */
export interface MicroState {
  rnd: () => number;
  t: number;
  blinkAt: number;
  blinkT: number;
  earAt: number;
  earT: number;
  earSide: number;
  tiltAt: number;
  tiltT: number;
}

export interface MicroOpts {
  /** 默认开启。false 关闭眨眼。 */
  blink?: boolean;
  /** 默认开启。false 关闭耳朵抖动。 */
  ear?: boolean;
  /** 默认关闭。只有站立与端坐这类静态姿态适合歪头。 */
  tilt?: boolean;
}

export interface MicroOut {
  eyeOpen: number;
  earFlickL: number;
  earFlickR: number;
  tilt: number;
}

export function makeMicro(seed: number): MicroState {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  return {
    rnd,
    t: 0,
    blinkAt: 1 + rnd() * 3,
    blinkT: -1,
    earAt: 3 + rnd() * 5,
    earT: -1,
    earSide: 0,
    tiltAt: 6 + rnd() * 8,
    tiltT: -1,
  };
}

/**
 * 推进微动作状态。dt 为秒。
 *
 * 就地修改 m，返回这一帧的微动作输出。
 */
export function stepMicro(m: MicroState, dt: number, opts: MicroOpts = {}): MicroOut {
  m.t += dt;
  const out: MicroOut = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };

  if (opts.blink !== false) {
    if (m.blinkT < 0 && m.t >= m.blinkAt) m.blinkT = 0;
    if (m.blinkT >= 0) {
      m.blinkT += dt;
      const k = m.blinkT / 0.22;
      // 闭到一半再张开
      out.eyeOpen = k < 0.5 ? 1 - k * 2 : k < 1 ? (k - 0.5) * 2 : 1;
      if (k >= 1) {
        m.blinkT = -1;
        m.blinkAt = m.t + 1.5 + m.rnd() * 4;
      }
    }
  }

  if (opts.ear !== false) {
    if (m.earT < 0 && m.t >= m.earAt) {
      m.earT = 0;
      m.earSide = m.rnd() > 0.5 ? 1 : 0;
    }
    if (m.earT >= 0) {
      m.earT += dt;
      const f = m.earT < 0.3 ? 1 : 0;
      if (m.earSide) out.earFlickR = f;
      else out.earFlickL = f;
      if (m.earT > 0.42) {
        m.earT = -1;
        m.earAt = m.t + 2.5 + m.rnd() * 6;
      }
    }
  }

  if (opts.tilt) {
    if (m.tiltT < 0 && m.t >= m.tiltAt) m.tiltT = 0;
    if (m.tiltT >= 0) {
      m.tiltT += dt;
      const k = m.tiltT;
      // 歪过去、保持、再回正
      out.tilt = k < 0.4 ? k / 0.4 : k < 1.6 ? 1 : k < 2 ? (2 - k) / 0.4 : 0;
      // 保留这次 rnd() 消耗：原型里此处本意是随机左右歪头（-1 或 1），
      // 但两个分支都写成了 1，实际是空操作。删掉这次调用会改变后续所有
      // 微动作的时序，因此保留；是否恢复「向左歪头」是一次独立的美术决定。
      m.rnd();
      if (k >= 2) {
        m.tiltT = -1;
        m.tiltAt = m.t + 8 + m.rnd() * 10;
      }
    }
  }

  return out;
}
