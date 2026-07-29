// macOS 宠物窗口点击穿透 spike（ticket 01）
//
// 判定方式：用 CGEvent 合成真实点击，观察事件被谁收到。
//   - 宠物窗口（透明无边框置顶 + 背景透明 WKWebView）里由 JS 记录 mousedown
//   - 下层参照窗口由自定义 NSView 记录 mouseDown
// 两边都记录，因此「谁收到」是端到端的事实，不是对某个 API 语义的推断。
//
// 每组测试都带一个对照点（不透明方块中心）：若对照点都收不到，说明测量
// 工具本身失效，结果不可用。
import AppKit
import WebKit

final class RecordingView: NSView {
    var hits: [NSPoint] = []
    override func mouseDown(with e: NSEvent) { hits.append(e.locationInWindow) }
    override var isOpaque: Bool { true }
    override func draw(_ r: NSRect) { NSColor.systemBlue.setFill(); r.fill() }
}

final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var under: NSWindow!, pet: NSWindow!
    var web: WKWebView!, rec: RecordingView!
    let petFrame = NSRect(x: 420, y: 380, width: 400, height: 300)
    var log: [String] = []

    func applicationDidFinishLaunching(_ n: Notification) {
        rec = RecordingView(frame: .zero)
        under = NSWindow(contentRect: petFrame.insetBy(dx: -90, dy: -90),
                         styleMask: [.borderless], backing: .buffered, defer: false)
        under.contentView = rec
        under.isOpaque = true
        under.level = .normal
        under.orderFrontRegardless()

        pet = NSWindow(contentRect: petFrame, styleMask: [.borderless],
                       backing: .buffered, defer: false)
        pet.isOpaque = false
        pet.backgroundColor = .clear
        pet.hasShadow = false
        pet.level = .floating
        pet.ignoresMouseEvents = false

        web = WKWebView(frame: NSRect(origin: .zero, size: petFrame.size),
                        configuration: WKWebViewConfiguration())
        web.setValue(false, forKey: "drawsBackground")   // wry 在 transparent 时用的开关
        web.navigationDelegate = self
        pet.contentView = web
        pet.orderFrontRegardless()

        web.loadHTMLString("""
        <!DOCTYPE html><html><head><meta charset="utf-8"><style>
          html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:400px;height:300px}
          #box{position:absolute;left:100px;top:80px;width:200px;height:140px;background:#e0245e}
        </style></head><body><div id="box"></div><script>
          window.__hits = [];
          addEventListener('mousedown', e => window.__hits.push([e.clientX, e.clientY]));
        </script></body></html>
        """, baseURL: nil)
    }

    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.step0() }
    }

    /// CSS 坐标（窗口内左上原点）→ 屏幕坐标（全局左下原点）
    func screenPoint(_ cx: CGFloat, _ cy: CGFloat) -> CGPoint {
        CGPoint(x: petFrame.minX + cx, y: petFrame.maxY - cy)
    }

    /// 合成一次点击。CGEvent 用左上原点的全局坐标。
    func click(_ cx: CGFloat, _ cy: CGFloat) {
        let sp = screenPoint(cx, cy)
        let h = NSScreen.screens.first!.frame.height
        let p = CGPoint(x: sp.x, y: h - sp.y)
        for t in [CGEventType.leftMouseDown, .leftMouseUp] {
            CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: p, mouseButton: .left)?
                .post(tap: .cghidEventTap)
        }
    }

    func reset(_ done: @escaping () -> Void) {
        rec.hits = []
        web.evaluateJavaScript("window.__hits = []; 0") { _, _ in done() }
    }

    /// 点一下并回报谁收到
    func probe(_ label: String, _ cx: CGFloat, _ cy: CGFloat, _ done: @escaping () -> Void) {
        reset {
            self.click(cx, cy)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                self.web.evaluateJavaScript("JSON.stringify(window.__hits)") { v, _ in
                    let js = (v as? String) ?? "[]"
                    let webGot = js != "[]"
                    let underGot = !self.rec.hits.isEmpty
                    let who = webGot ? "宠物窗口(WKWebView)"
                        : underGot ? "下层窗口（穿透成功）" : "无人收到"
                    self.log.append("    \(label) → \(who)   [web=\(js) under=\(self.rec.hits.count)]")
                    done()
                }
            }
        }
    }

    func step0() {
        log.append("=== macOS 宠物窗口点击穿透 spike ===")
        log.append("系统：\(ProcessInfo.processInfo.operatingSystemVersionString)")
        log.append("")
        log.append("[A] 默认状态 ignoresMouseEvents = false")
        pet.ignoresMouseEvents = false
        probe("对照·不透明方块中心 (200,150)", 200, 150) {
            self.probe("透明区左上 ( 30, 30)", 30, 30) {
                self.probe("透明区右下 (370,270)", 370, 270) { self.step1() }
            }
        }
    }

    func step1() {
        log.append("")
        log.append("[B] ignoresMouseEvents = true")
        pet.ignoresMouseEvents = true
        pet.displayIfNeeded()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.probe("对照·不透明方块中心 (200,150)", 200, 150) {
                self.probe("透明区左上 ( 30, 30)", 30, 30) { self.step2() }
            }
        }
    }

    func step2() {
        log.append("")
        log.append("[C] 动态开关：进入猫身范围前关闭穿透，离开时开启")
        pet.ignoresMouseEvents = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.probe("关闭穿透后点方块 (200,150)", 200, 150) {
                self.pet.ignoresMouseEvents = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    self.probe("开启穿透后点透明区 ( 30, 30)", 30, 30) { self.finish() }
                }
            }
        }
    }

    func finish() {
        log.append("")
        log.append("=== 结束 ===")
        print(log.joined(separator: "\n"))
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
let d = App()
app.delegate = d
app.setActivationPolicy(.accessory)
app.run()
