import { hash2 } from './rng.js';
import type { Cat, Layer, Part } from './types.js';

/**
 * 花纹层：给定部件与部件内的局部坐标，决定这个像素该取哪一条色阶。
 *
 * u, v 是部件内的归一化坐标，范围 [-1, 1]，v 向下为正。
 * x, y 是绝对像素坐标，仅用于哈希抖动（必须逐像素稳定、不随帧变化）。
 *
 * **每个品种的花纹算法种类本身就是辨识特征**，不是可以互相替换的实现细节。
 * 修改前请读 docs/art-and-motion-decisions.md - 每条都有被否决的前任方案。
 */
export function layerOf(cat: Cat, part: Part, u: number, v: number, x: number, y: number): Layer {
  const m = cat.marks;
  const dither = hash2(x, y, cat.seed) - 0.5; // -0.5..0.5 的边界抖动

  switch (cat.breed) {
    case 'orange': {
      if (part === 'body') {
        if (v > 0.55 + dither * 0.2) return 'white'; // 奶油肚皮
        // 等距斜竖纹：相位取小数部分后与固定宽度比较。
        // 不做边缘抖动 - 抖动版本已被否决。
        const ph = u * m.stripeFreq! + v * 0.3 + m.stripePhase!;
        const fr = ph - Math.floor(ph);
        if (v < 0.45 && fr < m.stripeW!) return 'mark';
      }
      if (part === 'head' && m.headStripes) {
        if (v < -0.25 && (Math.abs(u) < 0.09 || Math.abs(Math.abs(u) - 0.42) < 0.08)) return 'mark';
      }
      return 'base';
    }

    case 'amshort': {
      if (part === 'body') {
        if (v > 0.62 + dither * 0.2) return 'white';
        // 侧腹 C 形回旋斑：一个椭圆环带 + 中心实心点。
        // 这是美短银虎斑的招牌特征，与橘猫的直条纹必须区分开。
        const du = (u + 0.2) / 0.62;
        const dv = (v + 0.05) / 0.78;
        const d = Math.sqrt(du * du + dv * dv);
        if (d > 0.52 && d < 0.95) return 'mark';
        if (d <= 0.28) return 'mark';
        // 背部短竖纹
        const ph = u * m.stripeFreq! + m.stripePhase!;
        const fr = ph - Math.floor(ph);
        if (v < -0.45 && fr < m.stripeW!) return 'mark';
      }
      if (part === 'head') {
        if (v < -0.25 && (Math.abs(u) < 0.09 || Math.abs(Math.abs(u) - 0.42) < 0.08)) return 'mark';
        if (Math.abs(v - 0.12) < 0.09 && Math.abs(u) > 0.6) return 'mark'; // 脸颊横纹
      }
      return 'base';
    }

    case 'devon': {
      // 波浪行纹表现卷毛。随机噪点版本已被否决（视觉上是脏，不是卷）。
      if (
        part === 'body' &&
        Math.sin(y * 1.9 + Math.sin(x * 0.9) * 1.6 + (cat.seed % 7)) > 1.25 - m.speck! * 6
      ) {
        return 'mark';
      }
      return 'base';
    }

    case 'aby': {
      if (part === 'body') {
        if (v > 0.55 + dither * 0.2) return 'white'; // 浅色腹部
        if (v < -0.35 + dither * 0.3) return 'mark'; // 深色背线，向腹部渐层
        if (hash2(x, y, cat.seed * 5 + 7) < m.tick!) return 'mark'; // ticked 斑点
      }
      if (part === 'head' && v > 0.45) return 'white';
      return 'base';
    }

    case 'black': {
      if (m.locket && part === 'body' && u > 0.62 && Math.abs(v) < 0.22 + dither * 0.2) {
        return 'white';
      }
      if (m.whiteToe && part === 'leg' && v > 0.72) return 'white';
      return 'base';
    }

    case 'cow': {
      if (part === 'body') {
        for (const p of m.patches!) {
          // 两个子圆求并，边缘用哈希抖动 → 不规则斑块。
          // 规则椭圆已被否决 - 「不规则」是这个品种的辨识特征。
          const j = (hash2(Math.round(x / 2), Math.round(y / 2), p.s) - 0.5) * 0.35;
          const d1 = ((u - p.u) / p.r) ** 2 + ((v - p.v) / (p.r * p.e)) ** 2;
          const d2 =
            ((u - p.u - p.r * 0.6) / (p.r * 0.7)) ** 2 + ((v - p.v + p.r * 0.4) / (p.r * 0.55)) ** 2;
          if (Math.min(d1, d2) < 1 + j) return 'mark';
        }
      }
      if (part === 'head' && m.headPatch) {
        const p = m.headPatch;
        const j = (hash2(x, y, p.s) - 0.5) * 0.4;
        if (((u - p.side * 0.45) / p.r) ** 2 + ((v + 0.35) / p.r) ** 2 < 1 + j) return 'mark';
      }
      if (part === 'earL') return m.earL ? 'mark' : 'base';
      if (part === 'earR') return m.earR ? 'mark' : 'base';
      if (part === 'tail') return m.tailBlack ? 'mark' : 'base';
      return 'base';
    }

    case 'ragdoll': {
      if (part === 'earL' || part === 'earR') return 'mark';
      if (part === 'tail') return 'mark';
      if (part === 'head') {
        // 面罩：眼周往上渐深，鼻口留白。深度由 Seed 决定，范围很宽。
        if (v < -m.maskDepth! + dither * 0.3 && Math.abs(u) > 0.12) return 'mark';
        if (v < -0.55 + dither * 0.3) return 'mark';
      }
      if (part === 'leg') {
        if (m.mitts && v > 0.6) return 'white'; // 白手套
        if (!m.mitts && v > 0.3) return 'mark';
      }
      if (part === 'body' && v < -0.62 + dither * 0.25) return 'mark'; // 背部淡重点色
      return 'base';
    }
  }
}
