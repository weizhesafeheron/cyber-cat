import type { MicroOut } from './micro.js';
import { clamp } from './rng.js';
import type { Cat, Pose } from './types.js';

/**
 * 被拎起来时身体抬离地面线多少个精灵像素，以及腿垂下来多长。
 *
 * 抬起量取到「整只猫连尾巴都离地」为止：抬得不够会读成「猫在原地站着被拽」。
 * 垂下的长度是抬起量减去 airborne，两者之差就是腿的可见长度。
 */
/**
 * 吃饭一个完整周期的时长，秒。
 *
 * 埋头约 1.9 秒、抬头嚼约 1 秒，加上两段过渡。
 * 再快就成了啄食，再慢用户会以为动作卡住了。
 */
const EAT_CYCLE_S = 3.6;

const HELD_LIFT = 16;
const HELD_DANGLE = 5;

/** 缓入缓出。 */
const ease = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export interface ActionOpts {
  /** 趴下时尾巴扫地（心情好的表现）。 */
  tailSweep?: boolean;
}

export interface ActionDef {
  label: string;
  /**
   * 循环动作（站立呼吸、走路、趴着）会一直播下去；
   * **一次性动作（打哈欠、伸懒腰、扑跳）播一遍就完**，之后由调用方决定接什么。
   *
   * 这个区分不是装饰。世界层给一个动作分配的时长是十几秒起，而打个哈欠只要
   * 三秒 - 当成循环播的话就是「一只猫连着打十次哈欠」，扑跳更明显：
   * 蓄力、跳、落地、得意地坐、再滑回原点，一轮接一轮。
   */
  loop: boolean;
  /** 走路的位移速度，px/s。由调用方驱动实际位置，动作本身只负责腿的相位。 */
  travel?: number;
  /** 一个完整循环的时长，秒。一次性动作则是它播完所需的时长。 */
  period?: number;
  /**
   * 跳跃类动作的真实位移：局部时间落在 [startS, endS) 之间时，
   * 猫在地面上前进 px 个精灵像素，**由调用方驱动**（与 travel 同一个契约）。
   *
   * 不在姿态里用 dx 做粗位移。精灵缓冲只有 72 像素宽，在里面跳出去就必须再滑
   * 回来，而滑回来的那一段没有腿的动作 - 屏幕上就是一只猫平移着倒退。
   * 桌面宠物有一整个舞台可走，猫跳完就该待在新位置上。
   */
  leap?: { startS: number; endS: number; px: number };
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
  | 'pounce'
  | 'held'
  | 'land';

/**
 * 只由运动层播、**世界层永远不会选**的动作。
 *
 * 「被拎起来」与「落地」是用户的手造成的，不是猫自己想做的事 - 世界层的动作
 * 抽签里不该出现它们（那等于让猫自己决定被拎起来）。运动层在拖拽期间直接播。
 *
 * 显式列出来是因为好几处需要区分：世界层的时长表、「长跑能用到全部动作」那条
 * 测试、以及与 prototype 的逐帧比对（原型里没有这两个动作）。
 */
export const MOTION_ONLY_ACTIONS = ['held', 'land'] as const satisfies readonly ActionKey[];

export type MotionOnlyAction = (typeof MOTION_ONLY_ACTIONS)[number];

/**
 * 世界层可以选的动作。
 *
 * 有这个类型，「世界层永远不会选被拎起来」就成了**编译期**的约束而不是一句注释：
 * 世界层那张时长表（ACTIVITY_HOLD_BEATS）按它取键，漏一个或多一个都编译不过。
 */
export type WorldActionKey = Exclude<ActionKey, MotionOnlyAction>;

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
    period: EAT_CYCLE_S,
    make(t) {
      // 只有低头咀嚼的形体，没有食盆 - 食盆是独立的挂件窗口（ADR 0004、ticket 08），
      // 猫要走到它跟前才会被世界层判定为在吃（见 src/app/motion.ts 的锚点分支）。
      //
      // **动作的可读性来自整体姿态的位移。** 上一版是「头一直低着 + 一两个像素的
      // 抖动」，真机反馈是「吃饭的动作感觉不明显」- 与舔毛踩过的是同一个坑
      // （见 art-and-motion-decisions 的「只靠一两个像素变化的动作等于没有动作」）。
      // 现在是一个三秒半的周期：埋头吃一阵 → 抬起头来嚼 → 再埋下去。
      const k = (t % EAT_CYCLE_S) / EAT_CYCLE_S;
      // 头的高度：0 = 抬起来（接近常态），1 = 埋进盆里。
      let down: number;
      if (k < 0.12) down = ease(k / 0.12);
      else if (k < 0.55) down = 1;
      else if (k < 0.7) down = 1 - ease((k - 0.55) / 0.15);
      else down = 0;

      // 埋头时是小幅快嚼，抬头时是大口慢嚼 - 两段的节奏不同才看得出在换动作。
      const chew = down > 0.5 ? Math.sin(t * 15) : Math.sin(t * 7);
      const jaw = chew > 0.2 ? 0.35 - down * 0.12 : 0;
      return {
        form: 'stand',
        headDX: 1 + down * 1.5,
        // 抬头时略高于常态：那一下「仰起来嚼」是这个动作最容易读到的部分。
        headDY: Math.round(-1.2 + down * 9 + chew * (down > 0.5 ? 0.8 : 1.6)),
        muzzleDY: down * 0.8,
        mouth: jaw,
        // 埋头时眼睛眯着，抬头时睁开环顾。
        eyeOpen: down > 0.5 ? 0.4 : 1,
        tailAng: 0.5,
        tailCurl: 1,
        // 抬头那段尾巴摆得欢一点，进一步区分两个阶段。
        tailWave: 0.25 + (1 - down) * 0.5,
        tailPhase: t,
        breath: 0,
      };
    },
  },

  yawn: {
    label: '打哈欠',
    loop: false,
    period: 3.4,
    make(t, _cat, mi) {
      const k = Math.min(t, 3.4) / 3.4;
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
    loop: false,
    period: 3.8,
    make(t, _cat, mi) {
      const k = Math.min(t, 3.8) / 3.8;
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
    loop: false,
    // 蓄力 1.3 + 腾空 0.55 + 落地 0.3 + 得意地坐 1.25。
    period: 3.4,
    // 腾空那 0.55 秒里猫在地面上真的前进 16 个精灵像素。
    leap: { startS: 1.3, endS: 1.85, px: 16 },
    make(t, _cat, mi) {
      // 停在最后一帧而不是回到蓄力 - 一次性动作没有下一轮。
      const T = Math.min(t, 3.4);
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
          dy: 1,
          legScale: 0.7,
          dust: k,
        };
      }
      // 落地之后得意地坐下环顾。**没有「走回原位」那一段** -
      // 猫跳到哪儿就待在哪儿，位移是运动层记在真实位置上的（见 leap）。
      return {
        form: 'sit',
        breath: 0.02,
        eyeOpen: mi.eyeOpen,
        tailWave: 1.3,
        tailPhase: t * 3.5,
      };
    },
  },

  held: {
    label: '被拎起来',
    loop: true,
    make(t, _cat, mi) {
      // 悬空的猫**四条腿是松垂的**，不是绷直踩地。
      // `dy` 把身体抬离地面，`airborne` 必须跟着抬腿 - 少了它腿会被拉长贴回地面线，
      // 看起来像身体在原地伸缩（这正是扑跳踩过的坑，见 art-and-motion-decisions）。
      // 两者之差就是腿垂下来的可见长度。
      const swing = Math.sin(t * 2.1);
      const sway = Math.sin(t * 1.5);
      return {
        form: 'stand',
        dy: -HELD_LIFT,
        airborne: HELD_LIFT - HELD_DANGLE,
        legOx: [swing * 1.2, swing * 0.8, -swing * 1.1, -swing * 0.7],
        legScale: 0.78,
        squashY: 1.05,
        stretchX: 0.97,
        headDY: 2.2 + sway * 0.7,
        // **尾巴必须垂下去。** drawTail 里 `y -= sin(ang)`，所以正角度是往上翘 -
        // 第一版给了 2.3 rad，尾巴甩到头顶又被身体挡住，画面上直接没有尾巴。
        // 负角度才是垂。曲率给小一点，垂下来的尾巴是松松一条，不打卷。
        tailAng: -1.15,
        tailCurl: 0.45,
        tailWave: 0.5,
        tailPhase: t * 1.1,
        eyeOpen: mi.eyeOpen,
        earFlickL: mi.earFlickL,
        earFlickR: mi.earFlickR,
      };
    },
  },

  land: {
    label: '落地',
    loop: false,
    period: 0.45,
    make(t) {
      const k = clamp(t / 0.45, 0, 1);
      const squash = Math.sin(Math.PI * k);
      return {
        form: 'stand',
        squashY: 1 - squash * 0.24,
        stretchX: 1 + squash * 0.14,
        legScale: 1 - squash * 0.32,
        dust: 1 - k,
        headDY: squash * 2.2,
        tailAng: 1.25,
        tailCurl: 1.4,
        tailWave: 0.2,
        tailPhase: t,
        eyeOpen: 1,
      };
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
  'held',
  'land',
];
