# CYBER-CAT

赛博城市里，有一只真实的猫在等你回家。

一只常驻在你桌面上的像素猫。它 24 小时都在生活，会饿、会困、会生病、会死。
你不在的时候它也在过日子，回来时它会把这段时间的事记成日记给你看。

支持 macOS 与 Windows。

## 当前状态

**开发中。** 猫已经在桌面上生活了：会自己走动、吃饭、睡觉、生病、死亡，关机期间的时段会在下次启动时补算回来。

已完成的票（GitHub issues）：

| # | 内容 |
|---|---|
| 01 | Spike：验证 macOS 宠物窗口的点击穿透行为 |
| 02 | 预重构：渲染核心模块化并输出 alpha 掩膜 |
| 03 | 骨架：桌面上出现一只会呼吸的猫 |
| 04 | 选择性点击穿透：猫身上可点，其余穿透 |
| 05 | 世界内核：状态演化 + 存档 + 离线推演 |
| 06 | 自主行为与完整动作库（含爪印） |
| 07 | 领养与身份：七品种 + Seed + 起名 |
| 08 | 食盆与猫窝挂件 + 喂食 |

接下来是抚摸与拖拽、光标即逗猫棒、猫爬到前台窗口上、猫咪日记、托盘完整化，以及 Windows 打包与真机验收。

```bash
npm install
npm run app:dev     # 起开发版（Tauri）
npm test            # 全套测试
npm run harness     # 渲染核心的人工验证页，每个品种 × 每个动作
```

## 文档

| 文档 | 作用 |
|---|---|
| [CONTEXT.md](CONTEXT.md) | 领域词汇表。只记术语与边界，不记实现。有歧义时以此为准。 |
| [docs/mvp-scope.md](docs/mvp-scope.md) | MVP 范围。做什么、做到什么程度、明确不做什么。开发依据。 |
| [docs/art-and-motion-decisions.md](docs/art-and-motion-decisions.md) | 美术与动画的既定结论，每条都附被否决的前任方案。改渲染代码前必读。 |
| [docs/adr/](docs/adr/) | 架构决策记录。为什么这么选、放弃了什么、代价是什么。 |
| [docs/research/](docs/research/) | 技术调研与实测证据。每条结论都带一手来源。 |

### 决策速览

- [0001](docs/adr/0001-offline-catchup-simulation.md) 离线推演而非服务器持续模拟
- [0002](docs/adr/0002-procedural-pixel-cats.md) 纯程序化像素猫，渲染与动画均不用精灵图
- [0003](docs/adr/0003-desktop-pet-tauri.md) 桌面宠物形态，Tauri v2 双平台
- [0004](docs/adr/0004-desktop-as-territory.md) 废弃虚拟场景，真实桌面就是猫的领地
- [0005](docs/adr/0005-window-geometry-without-permission.md) 用 CGWindowList 读窗口几何，不迁移到 ScreenCaptureKit
- [0006](docs/adr/0006-alpha-mask-hit-testing.md) 用 alpha 掩膜逐帧命中测试实现选择性点击穿透
- [0007](docs/adr/0007-stage-window-and-motion-layer.md) 舞台窗口跟随猫，逐帧位移独立于世界层
- [0008](docs/adr/0008-behaviour-beat-separate-from-need-tick.md) 行为节拍与需求步长分离，各用一条随机流
- [0009](docs/adr/0009-prop-anchors-across-layers.md) 世界层用挂件名表达空间诉求，抵达判定归运动层
- [0010](docs/adr/0011-return-bubble-in-stage.md) 回归气泡是舞台里的覆盖层，命中区是一个矩形
- [0012](docs/adr/0012-surfaces-and-perching.md) 表面模型：猫可以停在前台窗口上沿，但纵向永远不是自由变量
- [0013](docs/adr/0013-custom-title-bar.md) 三扇弹出窗口自绘标题栏，不用系统的

## 原型

`.lavish/` 下是五个验证用的 HTML 原型，按浏览器打开即可运行，无需构建。

| 文件 | 验证了什么 | 结论 |
|---|---|---|
| `01-cat-generator.html` | 程序化像素猫可不可爱、七品种辨识度 | 通过 |
| `02-motion-lab.html` | 程序化动画的真实感 | 通过 |
| `03-scene-interaction.html` | 场景氛围与邀请式交互手感 | 手感通过，场景已随 ADR 0004 废弃 |
| `04-time-sandbox.html` | 状态数值节奏、死亡链、猫咪日记 | 数值为暂定值 |
| `05-product.html` | 完整产品流程（web 形态） | 已随 ADR 0003 作废，仅存档 |

`.lavish/cat-core.js` 不是原型，**它是会被复用到正式实现的渲染核心** - 品种与 Seed 驱动的逐像素光栅化、姿态系统、动作库、微动作层都在这里。
