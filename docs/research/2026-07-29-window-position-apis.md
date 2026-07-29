# 跨平台读取前台窗口几何信息的可行性调研

日期：2026-07-29
调研目标：桌面宠物猫爬到「当前前台窗口」的上边缘并趴在标题栏上，需要持续读取其他应用窗口的位置与尺寸，以及判断哪个窗口是前台窗口。
不需要读窗口内容，不需要截图。

## 结论摘要

**macOS 上可以完全免授权实现。**
`CGWindowListCopyWindowInfo` 在没有屏幕录制权限、也没有辅助功能权限的情况下，照样返回所有 app 的窗口矩形、所属进程 PID、所属 app 名称和前后层级顺序；被 TCC 拦下的只有窗口标题 `kCGWindowName` 这一个字段，而这个特效根本不需要标题。
这一条是我在本机 macOS 15.5 上实测验证过的，不是推断（实测方法与输出见下文「macOS 实测证据」）。

**Windows 上同样不需要任何权限或清单声明，已于 2026-07-29 在 Windows 11 25H2（build 26200.8875）实机验证。**
`GetForegroundWindow` + `GetWindowRect` / `DwmGetWindowAttribute` 都是普通的 user32 / dwmapi 只读调用，微软文档里没有列出任何权限、特权或 manifest 要求；UIAccess 只在需要向更高完整性级别进程**发送消息或装钩子**时才需要，读几何信息不属于这一类。
实机确认：普通权限进程能读取以管理员权限运行的窗口的几何**以及标题**；UWP / 打包应用（设置、计算器）也能正常读取。
实测数据见 2.4。

真正需要小心的不是权限，而是坐标系：macOS 的 `kCGWindowBounds` 是「点」不是像素，Windows 的 `GetWindowRect` 含不可见阴影边框且受 DPI 虚拟化影响。
这两条都有明确的官方说明和现成的正确写法，见下文。

---

## 一、macOS

### 1.1 `CGWindowListCopyWindowInfo` 拿窗口几何是否需要授权

不需要。
只有 `kCGWindowName`（窗口标题）这一个键被屏幕录制权限（Screen Recording / TCC `kTCCServiceScreenCapture`）门控，其余键包括 `kCGWindowBounds`、`kCGWindowOwnerPID`、`kCGWindowOwnerName`、`kCGWindowNumber`、`kCGWindowLayer` 全部照常返回。

Apple DTS 工程师 Quinn 在官方开发者论坛的原话：

> Access to the `kCGWindowName` string seems to be gated by the Screen Recording user data protection. Once I got that, I received window names just fine on 10.15.

来源：[Apple Developer Forums thread 126860](https://developer.apple.com/forums/thread/126860)，背景变更来自 [WWDC19 Session 701 "Advances in macOS Security"](https://developer.apple.com/videos/play/wwdc2019/701/)。

辅助功能权限（Accessibility）与这条路径完全无关，`CGWindowListCopyWindowInfo` 不走 AX 通道。

#### macOS 实测证据

本机环境：macOS 15.5 (24F74)，Xcode 16 SDK。
写了一个未签名、未打包的 Swift 命令行程序直接调用，进程既没有屏幕录制权限也没有辅助功能权限：

```
CGPreflightScreenCaptureAccess = false
AXIsProcessTrusted             = false
window count = 38
  pid=9428   owner=Ghostty        name=<NIL> rect=(0,27 1920x1002)
  pid=28413  owner=WeChat         name=<NIL> rect=(573,144 1194x769)
  pid=14553  owner=Code           name=<NIL> rect=(204,25 1512x893)
  pid=4200   owner=Google Chrome  name=<NIL> rect=(0,25 1920x1002)
  ...
windows with non-nil kCGWindowName: 1/38
   （唯一带名字的是系统自己的 Window Server "Menubar"，不是第三方 app）
```

整个过程没有弹出任何授权对话框。
用 `NSWorkspace.shared.frontmostApplication` 拿到前台 app 的 PID，再在窗口列表里按 PID 过滤 + 取 `kCGWindowLayer == 0` 的第一个（列表本身就是从前到后排序的），就精确得到了前台窗口的矩形：

```
NSWorkspace frontmostApplication: Ghostty pid=9428
   => frontmost window rect = (0.0, 27.0, 1920.0x1002.0)  windowID=1729
```

这就是这个特效需要的全部信息。

### 1.2 各版本是否收紧，是否已 deprecated

`CGWindowListCopyWindowInfo` **没有**被标记为 deprecated。

本机 macOS 15.5 SDK 头文件 `CoreGraphics.framework/Headers/CGWindow.h` 里的声明：

```c
CG_EXTERN CFArrayRef __nullable CGWindowListCopyWindowInfo(CGWindowListOption option,
    CGWindowID relativeToWindow)
    API_AVAILABLE(macos(10.5));
```

只有 `API_AVAILABLE`，没有 `API_DEPRECATED`。
Apple 线上文档（今天抓取的 [CGWindowListCopyWindowInfo](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:))）同样没有任何 deprecation 说明，platforms 字段只写 `macOS 10.5` 引入。

被废弃的是**截图**相关的那一批，不是窗口信息查询。
同一个头文件里：

```c
#define SCREEN_CAPTURE_OBSOLETE(x,y,z) \
    __attribute__((availability(macos,introduced=x,deprecated=y,obsoleted=z,\
                   message="Please use ScreenCaptureKit instead.")));

CG_EXTERN CGImageRef __nullable CGWindowListCreateImage(...) SCREEN_CAPTURE_OBSOLETE(10.5,14.0,15.0);
CG_EXTERN CGImageRef __nullable CGWindowListCreateImageFromArray(...) SCREEN_CAPTURE_OBSOLETE(10.5,14.0,15.0);
```

即 `CGWindowListCreateImage` 在 macOS 14.0 弃用、15.0 废除，官方替代是 ScreenCaptureKit。
`CGDisplayStream`（`CGDisplayStream.h`）与 `CGDisplayCreateImage`（`CGDirectDisplay.h`）也是同一批，分别标注 `SCREEN_CAPTURE_OBSOLETE(10.8,14.0,15.0)` 和 `SCREEN_CAPTURE_OBSOLETE(10.6,14.4,15.0)`。

所以 Apple 收紧的是「读像素」，不是「读几何」。
这个区分对本项目是决定性的：我们只要几何。

关于官方替代方案 ScreenCaptureKit：`SCShareableContent` 是**强制要授权**的。
Apple 官方示例工程 [Capturing screen content in macOS](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos) 明写：

> The first time you run this sample, the system prompts you to grant the app Screen Recording permission. After you grant permission, you need to restart the app to enable capture.

而且要求 macOS 15 + Xcode 16。
[`SCShareableContent` 文档页](https://developer.apple.com/documentation/screencapturekit/scshareablecontent)自身没有单独描述权限，但它是 ScreenCaptureKit 获取可捕获内容的入口，行为上与截图同属一个 TCC 服务。
**换句话说，如果为了「更现代」而改用 SCShareableContent 拿窗口列表，反而会把一个免授权特性变成强授权特性。这是必须避免的方向。**

macOS 15 (Sequoia) 引入了对已授权屏幕录制的 app 的周期性重新确认弹窗。
但这个机制只作用于真正触发了 TCC 屏幕录制服务的 app；我们这条路径根本不触发 TCC，所以不受影响。
**未能确认**：Apple 官方支持文档 [Control access to screen and system audio recording on Mac](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac) 只讲怎么管理已有授权，没有描述「每周 / 每月重新询问」的具体频率；我在 developer.apple.com 与 support.apple.com 范围内搜索也没找到 Apple 一手的频率说明，只有开发者论坛的beta 期讨论。既然本方案不进入这条路径，我没有继续深挖。

macOS 26 (Tahoe)：Apple 线上文档今天仍显示 `CGWindowListCopyWindowInfo` 未废弃，这份文档反映的是最新 SDK。
**未能确认**：本机只装了 macOS 14.5 / 15.2 / 15.5 三个 SDK，我没有 macOS 26 SDK 可以直接 grep 头文件确认注解，因此「macOS 26 SDK 里也没加 deprecation 注解」这一条只有线上文档作为依据，没有头文件级别的证据。

### 1.3 只用 Accessibility API (`AXUIElement`) 的授权要求

必须授权，且没有例外。

同一个测试程序在未授权状态下调用 `AXUIElementCopyAttributeValue(app, kAXFocusedWindow)`，返回错误码 `-25211`。
查本机 SDK 头文件 `HIServices.framework/Headers/AXError.h`：

```c
/*! The accessibility API is disabled (as when, for example, the user deselects
    "Enable access for assistive devices" in Universal Access Preferences). */
kAXErrorAPIDisabled = -25211,
```

也就是说 AX 路径在未授权时是硬失败，连 frame 都拿不到，不像 CGWindowList 那样「降级返回」。

判断与申请授权用 `AXIsProcessTrustedWithOptions`，SDK 头文件 `AXUIElement.h` 的说明：

> @abstract Returns whether the current process is a trusted accessibility client.
> KEY: `kAXTrustedCheckOptionPrompt`
> VALUE: a CFBooleanRef indicating whether the user will be informed if the current process is untrusted. This could be used, for example, on application startup to always warn a user if accessibility is not enabled for the current process. Prompting occurs asynchronously and does not affect the return value.

线上文档：[AXIsProcessTrustedWithOptions](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrustedwithoptions)。

结论：AX 路径对本特效没有价值。
它能提供的额外信息（窗口标题、实时的 AXObserver 移动通知）要么我们不需要，要么可以用轮询替代，却要付出一个用户必须手动去系统设置里勾选的权限。

### 1.4 完全免授权拿前台窗口位置和大小的路径

有，就是 1.1 里实测过的组合：

1. `NSWorkspace.shared.frontmostApplication` 拿前台 app 及其 PID。
   [官方文档](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication)：「Returns the frontmost app, which is the app that receives key events.」不需要任何权限。
2. `CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID)` 拿全部在屏窗口，结果按 z 序从前到后排列。
3. 按 `kCGWindowOwnerPID == 前台 PID` 且 `kCGWindowLayer == 0` 过滤，取第一个，读它的 `kCGWindowBounds`。

`NSWorkspace` 本身**不能**直接给出窗口 frame，`NSRunningApplication` 上没有任何窗口几何属性（[文档](https://developer.apple.com/documentation/appkit/nsrunningapplication)）。
窗口矩形只能从 CGWindowList 拿。

避免每帧都做 app 切换判断，可以监听 [`NSWorkspace.didActivateApplicationNotification`](https://developer.apple.com/documentation/appkit/nsworkspace/didactivateapplicationnotification)（「A notification that the workspace posts when the Finder is about to activate an app」，userInfo 里带 `NSRunningApplication`），只在切换时重新解析目标窗口，平时只跟踪已知 windowID 的矩形。

### 1.5 坐标系与单位（容易踩的坑）

`kCGWindowBounds` 的官方定义（SDK 头文件 `CGWindow.h`）：

```
/* The bounds of the window in screen space, with the origin at the
   upper-left corner of the main display. */
```

注意两点：

- 原点在**主显示器左上角**，Y 轴向下。这与 AppKit 的左下原点相反，但与 tao / Tauri 的逻辑坐标系一致。
- 单位是**点（point），不是物理像素**。

第二点我实测确认过。
本机是 4K 面板（3840x2160）跑在「看起来像 1920x1080」的缩放下，`NSScreen.backingScaleFactor == 2.0`，而：

```
CGDisplayPixelsWide/High(main) = 1920 x 1080
CGDisplayBounds(main)          = (0, 0, 1920, 1080)
全屏窗口的 kCGWindowBounds     = (0, 27, 1920x1002)
```

即 CGWindowList 返回的是点，和 `NSScreen.frame` 同一套单位。
要转成 Tauri 的 `PhysicalPosition` 需要乘 `scale_factor`；直接用 `LogicalPosition` 则无需换算（见第三节）。

---

## 二、Windows

**前置声明**：2.1 至 2.3 依据 Microsoft Learn 官方文档写成，当时无 Windows 机器。
2.4 是 2026-07-29 由外部协作者在真实 Windows 11 机器上补做的实机验证，结论与文档一致，并额外发现两条文档没有提到的实现要求。

### 2.1 是否需要权限或清单声明

不需要。

[`EnumWindows`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows)、[`GetWindowRect`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect)、[`DwmGetWindowAttribute`](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmgetwindowattribute) 三个页面的 Requirements 表里只列了最低系统版本、头文件、lib、dll，没有任何 privilege / manifest / 权限项。
`EnumWindows` 的 Remarks 只提到一条限制，与权限无关：

> Note For Windows 8 and later, EnumWindows enumerates only top-level windows of desktop apps.

也就是说 UWP / 打包应用的窗口可能枚举不到，这是能力边界，不是授权问题。

UIAccess 的适用范围在 [Security Considerations for Assistive Technologies](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview) 里写得很清楚，它解决的是「访问更高完整性级别进程」和「任意时刻置顶」两件事：

> To get access to higher IL processes, an assistive technology application must set the UIAccess flag in the application's manifest and be launched by a user with administrator privileges.

并且明确劝阻滥用：

> UIAccess should not be used:
> - By applications that are not assistive technologies.
> - By applications that just want to appear above other applications in the new Windows UI.

而 UIPI 到底拦什么，[Windows Integrity Mechanism Design](https://learn.microsoft.com/en-us/previous-versions/dotnet/articles/bb625963(v=msdn.10)) 给了完整清单。低完整性级别进程不能：

> - Perform a window handle validation of a process running with higher rights.
> - Use SendMessage or PostMessage to application windows running with higher rights. These APIs return success but silently drop the window message.
> - Use thread hooks to attach to a process running with higher rights.
> - Use journal hooks to monitor a process running with higher rights.
> - Perform dynamic link library (DLL) injection to a process running with higher rights.

清单里全是「发消息 / 装钩子 / 注入」，`GetWindowRect`、`EnumWindows`、`GetForegroundWindow` 都不在其中。
同一份文档还确认了绘制不受限：

> Painting to the screen is another action that is not blocked by UIPI.

这对桌面宠物很重要，意味着猫可以画在以管理员身份运行的窗口的标题栏上。

一个需要注意的副作用：文档里 UIPI 明确放行了「read 型消息」如 `WM_GETTEXT`，但也提到会拦 higher-rights 进程的 window handle validation。
所以如果将来要读**窗口标题**（`GetWindowTextW` 内部走 `WM_GETTEXT`），对以管理员身份运行的窗口可能拿到空串。
本特效不需要标题，不受影响。

**未能确认**：`DwmGetWindowAttribute` 文档没有明说是否对其他进程的 HWND 一律有效，也没有说 DWM 合成关闭时的行为。从 `active-win-pos-rs` 的实现看，社区做法是「先试 DWM，失败回退 `GetWindowRect`」，这是稳妥写法，但我没有一手文档能断言它在所有情况下成功。

### 2.2 多显示器 + 不同 DPI 缩放的坐标换算

`GetWindowRect` 返回的是**物理像素还是逻辑像素，取决于调用进程自身的 DPI 感知模式**。
官方 Remarks 只有一句：

> GetWindowRect is virtualized for DPI.

[High DPI Desktop Application Development on Windows](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows) 解释了 virtualization 的含义：

> When an HWND or process is running as either DPI unaware or system DPI aware, it can be bitmap stretched by Windows. When this happens, Windows scales and converts DPI-sensitive information from some APIs to the coordinate space of the calling thread. For example, if a DPI-unaware thread queries the screen size while running on a high-DPI display, Windows will virtualize the answer given to the application as if the screen were in 96 DPI units.

而 Per-Monitor V2 模式下：

> Registering a process as running in PMv2 awareness mode results in:
> 1. The application being notified when the DPI changes (both the top-level and child HWNDs)
> 2. **The application seeing the raw pixels of each display**
> 3. The application never being bitmap scaled by Windows
> ...

所以只要进程是 PMv2，`GetWindowRect` 返回的就是**跨显示器统一的物理像素虚拟桌面坐标**，多显示器不同缩放下不需要额外换算，这正是我们要的。
反过来，如果进程是 DPI unaware 或 system aware，拿到的坐标会被系统按调用线程的 DPI 上下文改写，跨屏就会错位。

同一份文档还有一条对本项目的直接警告：

> ...it can be difficult to know which API calls can return virtualized values based on the thread context; this information is not currently sufficiently documented by Microsoft. Be aware that if you call any system API from a DPI-unaware or system-DPI-aware thread context, the return value might be virtualized. As such, make sure your thread is running in the DPI context you expect when interacting with the screen or individual windows.

**好消息是 Tauri v2 已经默认帮我们设成 PMv2 了**，不需要自己写 manifest，详见 3.3。

如果需要知道某个窗口所在显示器的缩放比例（比如按 DPI 缩放猫的贴图），用 [`GetDpiForWindow`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdpiforwindow)，它是官方推荐的 per-monitor 版本，用来替代 `GetDpiForMonitor`（见文档中的「Single DPI version → Per-Monitor version」对照表）。

### 2.3 `GetWindowRect` vs `DWMWA_EXTENDED_FRAME_BOUNDS`

应该用 `DwmGetWindowAttribute` + `DWMWA_EXTENDED_FRAME_BOUNDS`，这是微软自己在 `GetWindowRect` 文档里给的建议，原文：

> In Windows Vista and later, the Window Rect now may include invisible resize borders.
>
> To get the visible window bounds, not including the invisible resize borders, use [DwmGetWindowAttribute](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmgetwindowattribute), specifying **DWMWA_EXTENDED_FRAME_BOUNDS**. Note that unlike the Window Rect, the DWM Extended Frame Bounds are not adjusted for DPI.

对「猫趴在标题栏上」这个特效，这条差别是致命的：`GetWindowRect` 的左右和底边通常比可见边框各多出约 7-8 个像素的透明拖拽区。
如果按它定位，猫会悬在窗口边缘外侧，看起来是浮空的。

`DWMWA_EXTENDED_FRAME_BOUNDS` 的定义（[DWMWINDOWATTRIBUTE 文档](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)）：

> Use with DwmGetWindowAttribute. Retrieves the extended frame bounds rectangle in screen space. The retrieved value is of type RECT.

注意上面那句 "not adjusted for DPI"：DWM 返回的永远是物理像素。
在 PMv2 进程里这不构成问题，因为 `GetWindowRect` 此时返回的也是物理像素，两者同一套单位，可以混用和互为 fallback。
但如果进程不是 PMv2，两个 API 的单位就会不一致，这是又一条必须确保 PMv2 的理由。

顶边（也就是猫要趴的那条线）在两个 API 下差别很小，因为不可见边框主要在左右和底部；但既然要算窗口宽度来决定猫能走多远，还是应该整体用 DWM 的矩形。

### 2.4 实机实测结果（2026-07-29）

测试环境：Windows 11 家庭中文版 25H2，OS build 26200.8875，RTX 3060 Laptop。
双显示器且缩放不同，因此负坐标与跨 DPI 场景都覆盖到了：
主屏 2560×1600 @150%（DPI 144）位于右侧、坐标 0..2560；副屏 2560×1440 @100%（DPI 96）位于左侧、坐标 -2560..0。
探针为普通用户权限的 PowerShell 7.6.4，`SetProcessDpiAwarenessContext(PMv2)` 返回 True。

#### 2.4.1 权限：确认无需任何授权

普通权限探针读取**以管理员身份运行**的记事本，几何与标题全部成功：

```
hwnd=264816  pid=36700  process=Notepad
  title           = 'admin-probe.txt - Notepad' (长度 25)
  GetWindowRect   = L=318 T=186 R=2238 B=1304
  DWM_EXT_FRAME   = L=325 T=186 R=2231 B=1297
```

标题也能读到，比 2.1 的预期更宽松（2.1 曾推测 UIPI 可能拦 `WM_GETTEXT`，实测未拦）。
本特效不需要标题，因此这一点只是额外收获，不构成依赖。

#### 2.4.2 不可见边框宽度：随 DPI 与最大化状态变化

| 窗口状态 | 显示器缩放 | GetWindowRect 比 DWM 多出的像素（左/上/右/下） |
|---|---|---|
| 普通窗口 | 150% | 7 / **0** / 7 / 7 |
| 最大化 | 150% | 11 / **11** / 11 / 9 |
| 普通窗口 | 100% | 5 / **0** / 5 / 5 |

两条重要发现：

**普通窗口的顶边差值是 0**，即 `GetWindowRect.Top == DWM.Top`。
猫要趴的正是顶边，所以对非最大化窗口而言两个 API 的顶边等价。

**但最大化窗口的顶边差值是 11 像素。**
如果用 `GetWindowRect`，猫在最大化窗口上会浮空 11 像素。
这条单独证明了必须用 DWM：不是「更精确」的问题，而是最大化这个极常见状态下会明显出错。

边框宽度本身随 DPI 缩放（150% 下 7px，100% 下 5px），不要硬编码。

#### 2.4.3 跨显示器与负坐标：PMv2 行为符合预期

同一窗口从主屏（150%）移到副屏（100%）：

```
主屏 150%：GetWindowRect L=200   T=160 R=1100  B=810   => 900 x 650   GetDpiForWindow=144
副屏 100%：GetWindowRect L=-2200 T=160 R=-1600 B=593   => 600 x 433   GetDpiForWindow=96
```

- 坐标是跨屏统一的虚拟桌面物理像素，左侧副屏正常返回负值。
- `GetDpiForWindow` 正确跟随窗口所在显示器切换（144 → 96）。
- **窗口物理尺寸变了（900×650 → 600×433），逻辑尺寸不变。**
  这意味着猫的贴图必须按目标窗口所在显示器的 DPI 缩放，否则跨屏时猫与窗口的比例会错。

#### 2.4.4 cloaked 窗口：文档未提及的必须过滤项

「设置」应用同时存在两个同标题窗口：
`SystemSettings` 进程的那个 `DWMWA_CLOAKED == 2`（被 DWM 隐藏），真正可见并成为前台的是 `ApplicationFrameHost` 进程的窗口。

**因此枚举窗口时必须查询 `DWMWA_CLOAKED`（属性值 14）并排除非 0 的候选。**
只按标题或进程名取第一个 hwnd 会拿到隐藏窗口，猫会跑到一个屏幕上根本不存在的矩形上去。

本特效主路径只用 `GetForegroundWindow`，它返回的就是可见窗口（实测设置与计算器都正确），所以主路径不受影响。
但后续若要做「猫在多个窗口之间跳」而引入 `EnumWindows`，这条过滤是必需的。

UWP / 打包应用（设置、计算器）的前台 hwnd、DWM 矩形、DPI 均可正常读取，`EnumWindows` 枚举不到打包应用（见 2.1 文档说明）这一限制不影响前台窗口路径。

#### 2.4.5 性能：比 macOS 便宜一个量级

每项 2000 次取平均：

| 调用 | 耗时 |
|---|---|
| `GetForegroundWindow` | 0.0106 ms |
| `GetWindowRect` | 0.0296 ms |
| `DwmGetWindowAttribute` | 0.0353 ms |

即使每 tick 三个调用全做，也只有约 0.076 ms，10 Hz 下不到 0.8 ms/s。
Windows 侧不需要 macOS 那种「锁定 windowID 增量查询」的优化。

#### 2.4.6 本轮仍未验证

- 真实全屏游戏与全屏视频播放器下 `GetForegroundWindow` 的行为。
- 宠物自身的透明置顶窗口在 Windows 上的全部表现（白边、圆角、白闪、点击穿透、任务栏、全屏置顶、跨 DPI 时 Canvas 像素画是否被插值）。
  该项需要 Rust 工具链构建 Tauri 应用，协作者机器上没有，本轮未做。**这是目前 Windows 侧最大的未知。**

补充确认（来自 Tauri v2 官方配置参考）：防止透明窗口创建时白闪的配置项准确为 `noRedirectionBitmap`，boolean 类型，位于 `app.windows[]` 的单个窗口配置内，在 Windows 上会设置 `WS_EX_NOREDIRECTIONBITMAP`。
来源：[Tauri v2 config reference · noRedirectionBitmap](https://v2.tauri.app/reference/config/#noredirectionbitmap)。
**该键名已核实，但其消除白闪的实际效果未经实测。**

---

## 三、Tauri v2 集成

### 3.1 现成的 crate

| crate | 最新版 / 更新时间 | 实现方式 | 授权行为 | 评价 |
|---|---|---|---|---|
| [`active-win-pos-rs`](https://github.com/dimusic/active-win-pos-rs) | 0.11.0 / 2026-05-26 | macOS: `NSWorkspace.frontmostApplication` + `CGWindowListCopyWindowInfo`；Windows: `GetForegroundWindow` + `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`，失败回退 `GetWindowRect` | 免授权拿到位置；标题为空 | **最贴合需求** |
| [`xcap`](https://github.com/nashaofu/xcap) | 0.9.7 / 2026-07-20 | 截图库，窗口枚举同样用 `CGWindowListCopyWindowInfo`，但截图路径用了已废除的 `CGWindowListCreateImage` | 启动时 `CGPreflightScreenCaptureAccess()`，未授权会打 warning 日志 | 过重，为截图而生 |
| `window-titles` | **crates.io 上不存在** | - | - | 不可用 |

`active-win-pos-rs` 是活跃维护的，最后一次提交 2026-05-26，近半年发了 0.10.0 / 0.10.1 / 0.11.0 三个版本。
它的 macOS 实现（`src/mac/platform_api.rs`）和我在 1.1 实测的路径逐行一致：

```rust
const OPTIONS: CGWindowListOption =
    kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
let window_list_info = unsafe { CGWindowListCopyWindowInfo(OPTIONS, kCGNullWindowID) };
let active_app = unsafe { NSWorkspace::sharedWorkspace().frontmostApplication() };
let active_window_pid = unsafe { active_app.processIdentifier() as i64 };
// 按 pid 过滤，读 kCGWindowBounds
```

它的 README 也明确写了授权行为，与官方文档吻合：

> **Window title on MacOS**
> On MacOS `title` property will always return an empty string unless you Enable Screen Recording permission for your app.

Windows 实现（`src/win/platform_api.rs`）就是 2.3 推荐的写法：

```rust
// Try DwmGetWindowAttribute first for more accurate bounds
let result = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ...);
// Fall back to GetWindowRect if DwmGetWindowAttribute fails
if result.is_err() && !GetWindowRect(hwnd, &mut rect).as_bool() { ... }
```

需要注意它有一条硬编码过滤：窗口宽或高小于 50 就跳过。
对桌面宠物无所谓，但要知道有这个行为。

`xcap` 值得单独说一句：它 0.9.7 仍在用 `CGWindowListCreateImage`，而这个函数在 macOS 15.0 SDK 里已经是 `obsoleted`（见 1.2）。
用旧 SDK 编译能过，但这是个已经在倒计时的依赖。
另外它 `ImplWindow::all()` 一上来就调 `CGPreflightScreenCaptureAccess()` 并打 warning，会给用户和日志制造无谓噪音。
**不建议为了拿窗口几何而引入 xcap。**

如果不想引第三方 crate，直接用 [`objc2-app-kit`](https://crates.io/crates/objc2-app-kit)（0.3.2 / 2025-10）+ [`core-graphics`](https://crates.io/crates/core-graphics)（0.25.0 / 2025-05）和 [`windows`](https://crates.io/crates/windows)（0.62.2 / 2025-10）也完全可行，代码量大概各二三十行。
Tauri v2 本身就依赖 `objc2-*` 系列（tauri 仓库最新提交就是 `chore(deps): update objc2-* crates to 0.3.2`），版本对齐没有额外成本。

**Tauri v2 没有提供任何读取外部窗口的 API。**
我 grep 了 `crates/tauri/src` 全部源码，`EnumWindows` / `CGWindowList` / `GetForegroundWindow` 零命中。
这部分必须自己在 Rust 侧写平台代码。

**未能确认**：Tauri v2 官方文档站（[v2.tauri.app/develop](https://v2.tauri.app/develop/)）没有专门讲「如何在 src-tauri 里调用原生平台 API / 加 objc2、windows-rs 依赖」的章节。做法上没有任何特殊性（就是普通的 Cargo 依赖 + `#[cfg(target_os = "...")]`），但确实没有官方页面可以引用。

### 3.2 macOS 侧坐标与 Tauri 的对接

这里有个很省事的巧合：**`kCGWindowBounds` 和 tao/Tauri 的 `LogicalPosition` 用的是同一套坐标系**。

tao（Tauri v2 的窗口层，0.36.0）在 `src/platform_impl/macos/util/mod.rs` 里的注释：

```rust
/// Converts from tao screen-coordinates to macOS screen-coordinates.
/// Tao: top-left is (0, 0) and y increasing downwards
/// macOS: bottom-left is (0, 0) and y increasing upwards
pub fn window_position(position: LogicalPosition<f64>) -> NSPoint {
  NSPoint::new(position.x, CGDisplay::main().pixels_high() as f64 - position.y)
}
```

tao 的逻辑坐标是「主屏左上角原点、Y 向下」，`kCGWindowBounds` 也是「主显示器左上角原点、Y 向下」，且两者都以点为单位（`CGDisplay::main().pixels_high()` 在我本机 4K 缩放屏上返回 1080，即点数，与 1.5 的实测一致）。

所以 macOS 上可以把 `kCGWindowBounds` 的值几乎原样喂给 `WebviewWindow::set_position(LogicalPosition::new(x, y))`，不需要翻转 Y，也不需要乘 scale factor。

`set_position` 接受 `Into<Position>`，`Position` 是 `LogicalPosition` / `PhysicalPosition` 的枚举（`crates/tauri/src/window/mod.rs:1879`）。

### 3.3 Windows 侧 DPI：Tauri 已经默认 PMv2

不需要自己写 manifest。
tao 在创建 EventLoop 时会调用 `become_dpi_aware()`（`src/platform_impl/windows/event_loop.rs:186`），实现在 `src/platform_impl/windows/dpi.rs`：

```rust
pub fn become_dpi_aware() {
  static ENABLE_DPI_AWARENESS: Once = Once::new();
  ENABLE_DPI_AWARENESS.call_once(|| unsafe {
    if let Some(SetProcessDpiAwarenessContext) = *SET_PROCESS_DPI_AWARENESS_CONTEXT {
      // We are on Windows 10 Anniversary Update (1607) or later.
      if !SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2).as_bool() {
        // V2 only works with Windows 10 Creators Update (1703). Try using the older V1.
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE);
      }
    } else if let Some(SetProcessDpiAwareness) = *SET_PROCESS_DPI_AWARENESS {
      let _ = SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE);
    } else if let Some(SetProcessDPIAware) = *SET_PROCESS_DPI_AWARE {
      let _ = SetProcessDPIAware();
    }
  });
}
```

来源：[tao/src/platform_impl/windows/dpi.rs](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/windows/dpi.rs)（本地 clone 于 2026-07-29，最新提交同日）。

两点要注意：

1. 这个调用受 `attributes.dpi_aware` 控制（`if attributes.dpi_aware { become_dpi_aware(); }`）。默认为 true，**不要去关它**，否则 2.2 里所有坐标结论全部失效。
2. 它在 EventLoop 创建时执行。如果你在 EventLoop 之前就调用 `GetWindowRect`（比如在 `main()` 最前面做探测），进程还是 unaware 状态，拿到的会是虚拟化坐标。窗口查询逻辑要放在 Tauri setup hook 之后。

既然进程是 PMv2，`GetWindowRect` 与 `DWMWA_EXTENDED_FRAME_BOUNDS` 单位一致（都是物理像素虚拟桌面坐标），Tauri 侧应该用 `PhysicalPosition` 直接对接，不要走 `LogicalPosition`。
即 macOS 用逻辑坐标、Windows 用物理坐标，这个差异需要在窗口 shim 里显式区分。

### 3.4 高频轮询的性能与耗电

Apple 在 `CGWindowListCopyWindowInfo` 文档里有明确警告：

> Generating the dictionaries for system windows is a relatively expensive operation. As always, you should profile your code and adjust your usage of this function appropriately for your needs.

来源：[CGWindowListCopyWindowInfo 文档](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:))。

这是我找到的唯一一条官方性能说明。
Microsoft 对 `GetWindowRect` / `EnumWindows` 没有任何性能或耗电方面的文档表述；Tauri / tao 也没有。

所以我在本机实测了（macOS 15.5，M 系列，当时 38 个在屏窗口，每项 200 次取平均）：

| 调用 | 耗时 |
|---|---|
| `CGWindowListCopyWindowInfo(OnScreenOnly \| ExcludeDesktopElements)` | **0.369 ms** |
| `CGWindowListCopyWindowInfo(optionAll)` | 1.180 ms |
| `CGWindowListCreateDescriptionFromArray([单个 windowID])` | **0.072 ms** |

按 10 Hz 轮询算，全量列表是 3.7 ms/s，约单核 0.37%。
对一个 24 小时常驻的挂件，这个量级可以接受，但不是零成本，尤其在电池供电时不值得白白烧掉。

两条明显的优化，实测数据支持：

- **不要用 `optionAll`**，比 `OnScreenOnly | ExcludeDesktopElements` 慢 3.2 倍，而且会把大量离屏窗口和桌面元素混进来。
- **锁定目标后改用 `CGWindowListCreateDescriptionFromArray`**，只查已知的那一个 windowID，快 5 倍（0.072 ms）。全量枚举只在前台 app 切换时做一次。

配合 `NSWorkspace.didActivateApplicationNotification` 做事件驱动，稳态下每次 tick 只有 0.072 ms，10 Hz 下是 0.72 ms/s，基本可以忽略。

另外两条应该做的节流：

- 猫处于「趴着不动」状态时降到 2 Hz 甚至更低；只有猫正在移动、或刚检测到窗口位移时才提到 10 Hz。
- 系统进入睡眠、屏幕锁定、或宠物窗口被遮挡时完全停掉轮询。

Windows 侧耗时已于 2026-07-29 实机补测，见 2.4.5。结论是比 macOS 便宜一个量级，全部低于 0.04 ms。

---

## 四、建议方案

### 4.1 推荐实现路径

**核心判断：macOS 和 Windows 都走免授权路径，这个特效不需要任何权限提示。**

分平台的抽象接口：

```rust
struct ForegroundWindow {
    rect: WindowRect,   // 顶边 y、左边 x、宽、高
    owner_pid: i32,
    window_id: u64,     // macOS: kCGWindowNumber; Windows: HWND as u64
    scale: f64,
}

trait WindowProbe {
    fn foreground(&mut self) -> Option<ForegroundWindow>;
}
```

macOS 实现：

1. 订阅 `NSWorkspace.didActivateApplicationNotification`，切换时用 `CGWindowListCopyWindowInfo(OnScreenOnly | ExcludeDesktopElements)` 全量枚举一次，按前台 PID + `kCGWindowLayer == 0` 取 z 序最前的窗口，记下 `kCGWindowNumber`。
2. 稳态下每 tick 只用 `CGWindowListCreateDescriptionFromArray([windowID])` 刷新矩形。查不到（窗口关闭 / 最小化）就回退到全量枚举。
3. `kCGWindowBounds` 是点，直接当 `LogicalPosition` 用。
4. 排除自己：过滤掉宠物窗口自身的 PID，否则猫会试图趴到自己头上。
5. 过滤掉宽或高过小的窗口，以及 `kCGWindowLayer != 0` 的（菜单栏图标、Dock、输入法候选框都在更高 layer，实测 layer=25 / 24）。

Windows 实现：

1. `GetForegroundWindow()` 拿 HWND，`GetWindowThreadProcessId` 拿 PID 用于排除自身。
2. `DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS)` 拿可见矩形，失败回退 `GetWindowRect`。
3. 确认 Tauri 的 `dpi_aware` 没被关掉，坐标当物理像素用，直接喂 `PhysicalPosition`。
4. 用 `GetDpiForWindow(hwnd)` 拿目标窗口所在屏的 DPI，用来缩放猫的贴图尺寸。
5. 不需要 `EnumWindows`。只要前台窗口的话 `GetForegroundWindow` 就够了，`EnumWindows` 留给「猫要在多个窗口之间跳」这种后续玩法。

依赖选择：先直接用 `active-win-pos-rs` 0.11 跑通原型（它的两平台实现都正好是上面推荐的写法），如果后续需要 windowID 级别的增量查询或自定义过滤，再把那百来行代码内联进项目、换成直接调 `objc2-app-kit` + `core-graphics` / `windows` crate。
不要引 `xcap`。

轮询策略：默认 10 Hz，猫静止时降到 2 Hz，睡眠/锁屏时停止。
把频率做成可配置，方便后续按耗电反馈调。

### 4.2 macOS 若将来必须授权时的降级方案

虽然当前结论是不需要授权，但值得预留降级路径，理由有二：Apple 在 macOS 14 / 15 已经砍掉了整套 CGWindowList 截图 API，把「读几何」也纳入 TCC 不是不可想象；另外如果产品后期想显示窗口标题（比如猫看到你在写代码就做出对应反应），就一定要屏幕录制权限。

**降级检测**：启动时做一次能力探测，而不是查权限。
调一次 `CGWindowListCopyWindowInfo`，如果返回 nil 或者所有窗口的 `kCGWindowBounds` 都拿不到，就判定为「几何不可用」，切换到降级模式。
不要用 `CGPreflightScreenCaptureAccess()` 作为判据，它现在返回 false 但功能完全正常，用它判断会误伤。

**降级模式下猫的活动范围**：

- 主活动区改为屏幕底边（Dock 上沿）与屏幕两侧边缘，这些位置只需要 `NSScreen.frame` / `visibleFrame`，永远免授权。
- 保留「猫在桌面自由行走」「猫在屏幕边缘打盹」「猫追鼠标指针」这些不依赖其他窗口的行为。鼠标位置用 `NSEvent.mouseLocation`，同样免授权。
- 明确放弃的只有「爬窗口标题栏」这一类特效。产品上要把它定位成加分项而不是核心玩法，否则降级后体验会塌掉。

**引导授权的时机设计**：

不要在首次启动时弹权限请求。
桌面宠物的第一印象很重要，开屏就要权限会显著抬高卸载率，而且用户此时还不理解为什么一只猫需要「录屏」权限。

推荐的引导时机，按优先级：

1. **用户主动触发时**。在托盘菜单里放一个「让猫爬到窗口上」的开关，默认关。用户点开时才解释并引导授权。这是最干净的路径，用户有明确预期。
2. **在猫做出相关行为后**。猫走到屏幕上方、抬头看着窗口、然后做一个「够不着」的动作，同时冒出一个小气泡：「我想爬到你的窗口上，但需要你在系统设置里允许一下」。点气泡跳转设置。这个方式比模态框友好，也把权限和具体收益绑在了一起。
3. 无论哪种，都要**只问一次**。用户拒绝后记录状态，之后不再主动弹，只保留托盘菜单里的入口。

**跳转方式**：用 `NSWorkspace.shared.open` 打开 `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`。
要在文案里说明「授权后需要重启这只猫」，因为 Apple 官方 ScreenCaptureKit 示例本身就写了 "After you grant permission, you need to restart the app to enable capture"。

**不要用辅助功能权限做备选**。
它的授权成本和屏幕录制一样高（都要去系统设置手动勾选），但未授权时是硬失败（`kAXErrorAPIDisabled`）而不是优雅降级，且给不了任何 CGWindowList 给不了的、本特效需要的信息。

### 4.3 Windows 的降级方案

不需要。
读几何不涉及任何权限，没有可降级的东西。
唯一需要处理的边界是 `EnumWindows` 枚举不到 UWP / 打包应用的顶层窗口（官方文档 Remarks 明写），以及全屏独占的游戏窗口。
这两种情况让猫回到屏幕边缘待机即可，不需要走权限引导流程。

---

## 五、一手来源清单

**Apple SDK 头文件**（本机 `MacOSX15.5.sdk`，可直接 grep 验证）
- `CoreGraphics.framework/Headers/CGWindow.h` - `CGWindowListCopyWindowInfo` 的 `API_AVAILABLE(macos(10.5))`、`SCREEN_CAPTURE_OBSOLETE` 宏定义、`kCGWindowBounds` 坐标系说明
- `ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXError.h` - `kAXErrorAPIDisabled = -25211`
- `ApplicationServices.framework/Frameworks/HIServices.framework/Headers/AXUIElement.h` - `AXIsProcessTrustedWithOptions` 说明

**Apple 官方文档**
- [CGWindowListCopyWindowInfo](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:))
- [Apple Developer Forums thread 126860](https://developer.apple.com/forums/thread/126860)（Apple DTS 工程师回复）
- [WWDC19 Session 701 "Advances in macOS Security"](https://developer.apple.com/videos/play/wwdc2019/701/)
- [Capturing screen content in macOS](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)
- [SCShareableContent](https://developer.apple.com/documentation/screencapturekit/scshareablecontent)
- [NSWorkspace.frontmostApplication](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication)
- [NSWorkspace.didActivateApplicationNotification](https://developer.apple.com/documentation/appkit/nsworkspace/didactivateapplicationnotification)
- [NSRunningApplication](https://developer.apple.com/documentation/appkit/nsrunningapplication)
- [AXIsProcessTrustedWithOptions](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrustedwithoptions)
- [Control access to screen and system audio recording on Mac](https://support.apple.com/guide/mac-help/control-access-screen-system-audio-recording-mchld6aa7d23/mac)

**Microsoft Learn**
- [GetWindowRect](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect)
- [EnumWindows](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows)
- [DwmGetWindowAttribute](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmgetwindowattribute)
- [DWMWINDOWATTRIBUTE](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)
- [High DPI Desktop Application Development on Windows](https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows)
- [GetDpiForWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdpiforwindow)
- [Security Considerations for Assistive Technologies (UIAccess)](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview)
- [Windows Integrity Mechanism Design (UIPI)](https://learn.microsoft.com/en-us/previous-versions/dotnet/articles/bb625963(v=msdn.10))

**源码**
- [tao/src/platform_impl/windows/dpi.rs](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/windows/dpi.rs)
- [tao/src/platform_impl/macos/util/mod.rs](https://github.com/tauri-apps/tao/blob/dev/src/platform_impl/macos/util/mod.rs)
- [tauri/crates/tauri/src/window/mod.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/window/mod.rs)
- [active-win-pos-rs](https://github.com/dimusic/active-win-pos-rs)（`src/mac/platform_api.rs`、`src/win/platform_api.rs`、README）
- [xcap](https://github.com/nashaofu/xcap)（`src/macos/impl_window.rs`、`src/macos/capture.rs`）

**本机实测**（macOS 15.5 / 24F74，未签名未打包的 Swift CLI，无任何 TCC 授权）
- 无授权下 `CGWindowListCopyWindowInfo` 返回 38 个窗口的完整几何，仅 `kCGWindowName` 被屏蔽
- 无授权下 `AXUIElementCopyAttributeValue(kAXFocusedWindow)` 返回 -25211
- `kCGWindowBounds` 单位为点（4K 面板 @2x 缩放下全屏窗口为 1920x1002）
- 三种查询方式的耗时基准（0.369 ms / 1.180 ms / 0.072 ms）
