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

/// 桌面挂件的摆放。
///
/// **与 world.json 分开是刻意的**：摆放是屏幕坐标，而世界层必须平台无关、可回放
/// （ADR 0001）。另一头也说得通 - 家具的生命周期比猫长，换一只猫不该让用户
/// 重新摆一遍食盆。
const PROPS_FILE: &str = "props.json";

/// 猫的档案：养过的所有猫。
///
/// **第三份文件，也是刻意的**（[ADR 0010](../../docs/adr/0010-memorial-archive-separate-save.md)）。
/// world.json 是「当前这只猫」，领养新猫时会被整份覆盖；档案的生命周期比任何一只猫
/// 都长，塞进 world.json 等于每换一只猫就把历任猫抹掉一次。
///
/// 这份文件比另外两份要紧：里面的猫都死了，坏掉就再也演化不回来。
const MEMORIAL_FILE: &str = "memorial.json";

/// 用户的开关（这一版只有安静模式）。
///
/// **第四份文件。** 不能塞进 world.json：世界层必须是纯函数且可离线回放
/// （ADR 0001），而安静模式不是时间的函数 - 它是用户在某一刻拨动的开关，
/// 塞进去会让「同一段时间推演出同一个结果」这条不变量失效。
/// 也不能塞进 props.json：那份是家具的摆放，与「猫要不要安静」是两件事，
/// 而且挂件的写盘是节流的（拖动时每两秒一次），开关不该跟着那个节奏走。
const SETTINGS_FILE: &str = "settings.json";

fn data_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    // 本地验收可以指向一次性的隔离目录，重走首次领养而不删除用户的正式存档。
    // 正式构建没有这个环境变量，仍只使用系统应用数据目录。
    let dir = match std::env::var_os("CYBER_CAT_DATA_DIR") {
        Some(path) => PathBuf::from(path),
        None => app
            .path()
            .app_data_dir()
            .map_err(|e| format!("取应用数据目录失败：{e}"))?,
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建应用数据目录 {dir:?} 失败：{e}"))?;
    Ok(dir.join(name))
}

/// 写一份存档。
///
/// 先写临时文件再改名，不直接覆写。**这一步不是洁癖**：覆写过程中进程被杀
/// （关机、强退）会留下半截 JSON，下次启动解析失败就等于丢了这只猫。
/// 改名在同一个文件系统内是原子的，最坏情况也只是丢掉最后一次保存。
fn write_atomic(path: &PathBuf, contents: String) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, contents).map_err(|e| format!("写临时存档 {tmp:?} 失败：{e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("替换存档 {path:?} 失败：{e}"))?;
    Ok(())
}

/// 读一份存档。文件不存在返回 None（首次启动），读失败则报错 - 不静默当成没有，
/// 否则一次磁盘故障会表现成「猫不见了，来了只新的」。
fn read_optional(path: &PathBuf) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取存档 {path:?} 失败：{e}")),
    }
}

#[tauri::command]
pub fn save_world(app: AppHandle, contents: String) -> Result<(), String> {
    write_atomic(&data_path(&app, SAVE_FILE)?, contents)
}

#[tauri::command]
pub fn load_world(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(&data_path(&app, SAVE_FILE)?)
}

#[tauri::command]
pub fn save_props(app: AppHandle, contents: String) -> Result<(), String> {
    write_atomic(&data_path(&app, PROPS_FILE)?, contents)
}

#[tauri::command]
pub fn load_props(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(&data_path(&app, PROPS_FILE)?)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, contents: String) -> Result<(), String> {
    write_atomic(&data_path(&app, SETTINGS_FILE)?, contents)
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(&data_path(&app, SETTINGS_FILE)?)
}

#[tauri::command]
pub fn save_memorial(app: AppHandle, contents: String) -> Result<(), String> {
    write_atomic(&data_path(&app, MEMORIAL_FILE)?, contents)
}

/// 读猫的档案。**告别页窗口也会调它**（它是档案的唯一读者）。
#[tauri::command]
pub fn load_memorial(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(&data_path(&app, MEMORIAL_FILE)?)
}
