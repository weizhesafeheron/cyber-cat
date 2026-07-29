// 发布构建下不弹出 Windows 的控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cyber_cat_lib::run()
}
