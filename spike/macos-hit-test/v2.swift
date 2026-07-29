import AppKit
let apps = NSWorkspace.shared.runningApplications.filter {
  ($0.bundleIdentifier ?? "") == "app.cybercat.pet" }
guard let a = apps.first else { print("!! 未找到打包版进程"); exit(1) }
print("  pid \(a.processIdentifier)  policy=\(a.activationPolicy == .accessory ? "accessory ✓" : "✗")")
let o: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let list = CGWindowListCopyWindowInfo(o, kCGNullWindowID) as? [[String: Any]] ?? []
for w in list {
  guard let pid = w[kCGWindowOwnerPID as String] as? Int32, pid == a.processIdentifier,
        let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
  let l = (w[kCGWindowLayer as String] as? Int) ?? -1
  print("  窗口 \(Int(b["Width"]!))x\(Int(b["Height"]!)) @(\(Int(b["X"]!)),\(Int(b["Y"]!))) layer=\(l)")
}
