// 诊断三：怎样让 WKWebView 真正产出 alpha=0，从而恢复 macOS 的原生逐像素穿透？
import AppKit
import WebKit

let HTML = """
<!DOCTYPE html><html><head><meta charset=utf-8><style>
html,body{margin:0;padding:0;background:transparent;width:140px;height:160px}
#b{position:absolute;left:70px;top:0;width:70px;height:160px;background:#0f0}
</style></head><body><div id=b></div></body></html>
"""

final class D: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var under: NSWindow!
    struct V { let name: String; let win: NSWindow; let web: WKWebView; let x: CGFloat }
    var vs: [V] = []
    var loaded = 0
    var log: [String] = []

    func applicationDidFinishLaunching(_ n: Notification) {
        under = mk(NSRect(x: 260, y: 300, width: 900, height: 400), .normal)
        under.backgroundColor = .systemBlue; under.isOpaque = true

        // 四种透明配置逐一对比
        add("A 仅 drawsBackground=false", 300) { _ in }
        add("B +layer.isOpaque=false", 460) { w in w.layer?.isOpaque = false }
        add("C +underPageBackgroundColor", 620) { w in
            if #available(macOS 12.0, *) { w.underPageBackgroundColor = .clear }
        }
        add("D 三者全开", 780) { w in
            w.layer?.isOpaque = false
            if #available(macOS 12.0, *) { w.underPageBackgroundColor = .clear }
        }
    }

    func add(_ name: String, _ x: CGFloat, _ tweak: (WKWebView) -> Void) {
        let win = mk(NSRect(x: x, y: 340, width: 140, height: 160), .floating)
        win.isOpaque = false; win.backgroundColor = .clear
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 140, height: 160),
                            configuration: WKWebViewConfiguration())
        web.setValue(false, forKey: "drawsBackground")
        tweak(web)
        web.navigationDelegate = self
        win.contentView = web
        vs.append(V(name: name, win: win, web: web, x: x))
        web.loadHTMLString(HTML, baseURL: nil)
    }

    func mk(_ r: NSRect, _ lv: NSWindow.Level) -> NSWindow {
        let w = NSWindow(contentRect: r, styleMask: [.borderless], backing: .buffered, defer: false)
        w.hasShadow = false; w.level = lv; w.orderFrontRegardless(); return w
    }

    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        loaded += 1
        if loaded == vs.count {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.go() }
        }
    }

    func at(_ x: CGFloat, _ y: CGFloat) -> String {
        let n = NSWindow.windowNumber(at: CGPoint(x: x, y: y), belowWindowWithWindowNumber: 0)
        if n == under.windowNumber { return "穿透✓" }
        for v in vs where n == v.win.windowNumber { return "被窗口截获✗" }
        return "其它#\(n)"
    }

    func go() {
        log.append("=== 诊断三：WKWebView 的透明配置 vs 原生逐像素穿透 ===")
        log.append("系统：\(ProcessInfo.processInfo.operatingSystemVersionString)")
        log.append("")
        log.append("每个窗口 140x160：左半 CSS 透明，右半绿色不透明方块")
        log.append("")
        for v in vs {
            let left  = at(v.x + 35, 420)   // CSS 透明的一半
            let right = at(v.x + 105, 420)  // 绿色方块那一半
            log.append("  \(v.name.padding(toLength: 28, withPad: " ", startingAt: 0))")
            log.append("      左半(透明像素) → \(left)")
            log.append("      右半(绿色方块) → \(right)")
        }
        log.append("")
        log.append("期望：左半穿透✓ 且 右半被截获✗ → 该配置恢复了原生逐像素命中")
        log.append("")
        log.append("=== 结束 ===")
        print(log.joined(separator: "\n"))
        NSApp.terminate(nil)
    }
}
let a = NSApplication.shared
let d = D(); a.delegate = d
a.setActivationPolicy(.accessory)
a.run()
