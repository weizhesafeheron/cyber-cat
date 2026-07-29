// #5 真机验收用的「下层接点击」窗口。
// 放在宠物窗口正下方，把收到的每一次点击连时间与坐标打出来。
// 这样就能区分三种结果：宠物窗口收到了 / 下层收到了（穿透成功）/ 谁都没收到。
import AppKit

final class Catcher: NSView {
    var n = 0
    override var isOpaque: Bool { true }
    override func draw(_ r: NSRect) {
        NSColor(calibratedRed: 0.10, green: 0.16, blue: 0.30, alpha: 1).setFill(); r.fill()
        let s = "下层接点击窗口\n收到 \(n) 次" as NSString
        s.draw(in: NSRect(x: 12, y: bounds.height - 60, width: 320, height: 50),
               withAttributes: [.foregroundColor: NSColor.white,
                                .font: NSFont.systemFont(ofSize: 15)])
    }
    override func mouseDown(with e: NSEvent) {
        n += 1
        let p = e.locationInWindow
        print(String(format: "  [下层收到点击 #%d] 窗口内坐标 (%.0f, %.0f)", n, p.x, p.y))
        fflush(stdout)
        needsDisplay = true
    }
}

final class App: NSObject, NSApplicationDelegate {
    var win: NSWindow!
    func applicationDidFinishLaunching(_ n: Notification) {
        // 宠物窗口在 (480,420) 240x190（逻辑，左上原点）。
        // NSWindow 用左下原点，主屏高 1080 → y = 1080 - 420 - 190 = 470
        win = NSWindow(contentRect: NSRect(x: 440, y: 430, width: 320, height: 270),
                       styleMask: [.titled], backing: .buffered, defer: false)
        win.title = "点击接收器（宠物窗口应盖在它上面）"
        win.contentView = Catcher(frame: .zero)
        win.level = .normal
        win.orderFrontRegardless()
        print("下层窗口已就位：屏幕逻辑区域 x[440,760] y_topleft[380,650]")
        print("宠物窗口应在 x[480,720] y[420,610]")
        print("请点击：①猫身上  ②猫旁边的透明区  各若干次")
        print("Ctrl+C 结束")
        fflush(stdout)
    }
}
let a = NSApplication.shared
let d = App(); a.delegate = d
a.setActivationPolicy(.accessory)
a.run()
