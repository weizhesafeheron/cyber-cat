# macOS 宠物窗口点击穿透实测报告

实测日期：2026-07-29
环境：macOS 15.5 (24F74)，Xcode 16 SDK，Apple Silicon
对应 ticket：[#2](https://github.com/weizhesafeheron/cyber-cat/issues/2)

## 结论摘要

**ADR 0006 的假设成立：macOS 与 Windows 一样，透明像素不会自动穿透，`ignoresMouseEvents` 是整窗一刀切。alpha 掩膜逐帧命中测试的方案继续有效。**

但根因和原先记录的不同，这一点很重要：

**macOS 的窗口层其实原生支持逐像素 alpha 命中测试** - 一个透明的 `NSWindow`，其完全透明的像素上的点击会自然穿透到下层窗口。这是实测确认的（见 1.2 的 V1 与 V3）。

**破坏这个原生行为的是 WKWebView，不是窗口。** WKWebView 无条件截获整个窗口区域，无论它渲染出来的 CSS 像素是否透明。试过四种透明配置组合，无一例外。

由于 Tauri 在 macOS 上经 wry 使用 WKWebView，我们实际拿到的就是「整窗截获」的行为，与 Windows 一致。

额外发现一条影响实现的细节：**`ignoresMouseEvents` 的赋值不是同步生效的** - 同一个 run loop 轮次内查询仍是旧值，约 5ms 内生效。这限制了动态开关能贴多紧，见第 3 节。

---

## 一、实测过程

### 1.0 判定工具的选择与一次纠错

第一次尝试用 `NSWindow.windowNumber(at:belowWindowWithWindowNumber:)` 直接查询，得到「所有点都命中宠物窗口」，包括设了 `ignoresMouseEvents = true` 之后 - 这明显不对。

第二次尝试用 `CGEvent` 合成真实点击 + 双向记录（WKWebView 里的 JS 记 `mousedown`，下层窗口用自定义 `NSView` 记 `mouseDown`）。结果**连对照点（不透明方块中心）都没人收到**，说明工具失效。原因几乎确定是 `CGEvent.post` 在现代 macOS 上需要辅助功能授权，本进程未授权，合成事件被静默丢弃。

第三次做了工具本身的诊断，发现：

- 在**创建时**就设 `ignoresMouseEvents = true` 的窗口，`windowNumber(at:)` 会跳过它、返回下层窗口。
- 因此 `windowNumber(at:)` **确实反映事件路由**，不只是几何可见性。
- 第一次尝试失败的真正原因是「赋值后立刻查询」，窗口服务器还没生效。

所以最终采用 `windowNumber(at:)` 作为判定工具，并在每次改动 `ignoresMouseEvents` 后留出延迟再查询。

这次纠错本身产出了第 3 节那条传播延迟的发现。

**每组测试都带对照点**：若对照点（不透明像素）的结果不符合预期，则整组数据判为工具失效、不予采用。

### 1.1 `ignoresMouseEvents` 的粒度

| 窗口 | 配置 | 窗口正中的命中结果 |
|---|---|---|
| 不透明窗口 | `ignoresMouseEvents = true`（创建时设定） | **下层窗口** |

整窗一刀切，与 Windows 的 `WS_EX_TRANSPARENT` 行为一致。
没有区域粒度的选项。

### 1.2 透明像素是否自动穿透：分三种内容对比

三个窗口配置完全相同（`isOpaque = false`、`backgroundColor = .clear`、无边框、置顶、`ignoresMouseEvents = false`），只有 contentView 不同。

| 内容 | 透明像素处 | 不透明像素处 | 判读 |
|---|---|---|---|
| **V1** 空 contentView（整窗皆透明） | **穿透** | - | 窗口层支持 alpha 穿透 |
| **V3** 自绘 `NSView`（左半不透明、右半不画） | **穿透**（右半） | 被窗口截获（左半） | **逐像素 alpha 命中，原生就有** |
| **V2** 背景透明的 `WKWebView`（左半 CSS 透明、右半绿块） | 被窗口截获 | 被窗口截获 | **WKWebView 破坏了它** |

V3 是最关键的一组：同一个视图内制造 alpha 差异，不涉及 WebView，结果是**不透明的一半命中窗口、透明的一半穿透**。
这证明 macOS 的窗口服务器本来就按渲染出的 alpha 做命中测试。

V2 与 V3 的唯一差别是 contentView 换成了 WKWebView，结果从「逐像素」退化成「整窗截获」。

### 1.3 尝试恢复 WKWebView 的透明命中：四种配置均失败

四个窗口，同一份 HTML（左半 CSS 透明、右半绿色不透明方块），逐一叠加透明相关配置：

| 配置 | 左半（CSS 透明像素） | 右半（绿色方块） |
|---|---|---|
| A 仅 `setValue(false, forKey: "drawsBackground")` | 被截获 | 被截获 |
| B A + `layer.isOpaque = false` | 被截获 | 被截获 |
| C A + `underPageBackgroundColor = .clear` | 被截获 | 被截获 |
| D 三者全开 | 被截获 | 被截获 |

**没有任何一种配置能让 CSS 透明区域穿透。**
WKWebView 对窗口服务器而言始终是一块不透明的矩形，与它渲染的内容无关。

其中 A 就是 wry 在 `transparent: true` 时采用的做法，因此 Tauri 的实际行为对应表中的 A 行。

### 1.4 `ignoresMouseEvents` 的传播延迟

一个不透明置顶窗口，测量赋值到窗口服务器生效之间的间隔：

```
赋值前            → 命中该窗口
赋值后立即查询     → 命中该窗口   ← 同一 run loop 轮次内仍是旧值
赋值后 5ms        → 穿透到下层
赋值后 20ms       → 穿透到下层
赋值后 50ms       → 穿透到下层
赋值后 150ms      → 穿透到下层
```

**赋值不是同步生效的**，但延迟很小（0 到 5ms 之间，未进一步细分）。

---

## 二、对 ADR 0006 的影响

结论是**确认**而非修订：alpha 掩膜逐帧命中测试 + 动态开关整窗穿透，在 macOS 上仍是必需且可行的方案。
「点猫抚摸」与「拖拽猫」不需要重新设计入口。

但要修正 ADR 0006 里对 macOS 的机制描述。原文写的是：

> macOS 侧机制相同（`NSWindow.ignoresMouseEvents` 同样是整窗属性，透明视图仍占据其 frame 并接收点击）

前半句正确，后半句的归因是错的 - 透明视图**不会**占据 frame 接收点击（V1、V3 已证明），真正的原因是 WKWebView 这个特定的视图会。

这个区别有实际价值：**如果将来把猫的渲染从 webview 移到原生 AppKit 图层（macOS）或等价方案，就能免费拿到逐像素穿透，不再需要动态开关。** 这是一条真实存在的优化路径，值得记在案上。

---

## 三、对实现的具体约束

**动态开关必须提前于光标抵达，不能在点击那一刻反应式切换。**
赋值有最长约 5ms 的传播延迟。60fps 下一帧 16.7ms，因此单帧内切换是够的 - 但如果在「光标恰好压到掩膜边界」的瞬间才切换，窗口服务器可能仍在用旧状态处理这次点击。

推荐做法：

- 命中测试基于**带外扩边距的掩膜**（hysteresis），光标进入猫的包围盒外扩若干像素时就提前关闭穿透，离开时延迟开启。
- 边距至少覆盖一帧的光标位移。快速移动的鼠标在 16.7ms 内可移动几十像素，因此边距按光标速度动态调整比固定值更稳。
- 不要在 `mouseDown` 事件里现场切换 - 那时已经太晚。

这条与 Windows 侧协作者建议的「生产实现改用原生 `WM_NCHITTEST` 或窗口 region」是同一类问题的两种解法：Windows 有原生的逐次命中回调可用，macOS 没有对应机制（webview 挡住了），只能靠提前切换 + 边距。

---

## 四、仍未验证

- **本报告用 Swift + WKWebView 复现 Tauri 的组合，未在真实 Tauri 应用上验证。** WKWebView 与透明 NSWindow 是 Tauri 经 wry 在 macOS 上的实际渲染栈，结论应可迁移，但 wry 可能有额外的视图层级或配置。ticket 03 骨架落地后应复测本报告的 1.2 与 1.4 两组。
- `CGEvent` 合成点击的路径未走通（缺辅助功能授权），因此本报告全部依赖 `windowNumber(at:)` 这一个判定工具。该工具已通过 1.0 的诊断确认反映事件路由，但没有第二种独立工具交叉验证。
- 传播延迟只测到「0 到 5ms 之间」，未细分。若实现中发现边界误判，值得用更细的采样重测。
- 未测试多显示器、不同 DPI 下的行为。
- 未测试猫窗口自身是 `ignoresMouseEvents = true` 期间，webview 内的 CSS `:hover` 等状态是否仍会更新（影响「猫看向光标」这类不需要点击的反馈）。

---

## 五、复现方式

`spike/macos-hit-test/` 下有三个独立的探针程序，均为单文件 Swift，无依赖：

```
swiftc -O diag.swift  -o diag  && ./diag    # 1.0 工具语义诊断
swiftc -O diag2.swift -o diag2 && ./diag2   # 1.2 三种内容对比 + 1.4 传播延迟
swiftc -O diag3.swift -o diag3 && ./diag3   # 1.3 四种透明配置
```

`probe.swift` 是那次失败的 `CGEvent` 尝试，保留下来是为了记录「这条路走不通」以及为什么。

运行时会在屏幕上短暂出现几个测试窗口，程序自行退出。全程不需要任何系统授权。
