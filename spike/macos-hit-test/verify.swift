// ticket 03 骨架的程序化验收
//
// 注意：会检测多实例。之前踩过坑 - 残留的旧实例只剩托盘窗口，
// 取「第一个匹配的进程」会量到僵尸进程，得出完全错误的结论。
import AppKit

let pets = NSWorkspace.shared.runningApplications.filter { a in
    let n = (a.localizedName ?? "")
    // 排除 WebKit 的辅助进程（Networking / Graphics and Media / Web Content）
    return n.lowercased().hasPrefix("cyber-cat") && !n.contains(" ")
}

guard !pets.isEmpty else { print("!! 没找到运行中的 cyber-cat"); exit(1) }
if pets.count > 1 {
    print("!! 检测到 \(pets.count) 个 cyber-cat 实例：\(pets.map { $0.processIdentifier })")
    print("   验收必须在单实例下进行，否则会量到残留进程。请先清理。")
    exit(1)
}
let app = pets[0]

print("=== 进程 ===")
print("  pid \(app.processIdentifier)")

print("")
print("=== 不占程序坞 ===")
let ok1 = app.activationPolicy == .accessory
print("  activationPolicy = \(ok1 ? "accessory ✓" : "非 accessory ✗")")

print("")
print("=== 窗口 ===")
let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
    print("  !! 拿不到窗口列表"); exit(1)
}
var pet: [String: Any]?
var tray: [String: Any]?
for w in list {
    guard let pid = w[kCGWindowOwnerPID as String] as? Int32, pid == app.processIdentifier,
          let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
    // 托盘图标在菜单栏层（25），且很小
    if (w[kCGWindowLayer as String] as? Int) == 25 { tray = w }
    else if b["Width"]! > 100 { pet = w }
}

if let t = tray {
    let b = t[kCGWindowBounds as String] as! [String: CGFloat]
    print("  托盘图标 ✓  \(Int(b["Width"]!))x\(Int(b["Height"]!)) @(\(Int(b["X"]!)),\(Int(b["Y"]!)))")
} else { print("  托盘图标 ✗ 未找到") }

if let p = pet {
    let b = p[kCGWindowBounds as String] as! [String: CGFloat]
    let layer = (p[kCGWindowLayer as String] as? Int) ?? -1
    let w = Int(b["Width"]!), h = Int(b["Height"]!)
    print("  宠物窗口 ✓  \(w)x\(h) @(\(Int(b["X"]!)),\(Int(b["Y"]!)))  layer=\(layer)")
    print("     尺寸符合预期(216x168)：\(w == 216 && h == 168 ? "✓" : "✗")")
    print("     置顶层级(>0)：\(layer > 0 ? "✓ layer=\(layer)" : "✗ layer=\(layer)")")
} else {
    print("  宠物窗口 ✗ 不在屏 - 若配了 visible:false，说明 pet_ready 没走通")
}
