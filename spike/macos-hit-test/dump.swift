import AppKit
let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { exit(1) }
print("在屏窗口共 \(list.count) 个。筛出尺寸接近 216x168 或 owner 含 cyber 的：")
for w in list {
    let owner = (w[kCGWindowOwnerName as String] as? String) ?? "?"
    let pid = (w[kCGWindowOwnerPID as String] as? Int32) ?? -1
    guard let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
    let ww = Int(b["Width"]!), hh = Int(b["Height"]!)
    let isCat = owner.lowercased().contains("cyber") || (abs(ww-216) < 40 && abs(hh-168) < 40)
    if isCat {
        let layer = (w[kCGWindowLayer as String] as? Int) ?? -1
        print("  owner=\(owner) pid=\(pid) layer=\(layer) \(ww)x\(hh) @(\(Int(b["X"]!)),\(Int(b["Y"]!)))")
    }
}
print("")
print("所有 owner 名字里含 cyber / CYBER 的进程：")
for a in NSWorkspace.shared.runningApplications {
    let n = a.localizedName ?? ""
    if n.lowercased().contains("cyber") {
        print("  \(n)  pid=\(a.processIdentifier)  policy=\(a.activationPolicy.rawValue)")
    }
}
