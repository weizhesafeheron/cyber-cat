# macOS 点击穿透 spike

ticket [#2](https://github.com/weizhesafeheron/cyber-cat/issues/2) 的探针代码。

**结论见 [docs/research/2026-07-29-macos-hit-test/report.md](../../docs/research/2026-07-29-macos-hit-test/report.md)。**
这里只是能跑的证据，本身不属于产品代码。

单文件 Swift，无依赖，不需要任何系统授权：

```sh
swiftc -O diag.swift  -o diag  && ./diag    # 判定工具的语义诊断
swiftc -O diag2.swift -o diag2 && ./diag2   # 三种内容对比 + ignoresMouseEvents 传播延迟
swiftc -O diag3.swift -o diag3 && ./diag3   # 四种 WKWebView 透明配置
```

`probe.swift` 是一次**失败**的尝试：用 `CGEvent` 合成点击来判定事件归属。
对照点（不透明像素）也收不到事件，说明工具本身失效 - 几乎确定是 `CGEvent.post`
在现代 macOS 上需要辅助功能授权。保留它是为了记录这条路走不通以及为什么。

运行时屏幕上会短暂出现几个测试窗口，程序自行退出。
