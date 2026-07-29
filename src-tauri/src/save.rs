//! 存档读写。
//!
//! 世界层是纯函数，它既不知道文件也不知道时钟；把 world 变成字节、把字节放到
//! 应用数据目录里，是平台层唯一的职责。所以这里只有两个命令，且都只搬文本 -
//! JSON 的结构与校验都在 TypeScript 侧（src/world/save.ts）。
//!
//! 刻意没有引入任何 Tauri 插件：读写一个 JSON 文件用得上的东西标准库都有，
//! 多一个插件就多一份权限配置与版本约束。

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SAVE_FILE: &str = "world.json";

fn save_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建应用数据目录 {dir:?} 失败：{e}"))?;
    Ok(dir.join(SAVE_FILE))
}

/// 写存档。
///
/// 先写临时文件再改名，不直接覆写。**这一步不是洁癖**：覆写过程中进程被杀
/// （关机、强退）会留下半截 JSON，下次启动解析失败就等于丢了这只猫。
/// 改名在同一个文件系统内是原子的，最坏情况也只是丢掉最后一次保存。
#[tauri::command]
pub fn save_world(app: AppHandle, contents: String) -> Result<(), String> {
    let path = save_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents).map_err(|e| format!("写临时存档 {tmp:?} 失败：{e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("替换存档 {path:?} 失败：{e}"))?;
    Ok(())
}

/// 读存档。没有存档返回 None（首次启动），读失败则报错 - 不静默当成没有，
/// 否则一次磁盘故障会表现成「猫不见了，来了只新的」。
#[tauri::command]
pub fn load_world(app: AppHandle) -> Result<Option<String>, String> {
    let path = save_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取存档 {path:?} 失败：{e}")),
    }
}
