# 0005 - 用 CGWindowList 读窗口几何，不迁移到 ScreenCaptureKit

日期：2026-07-29
状态：已采纳

## 背景

「猫爬到前台窗口上」（MVP 特效 3.1）需要持续读取其他应用窗口的位置与尺寸。

macOS 上有两条路：
老的 `CGWindowListCopyWindowInfo`，和 Apple 在 macOS 14/15 推为替代品的 ScreenCaptureKit `SCShareableContent`。
后者看起来是「正确」的现代选择，因为 Apple 确实废弃了同一个头文件里的一批 API。

## 决策

**使用 `CGWindowListCopyWindowInfo` + `NSWorkspace.frontmostApplication`，明确不迁移到 ScreenCaptureKit。**
Windows 侧对应使用 `GetForegroundWindow` + `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`。

## 理由

Apple 废弃的是**读像素**（`CGWindowListCreateImage` 等，macOS 14 弃用、15 废除），不是**读几何**。
`CGWindowListCopyWindowInfo` 在最新 SDK 头文件里只有 `API_AVAILABLE`，没有任何 deprecation 注解。

关键事实：这条路径**完全不需要用户授权**。
在既无屏幕录制权限、也无辅助功能权限的进程里，它照常返回所有窗口的矩形、PID、所属 app 与层级顺序；被 TCC 拦下的只有 `kCGWindowName`（窗口标题）这一个字段，而本特效不需要标题。
本机 macOS 15.5 实测确认：`CGPreflightScreenCaptureAccess` 与 `AXIsProcessTrusted` 均为 false 时，38 个在屏窗口全部返回完整几何，仅 1 个返回标题。

反过来，`SCShareableContent` 是强制要屏幕录制授权的。
**迁移到它会把一个零摩擦的特性变成需要用户去系统设置手动勾选、并重启应用的特性。**
辅助功能 API（`AXUIElement`）同样必须授权，且未授权时是硬失败（`kAXErrorAPIDisabled = -25211`），不像 CGWindowList 那样优雅降级，却给不了任何本特效需要的额外信息。

详细证据、一手来源与实测数据见 [docs/research/2026-07-29-window-position-apis.md](../research/2026-07-29-window-position-apis.md)。

## 影响

- 特效 3.1 无需任何权限引导流程，MVP 不再需要为它设计降级模式（降级方案仍记录在调研文档里备用）。
- **任何「把这个 API 现代化」的重构提案都必须先确认不会引入 TCC 授权要求。** 这是本条 ADR 存在的主要原因。
- 若产品后期要读窗口标题（例如猫识别用户在写代码并作出反应），届时才需要屏幕录制权限，属于独立决策。
- 坐标系差异需在窗口 shim 里显式区分：macOS 的 `kCGWindowBounds` 单位是点，可直接当 Tauri 的 `LogicalPosition`；Windows 在 Tauri 默认的 Per-Monitor-V2 感知下拿到的是物理像素，应走 `PhysicalPosition`。
- 不得关闭 tao 的 `dpi_aware`（默认 true），否则 Windows 侧全部坐标结论失效。

## Windows 实机验证补充（2026-07-29）

外部协作者在 Windows 11 25H2（build 26200.8875）双显示器混合 DPI 环境上实测，确认了免授权结论，并额外发现两条必须遵守的实现约束：

1. **`GetWindowRect` 对最大化窗口的顶边偏差 11 像素**（普通窗口顶边偏差为 0）。这不是精度问题而是明显错误，进一步强化了必须用 `DWMWA_EXTENDED_FRAME_BOUNDS` 的结论。
2. **必须过滤 `DWMWA_CLOAKED != 0` 的窗口。** 「设置」应用同时存在一个 cloaked 的 `SystemSettings` 窗口与一个可见的 `ApplicationFrameHost` 窗口，两者标题相同。主路径用 `GetForegroundWindow` 不受影响，但引入 `EnumWindows` 后必须加此过滤。

另确认普通权限进程可读取管理员权限窗口的几何**与标题**（UIPI 未拦 `WM_GETTEXT`），比原先基于文档的预期更宽松；本特效不依赖标题，此项仅为额外余量。
