# 分层部件资产的免费生成管线调研

调研日期：2026-07-31
对应 ticket：[#23](https://github.com/weizhesafeheron/cyber-cat/issues/23)
背景：路线 B - 用 N 套高细像素分层部件（身体/头/耳/眼睑/尾巴独立图层）替换当前 72×56 程序化渲染，运行时做骨骼式驱动 + 换色/花纹叠加。

## 结论摘要

**路线 B 的全链路可以完全免费跑通，且每个环节都能被 AI agent 脚本化。**

- 生成端：本地 SDXL + 免费像素 LoRA（`nerijs/pixel-art-xl`）可用，但产出是「整图」，部件化要靠切分 + 手修。质量最好的 Retro Diffusion 是收费服务，只有注册赠点，不能当管线。
- 手修端：**Pixelorama 是明确赢家**。MIT 协议，功能不输 LibreSprite，关键是有 headless CLI 且原生支持 `--split-layers` 分层导出，agent 可以无 GUI 批量出图。
- 换色：规范 ID 调色板 + 色带（ramp）整条映射，是像素画换色的标准做法。描边色独立成带、不参与映射，光影自然保住。本项目是 canvas 2D，CPU 逐像素查表就够，不需要 shader。
- 花纹：mask 只允许落在填充色带的像素上，落点替换为花纹色带中**同亮度档位**的颜色。花纹只换 ramp、不改 shading 档位，这就是描边和光影不被破坏的原理。
- 先例：无付费运行时的「部件分层 + 代码驱动」有成熟方法论（Godot cutout 文档、Stardew farmer 分层渲染、Mana Seed 纸娃娃系统）。DragonBones 运行时虽是 MIT 但项目已停摆，不建议引入其格式，自研 JSON 部件描述更贴合 agent 操作。
- 最大风险不是工具，是**部件间风格一致性**和**朝向 × 部件的组合爆炸**。前者靠「同一张全身图切分 + 强制量化到项目调色板」压制，后者靠「朝向压到 2-3 个 + 个性化全部走换色」压制。

---

## 一、生成与手修工具链

### 1.1 AI 生成像素部件：能免费，但别指望直接出部件

本地 Stable Diffusion + 像素 LoRA 是唯一真正零成本的生成路线：

- [`nerijs/pixel-art-xl`](https://huggingface.co/nerijs/pixel-art-xl)：SDXL 上口碑最好的开源像素 LoRA，无需 trigger word，prompt 里带 "pixel" 即可。配合 LCM LoRA 可以 8 步出图。
- [`artificialguybr` 的 PixelArtRedmond 系列](https://huggingface.co/artificialguybr/pixelartredmond-1-5v-pixel-art-loras-for-sd-1-5)：SD 1.5 版本，显存要求更低。
- [`Limbicnation/pixel-art-lora`](https://huggingface.co/Limbicnation/pixel-art-lora)：FLUX 系的新选项，宣称面向带透明背景的游戏资产。

实际工作流参考 [Ula 的像素生成实录](https://urszula.dev/posts/pixel-art-generation/)：生成 1024×1024 → 降采样 → **量化到固定调色板**。
最后一步不可省。
AI 输出带抗锯齿的伪像素，不量化就没法做后面的索引换色。

两个必须接受的现实：

1. **模型输出的是整图，不是部件。**「生成一只完整侧面猫 → 在编辑器里切成部件」比「按部件分别生成」靠谱得多，后者部件间光源和描边几乎必然不一致（详见第四节风险 1）。
2. **质量天花板 Retro Diffusion 不免费。**[官方服务](https://retrodiffusion.ai/) 注册赠 20-50 credit，[Aseprite 插件 $65、LITE 版 $20](https://astropulse.itch.io/retrodiffusion/purchase)，credit 按张消耗。赠点可以用来生成一次性的风格参考种子图，但不能进常驻管线。

### 1.2 免费编辑器：Pixelorama 胜出，且是决定性的

| | LibreSprite | Pixelorama |
|---|---|---|
| 出身 | Aseprite 2016 年 GPL 时代的社区 fork | 独立项目，Godot 实现，MIT |
| 活跃度 | 低，功能停在老版本 | 活跃，v1.0+ 持续更新 |
| 图层/动画 | 有，基础 | 有，另有非破坏图层效果（描边/渐变映射/裁剪蒙版） |
| 导入 | Aseprite 老格式 | 可导入 Aseprite / Photoshop / Krita 动画 |
| **CLI / headless** | 无 | **有：`--headless` + `--export --split-layers`** |

Pixelorama 的 [CLI 文档](https://pixelorama.org/user_manual/cli/) 明确支持：

```
Pixelorama --headless --quit -- --export --split-layers --output out.png project.pxo
```

对本项目这是决定性的：agent 修改 `.pxo` 工程后可以无 GUI 批量导出每个部件图层，接进构建脚本。
LibreSprite 没有对等能力（[对比来源](https://www.saashub.com/compare-pixelorama-vs-libresprite)、[Pixelorama 官网](https://pixelorama.org/)）。

补充一条备选：Aseprite 的 [EULA 允许自行编译源码作个人用途](https://github.com/aseprite/aseprite/blob/main/EULA.txt)（第 2g 条），且 Aseprite 本身有很强的 CLI。
但「个人用途」边界对一个可能分发的应用来说存在解释风险，不值得为此引入法律不确定性。
**结论：主编辑器定 Pixelorama。**

---

## 二、换色与花纹

### 2.1 换色的标准做法：ID 调色板 + 色带映射

像素画换色的通行方案（[pvigier 的 shader palette swap 文章](https://pvigier.github.io/2019/10/06/palette-swapping-with-shaders.html)、[Yanrishatum 的 LUT 换色笔记](https://gist.github.com/Yanrishatum/86794e9e663a7e343f9ef66e8b0f38ae)）：

1. 资产用**规范 ID 调色板**绘制：每个语义区域一条色带（ramp），比如「身体填充」一条 4 色带（暗→亮）、「描边」独立 1-2 色、「眼睛」一条带。
2. 运行时把 ID 色查表替换成目标色。每个「品种/个性」就是一张小小的映射表。

实现层面有 shader LUT（Yanrishatum 用 4096×4096 纹理装下全 RGB 空间）和 CPU 逐像素两条路。
本项目是 canvas 2D 渲染、部件图不过几百 × 几百像素，**CPU 上 `ImageData` 逐像素查 `Map<packedRGB, packedRGB>` 就够了**，换色结果缓存成离屏 canvas，每个品种只算一次。
不需要引入 WebGL。

关键纪律：**整条色带一起映射**。
暗色映射到目标带的暗色、亮色映射到亮色，光影层次（shading 档位）原样保留。
描边色带单独处理 - 或者完全不映射（黑描边通用），或者映射到目标色的更暗一档（sel-out 风格）。
这是描边和光影「不被换坏」的全部秘密，没有更多魔法。

Stardew Valley 的农夫渲染就是这套的量产验证：[官方 wiki](https://stardewvalleywiki.com/Modding:Farmer_sprite) 记载游戏「用颜色识别 skin/eyes/boots/pants/袖子，再按创角选项重新着色」- 即 ID 色约定 + 运行时替换。

### 2.2 花纹叠加：mask 限定 + 同档位替换

花纹（虎斑/奶牛斑/玳瑁）不能简单 alpha 叠一张贴图上去，那会糊掉描边和光影。
正确做法：

1. 花纹是一张与部件同尺寸的**二值 mask**（或平铺 pattern 按部件 UV 采样）。
2. 逐像素判定：当前像素属于「身体填充色带」且 mask 命中 → 替换为**花纹色带中相同亮度档位**的颜色。
3. 描边色、眼睛色不在允许集合里，天然免疫，一个分支都不用加。

本质是「花纹 = 第二条填充色带 + 一张选区」。
shading 档位由原像素在色带中的位置决定，花纹只换 ramp 不换档位，所以体积感不变。
这与 Yanrishatum 笔记评论区的「用通道当 mask 控制哪里换色/哪里不换」是同一思想的简化版，在 CPU 管线里实现更直白。

两条工程注意：

- AI 生成 → 量化这步必须把颜色数收敛到 ID 调色板，任何游离色都会逃过映射，产出「换不到色的杂点」。构建脚本里加一个「非法色检查」即可让 agent 自动兜底。
- mask 与部件绑定存储（同名 `_mask.png` 图层），Pixelorama 的 `--split-layers` 正好能一次导出。

---

## 三、分层部件 + 程序驱动的开源先例

### 3.1 方法论：Godot cutout 文档是最好的免费教材

[Godot cutout animation 教程](https://docs.godotengine.org/en/3.1/tutorials/animation/cutout_animation.html) 虽然讲的是 Godot 节点，但方法论与引擎无关，可直接移植到自研 canvas 驱动：

- 部件按父子层级组织（hip 为根），子部件的位移/旋转在父坐标系里表达。
- **pivot 必须放在关节上**，旋转才不穿帮。
- z-order 独立于层级控制（Godot 用 `Behind Parent` / `RemoteTransform2D`；我们自研就是一个显式的 `zIndex` 字段）。

接缝处理是文档没写透但社区共识明确的部分：**关节画成圆头 + 重叠冗余**。
上臂下端画成半圆、前臂上端也画成半圆，pivot 放圆心，任意角度旋转两个圆头始终重叠，接缝被上层部件盖住。
代价是每个部件要多画几排「会被盖住」的像素。

**局部静止就是分层的原生能力**：部件树里只驱动尾巴节点，身体子树一个字节都不动。
这正是路线 B 相对整帧动画的核心收益 - 当前程序化渲染里「呼吸时耳朵抖动」这类耦合问题直接消失。

### 3.2 量产验证：Stardew 与 Mana Seed

- **Stardew Valley farmer**（[wiki](https://stardewvalleywiki.com/Modding:Farmer_sprite)）：头/躯干/靴子为底层，裤子、衬衫、发型、帽子逐层叠加，配 ID 色换色。「帽子提供全宽列覆盖头部」- 上层部件完全遮盖下层，就是它的接缝策略：**不解决接缝，用覆盖消灭接缝**。对猫的耳朵/眼睑这种「叠在头上」的部件，这比圆头关节更省事。
- **Mana Seed Farmer Sprite System**（[Seliel the Shaper，免费 base](https://seliel-the-shaper.itch.io/farmer-base)）：商业级像素纸娃娃系统，所有图层用**完全相同的网格布局**，运行时按帧号直接叠加，无需逐部件对位。这个「所有图层同布局」约定值得照抄 - 部件图都画在同一张 72n×56n 画布的原位上，运行时叠加零对位成本，位移/旋转只作用于需要动的部件。
- Unity 侧有现成的 [paper doll 分层实现](https://willyxz.itch.io/paper-doll-for-farmer-base) 可参考数据结构。

### 3.3 桌宠先例与 DragonBones 的结论

- [OpenAnima](https://github.com/Ertugrulmutlu/OpenAnima)：Windows 桌面 overlay 引擎，layered image assets + 运行时参数驱动，思路同路线 B，但 Windows-only，只能参考不能复用。
- [OpenPets](https://github.com/alvinunreal/openpets)：本地优先桌宠平台，带 MCP 集成（agent 触发动画），证明「agent 驱动桌宠动画」这条路有人走通。
- Shimeji 系桌宠是整帧序列不分层，不构成路线 B 先例。
- **DragonBones**：编辑器闭源且项目[基本停摆](https://github.com/DragonBones/DragonBonesCPP)，仅运行时 MIT。引入它的格式意味着绑定一个死项目的编辑器。我们的部件树深度只有 2-3 层、动画是程序生成不是关键帧曲线，**自研一个 100 行的 JSON 部件描述（部件 → 图片、pivot、父节点、zIndex）远优于引入任何骨骼动画运行时**。

---

## 四、风险清单

### 风险 1：部件间风格一致性（最高优先级）

AI 分别生成的部件，光源方向、描边粗细、色带数几乎必然不一致。
控制手段，按有效性排序：

1. **同一张全身图切分**，不要按部件分别生成。一张图内一致性天然成立。
2. **强制量化到项目 ID 调色板**，色带数、描边色从源头统一，构建脚本校验非法色。
3. 新增部件用 img2img，以既有部件拼图为参考图。
4. 最后一致性由手修兜底 - Pixelorama 的 agent 可脚本化让这步成本可控。

### 风险 2：接缝

- 旋转关节（尾巴根、头颈）：圆头 + 重叠冗余（见 3.1）。
- 覆盖型部件（耳、眼睑）：Stardew 式完全覆盖，不留接缝存在的机会。
- 像素风格下**连续旋转会破坏像素网格**。两个缓解：优先用位移/交换/翻转，旋转只给尾巴这类细长部件；或部件按 2-4x 分辨率制作，高分辨率旋转后最近邻落回目标网格，关键角度手修。

### 风险 3：朝向 × 部件的组合爆炸

部件库规模 = 朝向数 × 部件数 × 形状变体数，三个因子只要都超过 3 就失控。
控制手段：

1. **朝向压到 2-3 个**：侧面（左右镜像算一个）+ 正面，最多加一个背面。桌宠不是 RPG，不需要 8 方向。
2. **个性化零新增部件**：品种/花色全部走换色 + 花纹 mask（第二节），一套部件服务所有个体。
3. 形状变体只开在辨识度最高的少数部件（耳型、尾型各 2-3 种），身体/头共用。
4. 转身用「交换朝向部件集 + 中间帧压扁过渡」，不做逐角度插值 - Stardew 和几乎所有像素游戏都这么干。

按此约束估算：2 朝向 × 6 部件 × 平均 1.5 变体 ≈ **18 张部件图**起步，完全在手修可承受范围内。

### 风险 4：许可

- SDXL 及主流像素 LoRA 为 CreativeML OpenRAIL 系许可，生成物可商用，但每个 LoRA 的许可需单独确认（HF 页面标注）。
- Mana Seed 免费 base 有自己的使用条款，若只参考结构不复用图片则无关。
- Aseprite 自编译的「个人用途」条款不碰为妙（见 1.2）。

---

## 附：建议的管线形态

```
[本地 SDXL + pixel-art-xl LoRA] 生成全身参考图
        ↓ 降采样 + 量化到项目 ID 调色板（脚本，agent 可跑）
[Pixelorama] 切分部件 / 手修 / 花纹 mask 图层
        ↓ --headless --export --split-layers（脚本，agent 可跑）
构建产物：部件 PNG × N + parts.json（pivot/父子/zIndex）
        ↓
运行时：canvas 叠加 + 位移/旋转/交换驱动 + CPU 色带映射（缓存离屏 canvas）
```

每一步都免费，每一步都有 CLI 入口。
