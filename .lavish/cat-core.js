/* ============================================================
 * cat-core.js — PROTOTYPE (throwaway)
 * 程序化像素猫渲染核心：品种+seed → 外观参数 → 逐像素光栅化
 * 姿态系统（站/坐/趴/蜷）+ 动作库 + 微动作层
 * ============================================================ */
const CatCore = (() => {
  'use strict';

  const W = 72, H = 56, GROUND = 50;

  /* ---------------- RNG ---------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 稳定像素哈希（用于绒毛边缘/花纹抖动，不随帧变化）
  function hash2(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return (((h ^ (h >>> 16)) >>> 0) % 1000) / 1000;
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------------- 调色 ---------------- */
  const OUTLINE = '#241b36';
  const SHADOW = '#151126';

  const PALETTES = {
    orange: {
      base: ['#ffcf86', '#f5a94e', '#d17c2e'],
      mark: ['#e2914a', '#cd7526', '#a75a1d'],
      white: ['#fff3d9', '#ffedc9', '#e0c795'],
      muzzle: '#ffedc9', nose: '#e8838f', inner: '#e89aa8',
      eye: ['#f5b83d', '#b67708'],
    },
    black: {
      base: ['#6b6587', '#3b3850', '#262336'],
      mark: ['#6b6587', '#3b3850', '#262336'],
      white: ['#efeef5', '#dedbe8', '#b8b3c9'],
      muzzle: '#4a465e', nose: '#c* 68', inner: '#8d6478',
      eye: ['#ffd94a', '#c99a12'],
    },
    cow: {
      base: ['#ffffff', '#f3f1ea', '#cfccc2'],
      mark: ['#4a4760', '#312e44', '#232033'],
      white: ['#ffffff', '#f3f1ea', '#cfccc2'],
      muzzle: '#fbf8f0', nose: '#f08fa4', inner: '#f0a8b8',
      eye: ['#b7d94c', '#6f9422'],
    },
    ragdoll: {
      base: ['#fff6e8', '#f2e5cf', '#d3bfa0'],
      mark: ['#9c8874', '#7d6a58', '#5f4f41'],
      white: ['#fffdf7', '#faf3e6', '#dcd0ba'],
      muzzle: '#fffdf7', nose: '#e8a0b0', inner: '#eeb0be',
      eye: ['#7cc4ff', '#3b7fd4'],
    },
    devon: {
      base: ['#e3d2c0', '#c4ad94', '#9c8268'],
      mark: ['#b39c83', '#94806a', '#6f5d4c'],
      white: ['#f5ebdd', '#e8dbc8', '#c6b49c'],
      muzzle: '#f5ebdd', nose: '#d78b98', inner: '#e2a5b1',
      eye: ['#e5c95c', '#a8862a'],
    },
    amshort: {
      base: ['#eef0f5', '#cfd2dd', '#a4a7b8'],
      mark: ['#565a76', '#3e405a', '#2a2c42'],
      white: ['#f8f9fc', '#e6e8f0', '#bfc2d2'],
      muzzle: '#f8f9fc', nose: '#e08b9d', inner: '#e9a8b6',
      eye: ['#b7d94c', '#6f9422'],
    },
    aby: {
      base: ['#e09a55', '#bd7436', '#8a4e22'],
      mark: ['#7c451c', '#5e3314', '#42230d'],
      white: ['#ffe9cd', '#f4d9b4', '#d3b287'],
      muzzle: '#ffe9cd', nose: '#c96a70', inner: '#e2989f',
      eye: ['#cdd44e', '#7c8f1e'],
    },
  };
  // 布偶重点色的三个色系（海豹/蓝/巧克力），按 Seed 抽 → 拉开个体差异
  const RAGDOLL_POINTS = [
    ['#9c8874', '#7d6a58', '#5f4f41'],
    ['#a3a4bd', '#83849e', '#63647c'],
    ['#b59a7d', '#96795c', '#755c44'],
  ];
  PALETTES.black.nose = '#c66a80';

  /* ---------------- 品种定义 ---------------- */
  const BREEDS = {
    orange: {
      key: 'orange', label: '橘猫', desc: '圆 · 懒 · 尾巴粗',
      bodyRW: [12.5, 14], bodyRH: [8.6, 10],
      headR: [8.4, 9.2], earH: [4, 5], earW: [4, 5],
      tailLen: [11, 13], tailThick: [3.1, 3.8], legLen: [4, 5],
      fluff: 0.12, eyeBig: 0, active: 0.25,
    },
    black: {
      key: 'black', label: '黑猫', desc: '轮廓细长 · 眼睛明显',
      bodyRW: [11.5, 13], bodyRH: [6.6, 7.6],
      headR: [7.6, 8.3], earH: [5, 6.4], earW: [4, 4.6],
      tailLen: [13, 15], tailThick: [2.1, 2.6], legLen: [6, 7],
      fluff: 0, eyeBig: 1, active: 0.55, sitW: 0.6,
    },
    cow: {
      key: 'cow', label: '奶牛猫', desc: '花纹不规则 · 动作活跃',
      bodyRW: [11.5, 13.5], bodyRH: [7.4, 8.6],
      headR: [7.9, 8.7], earH: [4.4, 5.6], earW: [4.2, 5],
      tailLen: [11, 14], tailThick: [2.4, 3], legLen: [5, 6],
      fluff: 0, eyeBig: 0, active: 0.85,
    },
    ragdoll: {
      key: 'ragdoll', label: '布偶猫', desc: '毛领大 · 尾巴蓬松',
      bodyRW: [11.5, 14.5], bodyRH: [8, 9.8],
      headR: [8, 9.2], earH: [4, 4.8], earW: [4.2, 4.8],
      tailLen: [11, 14], tailThick: [3.2, 5], legLen: [4.5, 5.5],
      fluff: 0.55, eyeBig: 0, active: 0.4,
    },
    devon: {
      key: 'devon', label: '德文卷毛', desc: '耳朵巨大 · 精灵脸',
      bodyRW: [10, 11.5], bodyRH: [5.8, 6.8],
      headR: [7, 7.8], earH: [7.5, 9], earW: [7, 8.2],
      tailLen: [12, 14], tailThick: [1.8, 2.2], legLen: [5.5, 6.5],
      fluff: 0, eyeBig: 1, active: 0.8,
      sitW: 0.64, earSet: 0.8, earSpread: [0.8, 1.6], earRound: true, earDrop: 2,
    },
    amshort: {
      key: 'amshort', label: '美短', desc: '银虎斑 · 结实',
      bodyRW: [12.5, 14], bodyRH: [8, 9.2],
      headR: [8.4, 9.1], earH: [4, 4.8], earW: [4.4, 5],
      tailLen: [10, 12], tailThick: [2.8, 3.4], legLen: [4.5, 5.5],
      fluff: 0, eyeBig: 0, active: 0.5, sitW: 0.78,
    },
    aby: {
      key: 'aby', label: '阿比西尼亚', desc: '野性优雅 · 渐层毛色',
      bodyRW: [10.5, 12], bodyRH: [6.2, 7],
      headR: [7.6, 8.3], earH: [7, 8.2], earW: [6, 7],
      tailLen: [13, 15], tailThick: [2, 2.5], legLen: [6.5, 7.5],
      fluff: 0, eyeBig: 1, active: 0.75,
      sitW: 0.6, earSet: 0.74, earSpread: [1.8, 2.8], earDrop: 1, eyeLiner: true,
    },
  };
  const BREED_KEYS = Object.keys(BREEDS);

  /* ---------------- 生成一只猫 ---------------- */
  function makeCat(breed, seed) {
    const B = BREEDS[breed];
    const rnd = mulberry32((seed * 7919 + BREED_KEYS.indexOf(breed) * 104729) >>> 0);
    const R = (range) => lerp(range[0], range[1], rnd());

    const cat = {
      breed, seed,
      bodyRW: R(B.bodyRW), bodyRH: R(B.bodyRH),
      headR: R(B.headR), earH: R(B.earH), earW: R(B.earW),
      tailLen: Math.round(R(B.tailLen)), tailThick: R(B.tailThick),
      legLen: R(B.legLen), fluff: B.fluff * (0.7 + rnd() * 0.6),
      eyeBig: B.eyeBig,
      sitW: B.sitW || 0.75,
      earSet: B.earSet || 0.55,
      earSpread: B.earSpread ? R(B.earSpread) : 0,
      earRound: !!B.earRound, earDrop: B.earDrop || 0,
      eyeLiner: !!B.eyeLiner,
      pal: PALETTES[breed],
      personality: {
        active: clamp(B.active + (rnd() - 0.5) * 0.55, 0.05, 0.95),
        clingy: rnd(), greedy: rnd(),
      },
      marks: {},
    };

    if (breed === 'orange') {
      cat.marks.stripeFreq = 2.5 + rnd() * 1.5;       // 条纹带数
      cat.marks.stripeW = 0.22 + rnd() * 0.12;        // 条纹宽（相位占比）
      cat.marks.stripePhase = rnd();
      cat.marks.headStripes = rnd() > 0.25;
      cat.marks.tailRings = true;
    }
    if (breed === 'amshort') {
      cat.marks.stripeFreq = 2 + rnd() * 1.2;
      cat.marks.stripeW = 0.34 + rnd() * 0.12;        // 美短虎斑更粗
      cat.marks.stripePhase = rnd();
      cat.marks.headStripes = true;
      cat.marks.tailRings = true;
    }
    if (breed === 'devon') {
      cat.marks.speck = 0.05 + rnd() * 0.05;          // 卷毛质感的稀疏斑点
    }
    if (breed === 'aby') {
      cat.marks.tick = 0.09 + rnd() * 0.07;           // ticked 渐层斑点密度
    }
    if (breed === 'black') {
      cat.marks.whiteToe = rnd() > 0.6;
      cat.marks.locket = rnd() > 0.8;                 // 胸口小白斑
    }
    if (breed === 'cow') {
      const n = 2 + Math.floor(rnd() * 2);
      cat.marks.patches = [];
      for (let i = 0; i < n; i++) {
        cat.marks.patches.push({
          u: rnd() * 1.6 - 0.8, v: rnd() * 1.2 - 0.8,
          r: 0.22 + rnd() * 0.32, e: 0.7 + rnd() * 0.7, s: Math.floor(rnd() * 997),
        });
      }
      cat.marks.headPatch = rnd() > 0.25
        ? { side: rnd() > 0.5 ? 1 : -1, r: 0.5 + rnd() * 0.35, s: Math.floor(rnd() * 997) }
        : null;
      cat.marks.earL = rnd() > 0.5; cat.marks.earR = rnd() > 0.5;
      cat.marks.tailBlack = rnd() > 0.3;
      // 奶牛猫保底：第一块斑钳制到坐姿可见的后臀区（头/胸在 +u 侧会挡住）
      cat.marks.patches[0].u = clamp(cat.marks.patches[0].u, -0.85, -0.15);
      cat.marks.patches[0].v = clamp(cat.marks.patches[0].v, -0.55, 0.3);
      cat.marks.patches[0].r = Math.max(cat.marks.patches[0].r, 0.42);
      if (!cat.marks.headPatch && !cat.marks.earL && !cat.marks.earR) {
        cat.marks.earL = true; cat.marks.tailBlack = true;
      }
    }
    if (breed === 'ragdoll') {
      cat.marks.maskDepth = 0.02 + rnd() * 0.55;      // 面罩深浅拉大：从几乎全白脸到深面罩
      cat.marks.mitts = rnd() > 0.25;                 // 白手套
      cat.marks.ruffR = 0.8 + rnd() * 2.6;            // 毛领外扩幅度拉大
      cat.fluff = 0.55 * (0.55 + rnd() * 0.9);        // 蓬松度个体差异
      // 重点色色系：海豹棕 / 蓝灰 / 巧克力
      cat.pal = Object.assign({}, cat.pal, { mark: RAGDOLL_POINTS[Math.floor(rnd() * RAGDOLL_POINTS.length)] });
    }
    return cat;
  }

  /* ---------------- 花纹层：part 局部坐标 (u,v∈[-1,1]) → 'base'|'mark'|'white' ---------------- */
  function layerOf(cat, part, u, v, x, y) {
    const m = cat.marks;
    const dither = hash2(x, y, cat.seed) - 0.5; // -0.5..0.5 边界抖动
    switch (cat.breed) {
      case 'orange': {
        if (part === 'body') {
          if (v > 0.55 + dither * 0.2) return 'white';           // 奶油肚皮
          // 干净的等距竖纹（带一点斜度）
          const ph = u * m.stripeFreq + v * 0.3 + m.stripePhase;
          const fr = ph - Math.floor(ph);
          if (v < 0.45 && fr < m.stripeW) return 'mark';
        }
        if (part === 'head' && m.headStripes) {
          if (v < -0.25 && (Math.abs(u) < 0.09 || Math.abs(Math.abs(u) - 0.42) < 0.08)) return 'mark';
        }
        return 'base';
      }
      case 'amshort': {
        if (part === 'body') {
          if (v > 0.62 + dither * 0.2) return 'white';
          // 经典虎斑：侧腹 C 形回旋斑（美短的招牌）+ 背部短竖纹
          const du = (u + 0.2) / 0.62, dv = (v + 0.05) / 0.78;
          const d = Math.sqrt(du * du + dv * dv);
          if (d > 0.52 && d < 0.95) return 'mark';
          if (d <= 0.28) return 'mark';                          // 回旋中心实心点
          const ph = u * m.stripeFreq + m.stripePhase;
          const fr = ph - Math.floor(ph);
          if (v < -0.45 && fr < m.stripeW) return 'mark';
        }
        if (part === 'head') {
          if (v < -0.25 && (Math.abs(u) < 0.09 || Math.abs(Math.abs(u) - 0.42) < 0.08)) return 'mark';
          if (Math.abs(v - 0.12) < 0.09 && Math.abs(u) > 0.6) return 'mark'; // 脸颊横纹
        }
        return 'base';
      }
      case 'devon': {
        // 卷毛质感：波浪行纹（比随机噪点更像卷曲的毛）
        if (part === 'body' && Math.sin(y * 1.9 + Math.sin(x * 0.9) * 1.6 + cat.seed % 7) > 1.25 - m.speck * 6) return 'mark';
        return 'base';
      }
      case 'aby': {
        if (part === 'body') {
          if (v > 0.55 + dither * 0.2) return 'white';           // 浅色腹部
          if (v < -0.35 + dither * 0.3) return 'mark';           // 深色背线 → 渐层
          if (hash2(x, y, cat.seed * 5 + 7) < m.tick) return 'mark'; // ticked 斑点
        }
        if (part === 'head' && v > 0.45) return 'white';
        return 'base';
      }
      case 'black': {
        if (m.locket && part === 'body' && u > 0.62 && Math.abs(v) < 0.22 + dither * 0.2) return 'white';
        if (m.whiteToe && part === 'leg' && v > 0.72) return 'white';
        return 'base';
      }
      case 'cow': {
        if (part === 'body') {
          for (const p of m.patches) {
            // 两个子圆求并，边缘用哈希抖动 → 不规则斑块
            const j = (hash2(Math.round(x / 2), Math.round(y / 2), p.s) - 0.5) * 0.35;
            const d1 = ((u - p.u) / p.r) ** 2 + ((v - p.v) / (p.r * p.e)) ** 2;
            const d2 = ((u - p.u - p.r * 0.6) / (p.r * 0.7)) ** 2 + ((v - p.v + p.r * 0.4) / (p.r * 0.55)) ** 2;
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
          // 面罩：眼周往上渐深，鼻口留白
          if (v < -m.maskDepth + dither * 0.3 && Math.abs(u) > 0.12) return 'mark';
          if (v < -0.55 + dither * 0.3) return 'mark';
        }
        if (part === 'leg') {
          if (m.mitts && v > 0.6) return 'white';
          if (!m.mitts && v > 0.3) return 'mark';
        }
        if (part === 'body' && v < -0.62 + dither * 0.25) return 'mark'; // 背部淡重点色
        return 'base';
      }
    }
    return 'base';
  }

  /* ---------------- 像素缓冲 ---------------- */
  function createRenderer(canvas) {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const colorCache = {};
    function rgba(hex) {
      let c = colorCache[hex];
      if (!c) {
        c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
        colorCache[hex] = c;
      }
      return c;
    }
    const buf = new Array(W * H);

    function px(x, y, color) {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      buf[y * W + x] = color;
    }
    function getPx(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return undefined;
      return buf[y * W + x];
    }

    // 椭圆光栅化。shade(u,v,x,y) 返回颜色或 null
    function blobFn(cx, cy, rx, ry, shade, fluff, seed) {
      const x0 = Math.floor(cx - rx - 2), x1 = Math.ceil(cx + rx + 2);
      const y0 = Math.floor(cy - ry - 2), y1 = Math.ceil(cy + ry + 2);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
          const d = u * u + v * v;
          if (d <= 1) {
            if (fluff && d > 0.86 && hash2(x, y, seed) < fluff * 0.35) continue; // 内缘啃出毛边
            const c = shade(clamp(u, -1, 1), clamp(v, -1, 1), x, y);
            if (c) px(x, y, c);
          } else if (fluff && d < 1.35 && hash2(x, y, seed + 7) < fluff * 0.6) {
            const c = shade(clamp(u, -1, 1), clamp(v, -1, 1), x, y);
            if (c) px(x, y, c);          // 外缘长出绒毛
          }
        }
      }
    }

    const tone = (v) => (v < -0.42 ? 0 : v > 0.5 ? 2 : 1);

    // 部件着色器
    function furShade(cat, part, opts = {}) {
      return (u, v, x, y) => {
        const layer = opts.layer || layerOf(cat, part, u, v, x, y);
        let t = tone(v);
        if (opts.darken) t = Math.min(2, t + 1);
        const ramp = cat.pal[layer] || cat.pal.base;
        return ramp[t];
      };
    }

    function rect(x0, y0, w, h, shade, part) {
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++) {
          const u = w > 1 ? ((x - x0) / (w - 1)) * 2 - 1 : 0;
          const v = h > 1 ? ((y - y0) / (h - 1)) * 2 - 1 : 0;
          const c = shade(u, v, x, y);
          if (c) px(x, y, c);
        }
    }

    /* ------ 尾巴：链式圆盘 ------ */
    function tail(cat, sx, sy, o) {
      const n = cat.tailLen;
      let x = sx, y = sy, ang = o.baseAng;
      const step = 1.35;
      for (let i = 0; i < n; i++) {
        ang += o.curl / n + (o.wave || 0) * Math.sin((o.wavePhase || 0) + i * 0.55) * 0.09;
        x += Math.cos(ang) * step * (o.dirX || 1);
        y -= Math.sin(ang) * step;
        if (o.floor) y = Math.min(y, GROUND - 1.6);
        const taper = cat.breed === 'ragdoll' ? 1 - 0.3 * (i / n) : 1 - 0.55 * (i / n);
        const r = Math.max(1, cat.tailThick * 0.62 * taper + (cat.breed === 'ragdoll' ? 0.9 : 0));
        let layer = null;
        if (cat.marks.tailRings) layer = (i % 5) < 2 && i > 2 ? 'mark' : 'base';
        else if (cat.breed === 'aby') layer = i > n * 0.72 ? 'mark' : 'base'; // 深色尾尖
        else layer = layerOf(cat, 'tail', 0, 0, Math.round(x), Math.round(y)) === 'mark' ? 'mark' : 'base';
        blobFn(x, y, r, r, furShade(cat, 'tail', { layer }), cat.fluff, cat.seed + i * 13);
      }
      return { x, y };
    }

    /* ------ 耳朵：支持外张（spread）、圆耳尖（round）------ */
    function ear(cat, bx, ty, side, flick, part) {
      const eh = Math.max(3, Math.round(cat.earH - flick * 2));
      const ew = Math.round(cat.earW);
      for (let i = 0; i < eh; i++) {
        let hw = Math.round((ew / 2) * (i / (eh - 1 || 1)));
        if (cat.earRound && i === 0) hw = Math.max(1, Math.round(ew * 0.2)); // 圆耳尖：顶行不收成尖
        hw = Math.max(0, hw);
        const cx = bx + Math.round(side * cat.earSpread * (1 - i / eh));   // 耳尖向外张
        const y = ty + i;
        for (let x = cx - hw; x <= cx + hw; x++) {
          const c = furShade(cat, part)((x - cx) / (hw || 1), -0.6, x, y);
          px(x, y, c);
        }
      }
      // 内耳（大耳朵内耳也更大）
      const iy = ty + eh - 2;
      const icx = bx + Math.round(side * cat.earSpread * 0.3);
      px(icx, iy, cat.pal.inner);
      px(icx, iy - 1, cat.pal.inner);
      if (cat.earW >= 6) { px(icx + side, iy, cat.pal.inner); px(icx, iy - 2, cat.pal.inner); }
    }

    /* ------ 头 ------ */
    function head(cat, hx, hy, o) {
      const r = cat.headR * (o.scale || 1);
      const tiltPx = Math.round((o.tilt || 0) * 2.5);
      // 布偶毛领（画在头之前，垫在下面）
      if (cat.breed === 'ragdoll') {
        blobFn(hx, hy + r * 0.45, r + cat.marks.ruffR, r * 0.78, (u, v, x, y) => {
          if (v < -0.2) return null;
          return cat.pal.white[tone(v) === 2 ? 2 : v > 0.4 ? 1 : 0];
        }, 0.8, cat.seed + 99);
      }
      // 耳朵（头顶之上；earSet 控制耳距，earDrop 控制低位耳）
      const earTop = hy - r - cat.earH + 2 + cat.earDrop;
      ear(cat, Math.round(hx - r * cat.earSet) + tiltPx, Math.round(earTop + (o.earFlickL ? 1 : 0)), -1, o.earFlickL || 0, 'earL');
      ear(cat, Math.round(hx + r * cat.earSet) + tiltPx, Math.round(earTop + (o.earFlickR ? 1 : 0)), 1, o.earFlickR || 0, 'earR');
      // 头
      blobFn(hx, hy, r * 1.06, r, furShade(cat, 'head'), cat.fluff * 0.7, cat.seed + 5);
      // 口鼻区
      const muzY = hy + r * 0.42 + (o.muzzleDY || 0);
      blobFn(hx + tiltPx * 0.4, muzY, 3.2, 2.1, () => cat.pal.muzzle, 0, 0);
      px(hx + tiltPx * 0.4, muzY - 1, cat.pal.nose);
      // 嘴
      const mo = o.mouth || 0;
      if (mo > 0.05) {
        const mh = Math.max(1, Math.round(mo * 3.2));
        blobFn(hx + tiltPx * 0.4, muzY + 1 + mh * 0.4, 1.6, mh * 0.7 + 0.4, () => '#5e2b3a', 0, 0);
        if (mo > 0.6) px(hx + tiltPx * 0.4, muzY + 1 + mh, '#e8838f'); // 舌
      }
      if (o.tongue) px(hx + tiltPx * 0.4, muzY + 2, '#f08fa4');
      // 眼睛
      const open = o.eyeOpen == null ? 1 : o.eyeOpen;
      const ey = Math.round(hy - r * 0.08 + (o.eyeDY || 0));
      const off = Math.round(r * 0.42);
      const pdx = Math.round(o.pupilDX || 0);
      const tiltL = (o.tilt || 0) > 0.3 ? 1 : 0, tiltR = (o.tilt || 0) < -0.3 ? 1 : 0;
      drawEye(cat, hx - off + tiltPx, ey + tiltL, open, pdx, -1);
      drawEye(cat, hx + off + tiltPx, ey + tiltR, open, pdx, 1);
      // 腮毛（黑猫细长脸颊两侧一点绒毛）
      if (cat.breed !== 'black') {
        px(hx - r - 1, hy + 1, cat.pal[layerOf(cat, 'head', -1, 0.1, hx - r - 1, hy + 1)][1]);
        px(hx + r + 1, hy + 1, cat.pal[layerOf(cat, 'head', 1, 0.1, hx + r + 1, hy + 1)][1]);
      }
    }

    function drawEye(cat, ex, ey, open, pdx, side) {
      const big = cat.eyeBig;
      // side<0 → 像素列 [ex, ex+1]；side>0 → [ex-1, ex]，保证左右对称
      const x0 = side < 0 ? ex : ex - 1;
      const w = big ? 3 : 2, h = big ? 3 : 2;
      const bx0 = big ? (side < 0 ? ex - 1 : ex - 1) : x0;
      if (open > 0.55) {
        for (let dy = 0; dy < h; dy++)
          for (let dx = 0; dx < w; dx++)
            px(bx0 + dx, ey + dy - 1, cat.pal.eye[dy === h - 1 ? 1 : 0]);
        px(bx0 + (w >> 1) + pdx, ey, '#1c1226');            // 瞳孔
        if (big) px(bx0 + (w >> 1) + pdx, ey - 1, '#1c1226'); // 竖瞳
        px(bx0, ey - 1, '#ffffff');                           // 高光
        if (cat.eyeLiner) for (let dx = -1; dx <= w; dx++) px(bx0 + dx, ey - 2, cat.pal.mark[1]); // 深色眼线
      } else if (open > 0.15) {
        px(x0, ey, cat.pal.eye[0]); px(x0 + 1, ey, cat.pal.eye[1]);
      } else {
        px(x0 - (side < 0 ? 0 : 1), ey, OUTLINE); px(x0 + 1, ey, OUTLINE); px(x0, ey, OUTLINE);
      }
    }

    /* ------ 腿 ------ */
    function leg(cat, x, topY, o = {}) {
      const bottom = GROUND - 1 - (o.lift || 0);
      const shade = furShade(cat, 'leg', { darken: o.far });
      const h = Math.max(2, bottom - topY + 1);
      rect(x + (o.ox || 0), topY, 2, h, shade, 'leg');
      // 爪
      const pawShade = (u, v, xx, yy) => {
        const l = layerOf(cat, 'leg', u, 0.9, xx, yy);
        const ramp = cat.pal[l];
        return ramp[o.far ? 2 : 1];
      };
      rect(x + (o.ox || 0) - (o.dir > 0 ? 0 : 1), bottom, 3, 1, pawShade, 'leg');
    }

    /* ================= 姿态绘制 ================= */

    function drawStand(cat, p) {
      const dir = p.dir || 1;
      const breath = 1 + (p.breath || 0);
      const rw = cat.bodyRW * (p.stretchX || 1);
      const rh = cat.bodyRH * breath * (p.squashY || 1);
      const bx = 34 + (p.dx || 0);
      const legLen = cat.legLen * (p.legScale || 1);
      const by = GROUND - legLen - rh * 0.82 + (p.dy || 0);

      // 尾巴（身后）
      tail(cat, bx - dir * (rw - 1), by - 2, {
        baseAng: p.tailAng == null ? 0.9 : p.tailAng,
        curl: p.tailCurl == null ? 1.6 : p.tailCurl,
        wave: p.tailWave, wavePhase: p.tailPhase, dirX: -dir,
      });
      // 腾空高度：四条腿一起离地（扑跳滞空用）
      const air = Math.max(0, Math.round(p.airborne || 0));
      // 远侧腿
      const legTop = by + rh * 0.5;
      leg(cat, bx + dir * (rw - 5) - 1, legTop, { far: true, ox: p.legOx ? p.legOx[1] : 0, lift: (p.legLift ? p.legLift[1] : 0) + air, dir });
      leg(cat, bx - dir * (rw - 5) - 1, legTop, { far: true, ox: p.legOx ? p.legOx[3] : 0, lift: (p.legLift ? p.legLift[3] : 0) + air, dir });
      // 身体
      blobFn(bx, by, rw, rh, furShade(cat, 'body'), cat.fluff, cat.seed);
      // 近侧腿
      leg(cat, bx + dir * (rw - 3) - 1, legTop, { ox: p.legOx ? p.legOx[0] : 0, lift: (p.legLift ? p.legLift[0] : 0) + air, dir });
      leg(cat, bx - dir * (rw - 3) - 1, legTop, { ox: p.legOx ? p.legOx[2] : 0, lift: (p.legLift ? p.legLift[2] : 0) + air, dir });
      // 头
      const hx = bx + dir * (rw - 1) + (p.headDX || 0) * dir;
      const hy = by - rh - cat.headR * 0.55 + (p.headDY || 0);
      head(cat, Math.round(hx), Math.round(hy), p);
      return { bx, by, hx, hy };
    }

    function drawSit(cat, p) {
      const dir = p.dir || 1;
      const breath = 1 + (p.breath || 0);
      const bx = 34 + (p.dx || 0);
      // 腿长的猫坐得更高更瘦（黑猫/阿比/德文细长），腿短的猫坐成一坨（橘猫/美短）
      const rearRX = cat.bodyRW * cat.sitW, rearRY = (7.2 + cat.legLen * 0.72) * breath;
      const rearCX = bx - dir * 2, rearCY = GROUND - rearRY + 0.5;
      // 尾巴：绕到身前地面
      if (p.tailWrap !== false) {
        tail(cat, rearCX - dir * (rearRX - 2), GROUND - 2.4, {
          baseAng: -0.12, curl: p.tailCurl == null ? 0.5 : p.tailCurl,
          wave: p.tailWave == null ? 0.5 : p.tailWave, wavePhase: p.tailPhase,
          dirX: dir, floor: true,
        });
      }
      // 后臀
      blobFn(rearCX, rearCY, rearRX, rearRY, furShade(cat, 'body'), cat.fluff, cat.seed);
      // 胸
      const chestCX = bx + dir * 4.5, chestRY = rearRY * 0.84;
      const chestCY = GROUND - chestRY + 0.5;
      blobFn(chestCX, chestCY, 5.8, chestRY, furShade(cat, 'body'), cat.fluff, cat.seed + 3);
      // 前腿（坐直；pawLift > 0 时近侧前爪抬起 - 舔毛用）
      leg(cat, Math.round(chestCX + dir * 2) - 1, Math.round(GROUND - 7), { dir, lift: p.pawLift || 0 });
      leg(cat, Math.round(chestCX - dir * 2) - 1, Math.round(GROUND - 7), { far: true, dir });
      // 头
      const hx = chestCX + dir * 1.5 + (p.headDX || 0) * dir;
      const hy = GROUND - chestRY * 2 - cat.headR * 0.78 + 1.5 + (p.headDY || 0);
      head(cat, Math.round(hx), Math.round(hy), Object.assign({}, p, { scale: (p.scale || 1) * 1.06 }));
      return { bx, hx, hy };
    }

    function drawLie(cat, p) {
      const dir = p.dir || 1;
      const breath = 1 + (p.breath || 0) * 0.7;
      const bx = 34 + (p.dx || 0);
      const rw = cat.bodyRW * 1.08, rh = 5.6 * breath;
      const by = GROUND - rh + 0.4;
      // 尾巴沿地
      tail(cat, bx - dir * (rw - 2), GROUND - 2.2, {
        baseAng: 0.06, curl: 0.25, wave: p.tailWave, wavePhase: p.tailPhase,
        dirX: -dir, floor: true,
      });
      blobFn(bx, by, rw, rh, furShade(cat, 'body'), cat.fluff, cat.seed);
      // 前爪面包爪
      const pawShade = () => cat.pal[layerOf(cat, 'leg', 0, 0.9, 0, 0)][0];
      blobFn(bx + dir * (rw - 3), GROUND - 1.4, 2.4, 1.4, furShade(cat, 'leg'), 0, 0);
      // 头
      const hx = bx + dir * (rw - 2) + (p.headDX || 0) * dir;
      const hy = GROUND - rh * 2 - cat.headR * 0.55 + 0.5 + (p.headDY || 0);
      head(cat, Math.round(hx), Math.round(hy), p);
      return { bx, hx, hy };
    }

    function drawCurl(cat, p) {
      const dir = p.dir || 1;
      const breath = 1 + (p.breath || 0) * 0.8;
      const bx = 34 + (p.dx || 0);
      const rw = cat.bodyRW * 0.95, rh = 7.6 * breath;
      const by = GROUND - rh + 0.4;
      blobFn(bx, by, rw, rh, furShade(cat, 'body'), cat.fluff, cat.seed);
      // 尾巴绕过身前直到鼻尖
      tail(cat, bx - dir * (rw - 3), GROUND - 2, {
        baseAng: -0.05, curl: 0.55, wave: 0, dirX: dir, floor: true,
      });
      // 头贴在身侧
      const hx = bx + dir * (rw * 0.55);
      const hy = by - rh * 0.15;
      head(cat, Math.round(hx), Math.round(hy), Object.assign({ scale: 0.92 }, p, { eyeOpen: p.eyeOpen == null ? 0 : p.eyeOpen }));
      return { bx, hx, hy };
    }

    /* ------ 额外元素 ------ */
    function drawBowl(x) {
      for (let dx = -4; dx <= 4; dx++) px(x + dx, GROUND - 1, '#3d4f8a');
      for (let dx = -5; dx <= 5; dx++) { px(x + dx, GROUND, '#2c3a68'); px(x + dx, GROUND + 1, '#232c52'); }
      for (let dx = -3; dx <= 3; dx++) px(x + dx, GROUND - 2, '#c98a4b'); // 粮
      px(x - 1, GROUND - 3, '#e0a45e'); px(x + 2, GROUND - 3, '#e0a45e');
    }
    function drawZzz(x, y, t) {
      const zs = [[0, 0], [4, -5]];
      const gl = [[0,0],[1,0],[2,0],[1,1],[0,2],[1,2],[2,2]]; // 3x3 Z
      zs.forEach(([ox, oy], i) => {
        const ph = (t * 0.5 + i * 0.5) % 1;
        const yy = y + oy - ph * 6, xx = x + ox + Math.sin(ph * 6.28) * 1.5;
        if (ph < 0.85) gl.forEach(([gx, gy]) => px(Math.round(xx + gx), Math.round(yy + gy), i ? '#6fe3ff' : '#9db8ff'));
      });
    }
    function drawDust(x, t) {
      const k = clamp(t, 0, 1);
      [[-6, -1], [6, -2], [-9, -3], [9, -1]].forEach(([ox, oy], i) => {
        if (k < 0.7) px(x + ox * (0.5 + k), GROUND - 1 + oy * k, '#8a86a8');
      });
    }

    /* ------ 描边 + 影子 ------ */
    function outlinePass() {
      const marks = [];
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (buf[y * W + x]) continue;
          if (getPx(x + 1, y) || getPx(x - 1, y) || getPx(x, y + 1) || getPx(x, y - 1)) marks.push(y * W + x);
        }
      for (const i of marks) buf[i] = OUTLINE;
    }
    function shadowPass(cx, rx) {
      for (let y = GROUND; y <= GROUND + 1; y++)
        for (let x = Math.round(cx - rx); x <= Math.round(cx + rx); x++) {
          const u = (x - cx) / rx;
          if (u * u <= 1 - (y - GROUND) * 0.4 && !buf[y * W + x]) buf[y * W + x] = SHADOW;
        }
    }

    /* ------ 主入口 ------ */
    const FORMS = { stand: drawStand, sit: drawSit, lie: drawLie, curl: drawCurl };

    function draw(cat, pose) {
      buf.fill(undefined);
      if (pose.bowl) drawBowl(pose.bowl);
      const anchors = FORMS[pose.form || 'stand'](cat, pose);
      outlinePass();
      shadowPass(anchors.bx, cat.bodyRW + 3);
      if (pose.zzz) drawZzz(anchors.hx + 8 * (pose.dir || 1), anchors.hy - 10, pose.zzz);
      if (pose.dust != null) drawDust(anchors.bx, pose.dust);
      // 输出
      const d = img.data;
      for (let i = 0; i < W * H; i++) {
        const c = buf[i];
        const o = i * 4;
        if (c) { const [r, g, b] = rgba(c); d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255; }
        else d[o + 3] = 0;
      }
      ctx.putImageData(img, 0, 0);
    }

    return { draw, canvas };
  }

  /* ================= 微动作层 ================= */
  function makeMicro(seed) {
    const rnd = mulberry32(seed ^ 0x9e3779b9);
    return {
      rnd, t: 0,
      blinkAt: 1 + rnd() * 3, blinkT: -1,
      earAt: 3 + rnd() * 5, earT: -1, earSide: 0,
      tiltAt: 6 + rnd() * 8, tiltT: -1,
    };
  }
  function stepMicro(m, dt, opts = {}) {
    m.t += dt;
    const out = { eyeOpen: 1, earFlickL: 0, earFlickR: 0, tilt: 0 };
    if (opts.blink !== false) {
      if (m.blinkT < 0 && m.t >= m.blinkAt) { m.blinkT = 0; }
      if (m.blinkT >= 0) {
        m.blinkT += dt;
        const k = m.blinkT / 0.22;
        out.eyeOpen = k < 0.5 ? 1 - k * 2 : (k < 1 ? (k - 0.5) * 2 : 1);
        if (k >= 1) { m.blinkT = -1; m.blinkAt = m.t + 1.5 + m.rnd() * 4; }
      }
    }
    if (opts.ear !== false) {
      if (m.earT < 0 && m.t >= m.earAt) { m.earT = 0; m.earSide = m.rnd() > 0.5 ? 1 : 0; }
      if (m.earT >= 0) {
        m.earT += dt;
        const f = m.earT < 0.3 ? 1 : 0;
        if (m.earSide) out.earFlickR = f; else out.earFlickL = f;
        if (m.earT > 0.42) { m.earT = -1; m.earAt = m.t + 2.5 + m.rnd() * 6; }
      }
    }
    if (opts.tilt) {
      if (m.tiltT < 0 && m.t >= m.tiltAt) m.tiltT = 0;
      if (m.tiltT >= 0) {
        m.tiltT += dt;
        const k = m.tiltT;
        out.tilt = k < 0.4 ? k / 0.4 : k < 1.6 ? 1 : k < 2 ? (2 - k) / 0.4 : 0;
        out.tilt *= (m.rnd() > 0.5 ? 1 : 1);
        if (k >= 2) { m.tiltT = -1; m.tiltAt = m.t + 8 + m.rnd() * 10; }
      }
    }
    return out;
  }

  /* ================= 动作库 ================= */
  // 每个动作：make(t, cat, micro) → pose。t 为动作局部时间（秒）
  const ease = (k) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

  const ACTIONS = {
    idle: {
      label: '站立呼吸', loop: true,
      make(t, cat, mi) {
        return {
          form: 'stand', breath: Math.sin(t * 2 * Math.PI / 3.2) * 0.035,
          tailWave: 0.5, tailPhase: t * 1.8,
          eyeOpen: mi.eyeOpen, earFlickL: mi.earFlickL, earFlickR: mi.earFlickR, tilt: mi.tilt,
        };
      },
    },
    walk: {
      label: '走路', loop: true, travel: 22, // px/s，由页面驱动位移
      make(t, cat, mi) {
        const hz = 2.2 + cat.personality.active * 0.8;
        const p = t * hz * Math.PI * 2;
        const lo = (ph) => Math.round(2.2 * Math.sin(p + ph));
        const lf = (ph) => Math.max(0, Math.sin(p + ph + Math.PI / 2)) * 1.8;
        return {
          form: 'stand',
          dy: Math.round(Math.abs(Math.sin(p)) * -1),
          breath: 0,
          legOx: [lo(0), lo(Math.PI), lo(Math.PI * 1.35), lo(Math.PI * 0.35)],
          legLift: [lf(0), lf(Math.PI), lf(Math.PI * 1.35), lf(Math.PI * 0.35)],
          tailAng: 0.55, tailCurl: 1.1, tailWave: 0.7, tailPhase: t * 3,
          headDY: Math.round(Math.sin(p * 2) * 0.6),
          eyeOpen: mi.eyeOpen,
        };
      },
    },
    sit: {
      label: '坐下', loop: true,
      make(t, cat, mi) {
        return {
          form: 'sit', breath: Math.sin(t * 2 * Math.PI / 3.4) * 0.03,
          tailWave: 0.8, tailPhase: t * 2.2,
          eyeOpen: mi.eyeOpen, earFlickL: mi.earFlickL, earFlickR: mi.earFlickR, tilt: mi.tilt,
        };
      },
    },
    lie: {
      label: '趴下（面包）', loop: true,
      make(t, cat, mi, opts) {
        return {
          form: 'lie', breath: Math.sin(t * 2 * Math.PI / 3.8) * 0.05,
          tailWave: opts && opts.tailSweep ? 1.4 : 0.3, tailPhase: t * (opts && opts.tailSweep ? 2.6 : 1.2),
          eyeOpen: Math.min(mi.eyeOpen, 0.85), earFlickL: mi.earFlickL, earFlickR: mi.earFlickR,
        };
      },
    },
    sleep: {
      label: '睡觉', loop: true,
      make(t) {
        return {
          form: 'curl', breath: Math.sin(t * 2 * Math.PI / 4.6) * 0.06,
          eyeOpen: 0, zzz: t,
        };
      },
    },
    groom: {
      label: '舔毛', loop: true,
      make(t, cat, mi) {
        // 舔的节奏：头明显地上下点，低头时舌头碰到抬起的前爪
        const cyc = Math.sin(t * 7);
        const nod = Math.max(0, cyc);
        return {
          form: 'sit', breath: 0,
          headDX: 0.5, headDY: 2 + nod * 3.5, tilt: -1,
          muzzleDY: nod * 1.2,
          tongue: cyc > 0.25, eyeOpen: 0.25,
          pawLift: 5 + Math.round(nod * 1.5),
          tailWave: 0.4, tailPhase: t * 1.5,
        };
      },
    },
    eat: {
      label: '吃饭', loop: true,
      make(t, cat, mi) {
        const bob = Math.sin(t * 7);
        return {
          form: 'stand', bowl: 34 + (cat.bodyRW + 8),
          headDX: 2, headDY: 7 + Math.round(bob * 1.2), muzzleDY: 0.5,
          mouth: bob > 0.4 ? 0.3 : 0, eyeOpen: 0.5,
          tailAng: 0.5, tailCurl: 1, tailWave: 0.25, tailPhase: t,
          breath: 0,
        };
      },
    },
    yawn: {
      label: '打哈欠', loop: true, period: 3.4,
      make(t, cat, mi) {
        const k = (t % 3.4) / 3.4;
        let m = 0;
        if (k < 0.2) m = ease(k / 0.2);
        else if (k < 0.55) m = 1;
        else if (k < 0.75) m = 1 - ease((k - 0.55) / 0.2);
        return {
          form: 'sit', breath: 0,
          mouth: m, eyeOpen: m > 0.4 ? 0 : mi.eyeOpen,
          headDY: -Math.round(m * 2), muzzleDY: m * 1.5,
          tailWave: 0.3, tailPhase: t,
        };
      },
    },
    stretch: {
      label: '伸懒腰', loop: true, period: 3.8,
      make(t, cat, mi) {
        const k = (t % 3.8) / 3.8;
        let s = 0;
        if (k < 0.25) s = ease(k / 0.25);
        else if (k < 0.7) s = 1 + Math.sin(t * 18) * 0.015; // 微微颤
        else if (k < 0.9) s = 1 - ease((k - 0.7) / 0.2);
        s = clamp(s, 0, 1.05);
        return {
          form: 'stand',
          stretchX: 1 + s * 0.28, squashY: 1 - s * 0.18,
          dy: Math.round(s * 2.5), headDY: Math.round(s * 5), headDX: s * 2,
          legScale: 1 - s * 0.25,
          tailAng: 1.15, tailCurl: 2 - s, tailWave: 0.2, tailPhase: t,
          eyeOpen: s > 0.5 ? 0 : mi.eyeOpen, mouth: s > 0.8 ? 0.35 : 0,
        };
      },
    },
    pounce: {
      label: '扑跳', loop: true, period: 4.2,
      make(t, cat, mi) {
        const T = t % 4.2;
        const base = { form: 'stand', eyeOpen: 1, tailWave: 1.2, tailPhase: t * 4, tailAng: 0.4, tailCurl: 0.8 };
        if (T < 1.3) {              // 蓄力：压低 + 屁股扭
          const wig = Math.sin(T * 14) * (T > 0.4 ? 1 : 0);
          return Object.assign(base, {
            squashY: 0.82, dy: 2, legScale: 0.6,
            dx: Math.round(wig * 0.8) * 0 - 6, headDY: 2,
            tailAng: 1.3 + wig * 0.12, pupilDX: 1,
          });
        } else if (T < 1.85) {      // 腾空：抛物线 + 拉伸 + 四脚离地
          const k = (T - 1.3) / 0.55;
          const arc = 4 * k * (1 - k);
          return Object.assign(base, {
            stretchX: 1.22, squashY: 0.85,
            dx: Math.round(-6 + k * 16), dy: Math.round(-arc * 9) + 2,
            airborne: arc * 9 - 1,
            legScale: 0.5, legOx: [4, 3, -3, -4],
            headDY: -1, eyeOpen: 1, pupilDX: 1,
          });
        } else if (T < 2.15) {      // 落地压缩 + 尘土
          const k = (T - 1.85) / 0.3;
          return Object.assign(base, {
            squashY: 0.72 + k * 0.2, stretchX: 1.08, dx: 10, dy: 1,
            legScale: 0.7, dust: k,
          });
        } else if (T < 3.4) {       // 得意坐下看一眼
          return { form: 'sit', dx: 10, breath: 0.02, eyeOpen: mi.eyeOpen, tailWave: 1.3, tailPhase: t * 3.5 };
        } else {                    // 淡出走回
          const k = (T - 3.4) / 0.8;
          return Object.assign(base, { dx: Math.round(10 - 16 * k), eyeOpen: mi.eyeOpen });
        }
      },
    },
  };

  return { W, H, GROUND, BREEDS, BREED_KEYS, PALETTES, makeCat, createRenderer, makeMicro, stepMicro, ACTIONS, mulberry32 };
})();
