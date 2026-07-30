#!/usr/bin/env sh
#
# 在 macOS 上类型检查 Windows 那一半代码。
#
# 为什么需要它：platform.rs 里 `#[cfg(target_os = "windows")]` 的那几百行
# （DWM 矩形、GetDpiForWindow 换算、SHQueryUserNotificationState、点击穿透）
# 在这台机器上**一次都没被编译过**。写错一个类型名要等到协作者第一次在 Windows 上
# 构建才暴露，而那是排期里最贵的一个等待环节（issue #16）。
#
# 这不是构建，也不能代替真机验收：
# - `cargo check` 不链接，所以不产出任何可运行的东西；
# - 它检查不出运行时行为（DWM 到底给什么矩形、穿透到底生效没有）。
#
# RC 那个桩是怎么回事：
# tauri-build 在目标是 Windows 时一定会调 tauri-winres 去编译资源文件（图标、
# 版本信息），而它在 macOS 上找 `llvm-rc`，没有就 panic，整个构建脚本挂掉。
# embed_resource 支持用 `RC` 环境变量指定资源编译器，所以这里塞一个只负责退出 0
# 的桩。**桩必须叫 llvm-rc**：embed_resource 靠文件名判断资源编译器的品种，
# 名字对不上会报 `Unknown RC compiler variant`。
# 产出的 .lib 不存在没关系 - `cargo check` 不链接，那个文件用不上。
# 真机上有 MSVC 的 rc.exe，那条路走的是正经资源编译。
set -eu

TARGET=x86_64-pc-windows-msvc

if ! rustup target list --installed | grep -q "$TARGET"; then
  echo "缺少目标 $TARGET，先跑：rustup target add $TARGET" >&2
  exit 1
fi

STUB_DIR=$(mktemp -d)
trap 'rm -rf "$STUB_DIR"' EXIT
cat > "$STUB_DIR/llvm-rc" <<'STUB'
#!/usr/bin/env sh
# 资源编译器的桩。只在 macOS 上做 cargo check 时用，见 tools/check-windows.sh。
#
# embed_resource 用 `-V /?` 探一次品种，并按 stdout 的开头判断：
#   "GNU windres" → windres；"OVERVIEW: Resource Converter" → llvm-rc。
# 所以这里必须冒充 llvm-rc。帮助里带上 no-preprocess 是关键：
# 认得这个开关它就会加 -no-preprocess，从而**跳过用 C 预处理器处理 .rc**，
# 而那一步在 macOS 上会因为找不到 windows.h 而真的失败。
case " $* " in
  *" -V "*|*" /? "*)
    echo "OVERVIEW: Resource Converter (stub)"
    echo "  -no-preprocess"
    exit 0
    ;;
esac
exit 0
STUB
chmod +x "$STUB_DIR/llvm-rc"

cd "$(dirname "$0")/../src-tauri"
RC="$STUB_DIR/llvm-rc" cargo check --target "$TARGET" "$@"
