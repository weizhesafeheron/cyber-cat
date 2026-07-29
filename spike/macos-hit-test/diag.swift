// 诊断：windowNumber(at:) 到底反映什么？
import AppKit
import WebKit

final class D: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var under: NSWindow!, ignoreWin: NSWindow!, alphaWin: NSWindow!
    var web: WKWebView!
    let f = NSRect(x: 500, y: 400, width: 300, height: 200)

    func applicationDidFinishLaunching(_ n: Notification) {
        // 下层：不透明
        under = mk(f.insetBy(dx: -60, dy: -60), level: .normal)
        under.backgroundColor = .systemBlue
        under.isOpaque = true

        // 一号：从创建起就 ignoresMouseEvents = true，纯色不透明内容
        ignoreWin = mk(NSRect(x: f.minX, y: f.minY, width: 140, height: 200), level: .floating)
        ignoreWin.backgroundColor = .systemRed
        ignoreWin.isOpaque = true
        ignoreWin.ignoresMouseEvents = true

        // 二号：透明窗口 + 背景透明 WKWebView，内容里只有右半边有不透明方块
        alphaWin = mk(NSRect(x: f.minX + 150, y: f.minY, width: 150, height: 200), level: .floating)
        alphaWin.isOpaque = false
        alphaWin.backgroundColor = .clear
        alphaWin.ignoresMouseEvents = false
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 150, height: 200),
                        configuration: WKWebViewConfiguration())
        web.setValue(false, forKey: "drawsBackground")
        web.navigationDelegate = self
        alphaWin.contentView = web
        web.loadHTMLString("""
        <!DOCTYPE html><html><head><meta charset=utf-8><style>
        html,body{margin:0;background:transparent;width:150px;height:200px}
        #b{position:absolute;left:75px;top:0;width:75px;height:200px;background:#0f0}
        </style></head><body><div id=b></div></body></html>
        """, baseURL: nil)
    }

    func mk(_ r: NSRect, level: NSWindow.Level) -> NSWindow {
        let w = NSWindow(contentRect: r, styleMask: [.borderless], backing: .buffered, defer: false)
        w.hasShadow = false
        w.level = level
        w.orderFrontRegardless()
        return w
    }

    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.go() }
    }

    func name(_ p: CGPoint) -> String {
        let n = NSWindow.windowNumber(at: p, belowWindowWithWindowNumber: 0)
        if n == ignoreWin.windowNumber { return "一号(ignoresMouseEvents=true)" }
        if n == alphaWin.windowNumber  { return "二号(透明窗口)" }
        if n == under.windowNumber     { return "下层(不透明)" }
        return "其它#\(n)"
    }

    func go() {
        print("=== 诊断 windowNumber(at:) 的语义 ===")
        print("一号 #\(ignoreWin.windowNumber)  二号 #\(alphaWin.windowNumber)  下层 #\(under.windowNumber)")
        print("")
        print("Q1 创建时即 ignoresMouseEvents=true 的不透明窗口，会被跳过吗？")
        print("   一号窗口正中 → \(name(CGPoint(x: f.minX + 70, y: f.minY + 100)))")
        print("")
        print("Q2 透明窗口里，透明像素与不透明像素的差别？")
        print("   二号·透明半边 → \(name(CGPoint(x: f.minX + 185, y: f.minY + 100)))")
        print("   二号·绿块半边 → \(name(CGPoint(x: f.minX + 260, y: f.minY + 100)))")
        print("")
        print("判读：Q1 若返回下层 → 本方法反映事件路由；若返回一号 → 只反映几何。")
        print("      Q2 两行不同 → 本方法考虑 alpha；相同 → 不考虑。")
        NSApp.terminate(nil)
    }
}
let a = NSApplication.shared
let d = D(); a.delegate = d
a.setActivationPolicy(.accessory)
a.run()
