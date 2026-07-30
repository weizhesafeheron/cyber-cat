/**
 * 用户的开关。这一版只有一个：安静模式。
 *
 * **单独一份存档**（settings.json，见 src-tauri/src/save.rs 里 SETTINGS_FILE 的注释）：
 * 开关不能塞进 world.json，因为世界层必须可离线回放（ADR 0001），而开关不是时间的函数。
 *
 * 这一层刻意做得很小：读、写、翻转。**没有任何默认值以外的迁移逻辑** -
 * 存档读不出来就当成「没开」，因为那是唯一安全的默认（默认开着安静模式的猫
 * 会被当成坏了）。
 */

export interface Settings {
  /** 安静模式：猫只趴着休息，不响应光标、不爬前台窗口、不主动闲逛。 */
  readonly quiet: boolean;
}

export const DEFAULT_SETTINGS: Settings = { quiet: false };

/**
 * 把读到的 JSON 变成 Settings。
 *
 * **任何不认识的形状都退回默认值，不抛错。** 这份文件里没有不可再生的东西
 * （与 memorial.json 相反），而一个开关读坏了就让整只猫起不来是不成比例的。
 * 未来加新开关时，老存档缺字段也走这条路 - 所以逐字段取值，不整份 as。
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const quiet = (raw as { quiet?: unknown }).quiet;
  return { quiet: quiet === true };
}

export function withQuiet(settings: Settings, quiet: boolean): Settings {
  if (settings.quiet === quiet) return settings;
  return { ...settings, quiet };
}
