# 0003 - 桌面宠物形态，Tauri v2 同时支持 macOS 与 Windows

日期：2026-07-29
状态：已采纳（取代 ADR 0001 中「浏览器网页」的载体选择）

## 背景

原计划是浏览器网页（见 ADR 0001 的影响一节）。
产品定位调整为**桌面宠物**：猫直接生活在用户的桌面上，而不是活在一个网页里。
这不只是换壳 - 桌面宠物能感知并介入用户的真实工作环境，是网页做不到的一整类交互。

## 决策

- 使用 **Tauri v2**：透明、无边框、置顶窗口 + 托盘图标，现有的 Canvas 渲染与模拟代码原样复用。
- **同时实现 macOS 与 Windows**，平台差异全部隔离在一个窗口初始化 shim 内。
- MVP 阶段仅在 macOS 上验收，Windows 由外部协作者编译验证。

## 理由

- 渲染核心（程序化像素猫，见 ADR 0002）与模拟内核（离线推演，见 ADR 0001）都是平台无关的纯前端代码，迁移成本接近零。
- Tauri 相比 Electron 体积和内存小一个量级，对一个 24h 常驻的桌面挂件很关键。
- 备选 Electron：生态更成熟、透明窗口坑更少，但常驻内存代价不可接受。

## 已知代价

- **macOS 的透明窗口依赖 `macos-private-api`，因此无法上架 Mac App Store。** 直接分发 DMG（开发者签名 + 公证）不受影响。
- Windows 需要 WebView2 运行时；无边框窗口可能出现 1px 白边与 Win11 强制圆角，需显式关闭阴影。
- 创建透明窗口需开启 `noRedirectionBitmap` 防白闪。键名与层级已核实：boolean 类型，位于 `app.windows[]` 的单个窗口配置内，Windows 上会设置 `WS_EX_NOREDIRECTIONBITMAP`（[官方配置参考](https://v2.tauri.app/reference/config/#noredirectionbitmap)）。其实际效果尚未实测。
- `setSkipTaskbar` 在 macOS 无效，macOS 需改用 `ActivationPolicy::Accessory`。
- MSI 必须在 Windows 机器上构建，不能交叉编译，发布链路需要 CI 或协作者的机器。
- 项目无 Windows 测试机，Windows 版的视觉与手感问题依赖外部验收。
  截至 2026-07-29，外部协作者已验证窗口几何读取相关的全部结论（Windows 11 25H2），但**宠物自身透明置顶窗口的表现全部未验证**，因其机器无 Rust 工具链。详见 [mvp-scope 第 8 节](../mvp-scope.md)。

## 影响

- 离线推演（ADR 0001）仍然必要，但「玩家离开」的语义从「关掉网页」变为「电脑关机或睡眠」。
- 桌面宠物常驻期间猫是真的在运行，且**可以主动找用户**（通知、走到前台窗口旁），这是 ADR 0001 中因纯前端而放弃的能力。
- 存档从 localStorage 迁移到应用数据目录的文件。
