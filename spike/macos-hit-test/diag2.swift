// 诊断二：alpha 到底影响不影响命中？以及 ignoresMouseEvents 的传播延迟有多大？
import AppKit
import WebKit

/// 左半不透明、右半完全透明的自绘视图 —— 同一个视图内制造 alpha 差异
final class HalfView: NSView {
    override var isOpaque: Bool { false }
    override func draw(_ dirty: NSRect) {
        NSColor.systemGreen.setFill()
        NSRect(x: 0, y: 0, width: bounds.width / 2, height: bounds.height).fill()
        // 右半什么都不画 → 保持完全透明
    }
}

final class D: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var under: NSWindow!, v1: NSWindow!, v2: NSWindow!, v3: NSWindow!, toggle: NSWindow!
    var web: WKWebView!
    var log: [String] = []

    func applicationDidFinishLaunching(_ n: Notification) {
        under = mk(NSRect(x: 300, y: 300, width: 700, height: 400), .normal)
        under.backgroundColor = .systemBlue; under.isOpaque = true

        // V1：透明窗口，contentView 是默认空视图
        v1 = mk(NSRect(x: 340, y: 340, width: 140, height: 160), .floating)
        v1.isOpaque = false; v1.backgroundColor = .clear

        // V2：透明窗口 + 背景透明 WKWebView，右半有不透明方块
        v2 = mk(NSRect(x: 500, y: 340, width: 140, height: 160), .floating)
        v2.isOpaque = false; v2.backgroundColor = .clear
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 140, height: 160),
                        configuration: WKWebViewConfiguration())
        web.setValue(false, forKey: "drawsBackground")
        web.navigationDelegate = self
        v2.contentView = web
        web.loadHTMLString("""
        <!DOCTYPE html><html><head><meta charset=utf-8><style>
        html,body{margin:0;background:transparent;width:140px;height:160px}
        #b{position:absolute;left:70px;top:0;width:70px;height:160px;background:#0f0}
        </style></head><body><div id=b></div></body></html>
        """, baseURL: nil)

        // V3：透明窗口 + 自绘视图（左半不透明、右半透明），完全不涉及 WebView
        v3 = mk(NSRect(x: 660, y: 340, width: 140, height: 160), .floating)
        v3.isOpaque = false; v3.backgroundColor = .clear
        v3.contentView = HalfView(frame: NSRect(x: 0, y: 0, width: 140, height: 160))

        // toggle：用来测 ignoresMouseEvents 的传播延迟
        toggle = mk(NSRect(x: 820, y: 340, width: 140, height: 160), .floating)
        toggle.backgroundColor = .systemOrange; toggle.isOpaque = true
        toggle.ignoresMouseEvents = false
    }

    func mk(_ r: NSRect, _ lv: NSWindow.Level) -> NSWindow {
        let w = NSWindow(contentRect: r, styleMask: [.borderless], backing: .buffered, defer: false)
        w.hasShadow = false; w.level = lv; w.orderFrontRegardless(); return w
    }

    func at(_ x: CGFloat, _ y: CGFloat) -> String {
        let n = NSWindow.windowNumber(at: CGPoint(x: x, y: y), belowWindowWithWindowNumber: 0)
        if n == v1.windowNumber { return "V1空透明窗" }
        if n == v2.windowNumber { return "V2WebView窗" }
        if n == v3.windowNumber { return "V3自绘窗" }
        if n == toggle.windowNumber { return "toggle窗" }
        if n == under.windowNumber { return "下层(穿透)" }
        return "其它#\(n)"
    }

    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.go() }
    }

    func go() {
        log.append("=== 诊断二：alpha 是否影响命中 ===")
        log.append("")
        log.append("V1 透明窗口 + 空 contentView（整窗都是透明像素）")
        log.append("   正中 → \(at(410, 420))")
        log.append("")
        log.append("V2 透明窗口 + 透明背景 WKWebView")
        log.append("   左半·透明像素 → \(at(535, 420))")
        log.append("   右半·绿色方块 → \(at(605, 420))")
        log.append("")
        log.append("V3 透明窗口 + 自绘视图（不经 WebView）")
        log.append("   左半·不透明 → \(at(695, 420))")
        log.append("   右半·透明   → \(at(765, 420))")
        log.append("")
        measureDelay()
    }

    /// 量 ignoresMouseEvents 从赋值到窗口服务器生效的延迟
    func measureDelay() {
        log.append("=== ignoresMouseEvents 的传播延迟 ===")
        let p = CGPoint(x: 890, y: 420)
        log.append("   赋值前          → \(at(p.x, p.y))")
        toggle.ignoresMouseEvents = true
        log.append("   赋值后立即查询   → \(at(p.x, p.y))")
        var checks: [(Double, String)] = []
        func probe(_ delays: [Double], _ i: Int) {
            if i >= delays.count {
                for (d, r) in checks { log.append("   赋值后 \(Int(d * 1000))ms → \(r)") }
                log.append("")
                log.append("=== 结束 ===")
                print(log.joined(separator: "\n"))
                NSApp.terminate(nil); return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + delays[i]) {
                checks.append((delays[i], self.at(p.x, p.y)))
                probe(delays, i + 1)
            }
        }
        probe([0.005, 0.02, 0.05, 0.15], 0)
    }
}
let a = NSApplication.shared
let d = D(); a.delegate = d
a.setActivationPolicy(.accessory)
a.run()
