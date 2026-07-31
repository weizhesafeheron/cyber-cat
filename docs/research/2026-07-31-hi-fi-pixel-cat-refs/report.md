# 高细像素猫的参考与着色技法调研

调研日期：2026-07-31
对应 ticket：[#22](https://github.com/weizhesafeheron/cyber-cat/issues/22)（map：[#20](https://github.com/weizhesafeheron/cyber-cat/issues/20)）
现状：72×56 程序化像素缓冲（[ADR 0002](../../adr/0002-procedural-pixel-cats.md)），桌面显示高度约 100-150px，`image-rendering: pixelated`。

## 结论摘要

**「塑料感」的主因是着色而不是分辨率。**
业界在 100-150px 显示尺寸上的猫，普遍是 32×32 到 64×64 美术像素放大 2-4 倍显示，靠着色技法而不是像素密度做质感。
我们 72×56 的像素密度其实已经高于 Stardew 这一档参考。

优先做四件事，都能程序化实现：

1. **有方向的体积光影**：固定假想光源（上偏前），每个椭圆部件按曲率分 2-3 阶色带，取代现在的平面填色。
2. **hue shift 的受限调色板**：暗部往冷/紫偏移、亮部往暖偏移，每条 ramp 3-4 阶；纯明度变化正是「塑料/灰泥感」的教科书成因。
3. **选择性描边（selout）**：受光侧的描边换成加亮的本体色，只在背光侧和贴桌面处保留深色描边；现在的均匀深色 outline pass 是「贴纸感」的直接来源。
4. **毛发簇边缘**：轮廓上以 1-2px 的小簇打破光滑椭圆边（破碎轮廓），花纹内部用色块簇而不是逐像素噪声。

慎用/不用：**dithering 在这个尺寸的角色身上基本不适用**（小 sprite + 会动 = 噪点闪烁）；rim light 只该占轮廓受光侧 1px；避开 pillow shading 和 banding 两个经典翻车点。

分辨率建议 **144×112 封顶**。
216×168 在 150px 显示高度下已经跌破 1:1，1x 屏上必须缩小显示，像素画会糊；144×112 在 1x 屏是 1:1、在 Retina 是干净的 2x，两边都整数。
翻倍后多出来的像素应该花在脸部结构、AA 和轮廓曲线上，而不是更多纹理。

程序化生成这类着色有成熟先例（normal map 光照、法线可解析推导），我们的椭圆部件 + `shade(u,v)` 回调架构正好是实现它的雏形，详见第四节。

---

## 一、参考：这个显示尺寸下像素猫是怎么画的

### 1.1 像素游戏里的猫

| 参考 | 美术分辨率 | 显示方式 | 看点 |
|---|---|---|---|
| [Stardew Valley 的猫](https://www.spriters-resource.com/pc_computer/stardewvalley/asset/77888/)（Spriters Resource 可看全帧） | 32×32/帧 | 游戏内 4x 缩放，屏幕上约 128px | 极少的颜色 + 干净色块簇 + 关键帧姿态，几乎不做内部纹理 |
| [Eastward](https://80.lv/articles/eastward-charming-chinese-pixel-art-adventure)（80.lv 访谈，[Game Developer 访谈](https://www.gamedeveloper.com/art/eastward-s-creators-share-insights-on-making-pixel-art-adventures)） | 角色为中等密度像素 | 引擎光照叠加 | 「温暖感」来自像素画 + 现代光照/LUT/模拟 SSAO 的组合，而不是像素级技法；对我们的启示是着色管线可以和像素画分层 |
| [Unpacking 像素艺术家 Angus Doolan 访谈](https://www.muchopixels.com/post/angus-doolan-interview)（[团队像素画集](https://kotaku.com/some-pixel-art-from-the-team-behind-unpacking-1848072044)） | 高密度（hi-bit）物件像素 | 接近 1:1 | Doolan 提到偏好受限色彩空间（RGB 每通道仅 5 阶）；Unpacking 的质感靠克制的调色板而非多色 |

### 1.2 开源/免费桌宠与素材包

- [64x64 FREE Pixel Cats（last-tick, itch.io）](https://last-tick.itch.io/animated-pixel-cats-64x64)：56 组动画、三种毛色，64×64，可免费商用，是最接近我们目标密度的可下载参考。
- [Retro Cats（ToffeeCraft, itch.io）](https://toffeecraft.itch.io/retro-cats)：64×64，动作集全（idle/跑/睡/哭/舞等），可拆帧研究轮廓与色带。
- [itch.io「cats + pixel art」标签页](https://itch.io/game-assets/tag-cats/tag-pixel-art)：批量浏览入口，注意大多数包实际是 32-64px。
- 开源桌宠：[CATAI（macOS dock 像素猫）](https://github.com/wil-pe/CATAI)、[clawd-on-desk（像素桌宠）](https://github.com/rullerzhou-afk/clawd-on-desk)、[Shijima-Qt（跨平台 shimeji 运行器）](https://github.com/pixelomer/Shijima-Qt)、[GitHub desktop-pet topic](https://github.com/topics/desktop-pet)。
  注意 shimeji 系素材本体多为 128px 手绘卡通而非像素画，参考价值在行为而不在着色。

**观察**：没有找到任何在这个显示尺寸上用「高像素密度 + 密集纹理」取胜的猫。
质感好的参考全部是「较低密度 + 干净色块 + 讲究的 2-3 阶光影」。
这支持「先修着色、分辨率只提到 144×112」的路线。

## 二、让像素画「不塑料」的技法清单

每条按「是什么 / 在 144×112、显示 100-150px 下的适用性 / 翻车点」整理。

### 2.1 体积光影（form shading）

固定一个全局光源（惯例是上方偏观察者一侧），按部件的曲面朝向分出亮面/固有色/暗面，2-3 阶足够。
参考：[Pedro Medeiros (saint11) 的 Basic Shading 教程](https://medium.com/pixel-grimoire/how-to-start-making-pixel-art-4-f57f51dcfa02)、[Slynyrd Pixelblog 6: Light and Shadow](https://www.slynyrd.com/blog/2018/6/15/pixelblog-6-light-and-shadow)。

- 适用性：这是塑料感的第一解药，144×112 上每个部件有足够像素画出 2-3 阶色带。
- 翻车点：**pillow shading**，即光源仿佛来自正前方、色阶沿轮廓一圈圈往里包，会让 sprite 更扁更假（[The Logbook Project 对 banding/pillow shading 的拆解](https://the-logbook-project.blogspot.com/2013/04/pixel-art-lessons-jiinchus-darkness.html)）。
  程序化实现时若直接用「离部件中心的距离」当明暗输入，得到的正是 pillow shading，必须用法线点乘光向。

### 2.2 色相偏移（hue shifting）

变暗时不只降明度，同时把色相往冷色（蓝紫）偏、微调饱和度；变亮时往暖色（黄）偏。
参考：[TofuPixel 的 hue shifting 基础](https://tofupixel.tumblr.com/post/758205573119557632/pixel-art-fundamentals-hue-shifting)、[Pixel-Editor 的像素画色彩理论](https://www.pixel-editor.com/articles/color-theory-for-pixel-art)、[Lospec hueshifting 教程合集](https://lospec.com/pixel-art-tutorials/tags/hueshifting)。

- 适用性：任何分辨率都适用，纯明度 ramp 是「muddy/grey/塑料」的教科书成因；同样的颜色数，shift 过的 ramp 观感更透气。
- 翻车点：shift 幅度过大变「彩虹猫」；对毛色语义敏感的品种（如奶牛猫的黑白）要限制 shift 幅度，白毛暗部偏蓝紫是安全的，黑毛亮部偏暖棕比偏黄安全。

### 2.3 受限调色板

每条 ramp 3-4 阶、全猫 ramp 数量个位数，颜色少反而显「有意图」。
参考：[Slynyrd Pixelblog 1: Color Palettes](https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes)、Unpacking 的做法（[Doolan：RGB 每通道 5 阶的受限空间](https://www.muchopixels.com/post/angus-doolan-interview)）。

- 适用性：程序化着色天然容易「每像素一个连续色」，必须显式量化到 ramp，否则会往「缩小的插画」漂移、失去像素画的干净。
- 翻车点：ramp 阶数堆到 5+ 之后出现 **banding**（相邻色阶沿同一轮廓平行排列，像等高线），比色少更难看。

### 2.4 选择性描边（selout / selective outlining）

整圈深色描边锁形，然后把受光侧（通常上/左）的描边替换成加亮的本体色，只在背光侧和接地处留深线。
参考：[PixelJoint selout 专题](http://pixeljoint.com/2007/10/15/2346/Pixel_Art_Challenge-_Selective_Outlining.htm)、[Pixnote 的 selout 指南](https://pixnote.net/en/learn/outlines/)、[yarrninja 教程第 12 章](http://www.yarrninja.com/pixeltutorial/chapter12.htm)。

- 适用性：**当前 outline pass 是均匀深色（`#241b36`），这是「贴纸/塑料玩具」观感的直接来源之一**；selout 是规则化的（描边色 = f(该处法线·光向, 相邻本体色)），非常适合程序化。
- 翻车点：桌面壁纸不可控，浅色壁纸上全 selout 会让受光侧轮廓消失。
  桌宠场景的安全做法：受光侧描边只提亮到「本体暗色」而不是完全去掉描边，保证任意壁纸上剪影完整。

### 2.5 毛发簇边缘（fur clusters / broken outline）

毛不是逐根画，是把轮廓打破成不规则小簇：轮廓上每隔几像素外凸 1-2px 的小三角/小台阶，簇的间距和大小要不均匀。
内部花纹同理，用「色块簇」表达毛流，不用逐像素噪声。
参考：[DodoIcons 的像素毛发教程](https://www.deviantart.com/dodoicons/art/Pixel-fur-shading-tutorial-513887367)、[faustbane 的 Pixel Fur 教程](https://faustbane.deviantart.com/art/Pixel-Fur-tutorial-149272131)、[saint11 的 cluster 画法文章](https://saint11.art/pixel_art_articles/article2/)、[saint11 教程合集](https://saint11.art/blog/pixel-art-tutorials/)（其中有 outlines/shading/四足行走的 GIF 拆解）。

- 适用性：144×112 下轮廓总长翻倍，正好有空间放簇；这是把「光滑橡胶椭圆」变成「毛绒」的关键一步。
  破碎的内轮廓线在人眼里近似 AA，等于免费的边缘柔化（[Pixnote 对 broken line 的解释](https://pixnote.net/en/learn/outlines/)）。
- 翻车点：簇的周期均匀 = 「毛刷/锯齿」；逐像素随机 = 噪声。
  要用确定性 seed 噪声控制簇位置（同一只猫每帧一致，否则轮廓会沸腾）；动画时簇必须跟随部件运动，不能在屏幕空间固定。

### 2.6 抖动（dithering）：这个尺寸基本不用

参考：[Spearite 的 dithering 实用指南](https://spearite.com/blog/pixel-art-dithering-guide)、[「何时用、何时停」](https://spritesheetgenerator.online/blog/dithering-pixel-art-guide)。

- 结论：小 sprite、会动的区域都不该用 dithering，只会读成噪点；动画中 dither 图案还会闪烁。
- 猫身上唯一可考虑的位置：脚下阴影椭圆的边缘用 2×2 stipple 过渡，静止且语义是「模糊阴影」，安全。

### 2.7 轮廓光（rim light）

背光侧轮廓内侧 1px 提亮，把猫从背景里「剥」出来。
参考：[saint11 Basic Shading 中的 rim light 部分](https://medium.com/pixel-grimoire/how-to-start-making-pixel-art-4-f57f51dcfa02)、[2D 游戏里 rim light 与剪影可读性](https://gamineai.com/blog/lighting-2d-action-game-silhouettes-rim-ambient-shader-basics-2026)。

- 适用性：桌宠背景（壁纸）不可控，rim light 用固定假想光而不是采样环境；宽度严格 1px，位置在描边内侧。
- 翻车点：rim 一旦超过 1px 或绕轮廓一整圈，就退化成反向 pillow shading；rim 色要用「加亮 + 偏暖」的本体色，不要用白色。

### 2.8 抗锯齿与 banding

手工 AA（轮廓内侧垫中间色）在 hi-bit 密度下收益明显，曲线更顺。
参考：[Pixel Parmesan 的 AA 基础](https://pixelparmesan.com/blog/anti-aliasing-fundamentals-for-pixel-artists)、GDC [Animation Bootcamp: High Resolution Pixel Art and Animation](https://www.gdcvault.com/play/1025042/Animation-Bootcamp-High-Resolution-Pixel)（[YouTube](https://www.youtube.com/watch?v=Ih65Kg4DTw8)，涵盖 hi-res 像素的 AA、剪影、banding）。

- 适用性：程序化可以做规则化 AA：椭圆光栅化时对边缘像素按覆盖率选 ramp 中间色，只在外轮廓做，成本低。
- 翻车点：AA 像素连成平行于色阶的带 = banding；AA 只放在「台阶拐点」，不要沿整条边铺。

## 三、72×56 提到 2-3 倍的分辨率取舍

### 3.1 尺寸怎么定

- [Pixel Parmesan：选分辨率的两问](https://pixelparmesan.com/blog/choosing-the-right-resolution-for-your-pixel-art)：「最小必要细节是什么」「以目标风格画出它需要几个像素」。
  作者明确警告：分辨率超过风格所需，多出的空间会被填上噪声、pillow shading 和垃圾像素；拿不准就选小。
- [Bugnet：每翻倍一次分辨率，单资产工作量约 x4](https://bugnet.io/blog/choosing-a-pixel-art-resolution-for-your-game)。
  程序化没有逐帧手绘成本，但调参、检查每个姿态每个品种的成本同样按面积涨。
- 整数缩放是底线（[notkey studio](https://notkey.studio/en/tutorials/choosing-the-right-render-resolution-for-a-pixel-art-game)、[pixelartapp 分辨率指南](https://pixelartapp.com/resolutions-guide)）。

对着我们的显示约束算一遍：

| 缓冲 | 显示高 100-150px（CSS px）时的缩放 | 1x 屏 | 2x Retina |
|---|---|---|---|
| 72×56（现状） | 约 1.8-2.7x | 整数 2x 可行 | 4x，像素偏大 |
| **144×112** | 约 0.9-1.34x，**取 1x（显示高 112px）** | 1:1，锐利 | 物理 2x，锐利 |
| 216×168 | 0.6-0.9x，**必须缩小** | 糊，不可行 | 非整数 1.x，糊 |

**结论：144×112 是这个显示尺寸的天花板，216×168 会跌破 1:1，直接排除。**
144×112 意味着显示高度固定在约 112 CSS px（在 100-150 区间内），放弃连续缩放，换来两种屏上都是整数倍的锐利。

### 3.2 翻倍后哪些细节值得加、哪些会变脏

值得加（每一项都有上面某条技法背书）：

- 脸部结构：眼睛从 2-3px 提到 5-6px，能放高光点 + 瞳孔形状；口鼻从「一条线」变成有体积的吻部。
  参考尺寸感受可对照 [64px 猫素材包](https://last-tick.itch.io/animated-pixel-cats-64x64)的脸部处理。
- 耳内三角、爪趾分离（2-3 趾）、尾巴根部与身体的衔接色带。
- 轮廓 AA 与毛簇：72px 宽时轮廓只够锁形，144px 宽才有空间既锁形又破碎。
- 花纹边缘：虎斑/奶牛斑的边界从 1px 硬边变成带 1 阶过渡色的软边。

加了反而脏（各来源的一致意见）：

- 逐像素毛发纹理、整身 dithering：读成噪声（2.6 节来源）。
- 每 ramp 超过 4 阶颜色：banding 与「缩小的插画感」（2.3 节来源）。
- 用多出来的像素画对称、居中、无光源方向的细节：Pixel Parmesan 说的「symbol-based、扁平」陷阱。
- 让簇/纹理在动画帧间不连续：轮廓沸腾，比静态噪声更显眼。

## 四、程序化生成这类着色的可行性

有直接先例，而且我们的架构离它很近。

- **Normal map 驱动的像素光影已是成熟路线**：aarthificial（游戏 Astortion 的作者）有完整 devlog（[像素画动态光照教程](https://www.youtube.com/watch?v=vOXrrEvYUVg)、[Deferred Lights devlog](https://www.youtube.com/watch?v=R6vQ9VmMz2w)）；学术侧有综述 [Analysis and Compilation of Normal Map Generation Techniques for Pixel Art（arXiv 2212.09692）](https://arxiv.org/pdf/2212.09692) 和 SIGGRAPH 2022 的 [DynaPix](https://yaksoy.github.io/dynapix/)。
  这些工作的痛点是「从手绘 sprite 反推法线」；**我们没有这个痛点：部件本来就是解析椭圆，法线可以直接算**。
- **纯生成器的边界**：[Lospec 程序化像素生成器](https://lospec.com/procedural-pixel-art-generator/)、[CryPixels](https://crypixels.com/) 这类工具都「做形不做光」，只适合无着色的小 sprite；[GAN 生成角色 sprite 的论文](https://ar5iv.labs.arxiv.org/html/2208.06413)里 shading 被简化为 6 阶灰度。
  结论：精细着色没有现成生成器，要自己写规则，但规则本身（下条）都是可程序化的。
- **落到现有代码的路径**：`src/render/raster.ts` 的 `shade(u, v, x, y)` 回调和 `src/render/parts.ts` 的 `furShade` 已经是「每像素着色函数」架构。升级为：
  1. 椭圆内每像素由 (u, v) 解析出球面/柱面法线，与固定光向点乘；
  2. 点乘结果**量化**到 ramp 的 2-3 阶（这一步保住像素画质感，跳过它就会变成「缩小的 3D 渲染」）；
  3. ramp 用预先 hue shift 好的查表色（2.2/2.3 节规则）；
  4. outline pass 从「统一涂 `OUTLINE`」改为按邻接本体色 + 光侧判断选色（2.4 节 selout 规则）；
  5. 轮廓簇用以猫 seed 为种子的确定性噪声，在部件局部坐标系里偏移边缘 1px（2.5 节，保证帧间稳定）。

这五步没有一步需要美术资产，全部是渲染代码改造，与 ADR 0002 的「美术迭代 = 调渲染代码」原则一致。

## 附：本次未展开、后续可挖的线索

- GDC [Skill-Building Series: Pixel Art and Animation in the Hi-Bit Age](https://gdcvault.com/play/1026805/Skill-Building-Series-Pixel-Art)：hi-bit 风格的系统性讲座，适合定风格基调时精看。
- [Slynyrd Pixelblog 25: Motion Cycles](https://www.slynyrd.com/blog/2020/1/23/pixelblog-25-motion-cycles)（含四足动物步态）与 [saint11 的 4LegsWalk 拆解](https://saint11.art/blog/pixel-art-tutorials/)：动作升级（另开 ticket）时用。
- [RefresherTowel：像素画映射到 3D 光照](https://refreshertowelgames.wordpress.com/2025/06/10/mapping-pixel-art-for-3d-lighting/)：若未来想让猫对屏幕上的「虚拟光源」（如鼠标位置）起反应，可作起点。
