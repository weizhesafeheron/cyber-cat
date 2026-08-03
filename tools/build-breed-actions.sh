#!/bin/sh

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE_ROOT=${1:-/private/tmp/cyber-cat-breed-art/generated/sheets}
BREED_LIST=${2:-'orange black ragdoll devon amshort aby'}
EDGE_SOURCE_ROOT=${3:-}
EDGE_ONLY=${EDGE_ONLY:-0}
FRAME_W=288
FRAME_H=224
SHEET_W=1728
SHEET_H=1120
# 203 会在 4× point 下采样后稳定落到逻辑 y=50；202 对细脚像素可能被跳过。
GROUND_Y=203

if command -v magick >/dev/null 2>&1; then
  IM=magick
elif command -v convert >/dev/null 2>&1; then
  IM=convert
else
  echo "build-breed-actions: ImageMagick is required" >&2
  exit 1
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/cyber-cat-breed-actions.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

normalise_frame() {
  source=$1
  action=$2
  frame=$3
  output=$4
  "$IM" "$source" -channel A -threshold 50% +channel "$WORK/source-binary.png"
  # 先只保留格内最大的前景主体。这样相邻格露进来的尾巴、底边色点或抠图残片
  # 不会参与外接框计算，把真正的猫错误地向上/向侧面推走。
  "$IM" "$WORK/source-binary.png" -alpha extract \
    -define connected-components:keep-top=1 \
    -define connected-components:mean-color=true -connected-components 4 \
    "$WORK/source-main-mask.png"
  mask_max=$("$IM" "$WORK/source-main-mask.png" -format '%[fx:maxima]' info:)
  if awk -v value="$mask_max" 'BEGIN { exit !(value > 0.5) }'; then
    "$IM" "$WORK/source-binary.png" "$WORK/source-main-mask.png" -alpha off \
      -compose CopyOpacity -composite "$WORK/source-main.png"
    source="$WORK/source-main.png"
  else
    # 顶部接触边界的 held 或极端腾空格偶尔会让组件标记器无前景；
    # 这类格子没有地面碎屑，保留已二值化的原始前景更安全。
    source="$WORK/source-binary.png"
  fi
  bounds=$("$IM" "$source" -format '%@' info:)
  size=${bounds%%+*}
  rest=${bounds#*+}
  width=${size%%x*}
  height=${size#*x}
  left=${rest%%+*}
  top=${rest#*+}

  if [ "$width" -le 0 ] || [ "$height" -le 0 ]; then
    echo "empty generated frame: $action/$frame" >&2
    exit 1
  fi

  "$IM" "$source" -crop "${width}x${height}+${left}+${top}" +repage "$WORK/content.png"

  # 落地第 3 格就是物理接触帧：高挑品种也必须在这一格明确压缩，而不是站直后
  # 再播放蹲下，形成视觉延迟。仅压低超过阈值的接触姿态，不放大已合格的猫。
  if [ "$action" = land ] && [ "$frame" -eq 2 ] && [ "$height" -gt 116 ]; then
    "$IM" "$WORK/content.png" -resize "${width}x116!" "$WORK/content-scaled.png"
    mv "$WORK/content-scaled.png" "$WORK/content.png"
    height=116
  fi

  target_bottom=$GROUND_Y
  if [ "$action" = pounce ]; then
    case "$frame" in
      2) target_bottom=187 ;;
      3) target_bottom=171 ;;
    esac
  fi

  # 非 held 动作顶部必须留两个像素安全区。仅在生成图超高时等比缩小；
  # 常规帧不会逐格放大，避免呼吸和眨眼产生缩放抖动。
  max_height=$((target_bottom - 2))
  if [ "$action" != held ] && [ "$height" -gt "$max_height" ]; then
    "$IM" "$WORK/content.png" -resize "x${max_height}" "$WORK/content-scaled.png"
    mv "$WORK/content-scaled.png" "$WORK/content.png"
    width=$("$IM" identify -format '%w' "$WORK/content.png")
    height=$("$IM" identify -format '%h' "$WORK/content.png")
  fi

  x=$(((FRAME_W - width) / 2))
  y=$((target_bottom - height + 1))
  if [ "$x" -lt 8 ]; then
    # 4× point 下采样后左右仍至少各留一个逻辑像素，防止相邻格串帧。
    fit_width=$((FRAME_W - 16))
    "$IM" "$WORK/content.png" -resize "${fit_width}x" "$WORK/content-scaled.png"
    mv "$WORK/content-scaled.png" "$WORK/content.png"
    width=$("$IM" identify -format '%w' "$WORK/content.png")
    height=$("$IM" identify -format '%h' "$WORK/content.png")
    x=$(((FRAME_W - width) / 2))
    y=$((target_bottom - height + 1))
  fi

  "$IM" -size "${FRAME_W}x${FRAME_H}" canvas:none \
    "$WORK/content.png" -geometry "+${x}+${y}" -compose over -composite \
    -channel A -threshold 50% +channel "$WORK/composited.png"

  # 重采样可能让最外一圈低 alpha 像素消失。以最终二值结果再对一次脚底，
  # 让细腿品种也严格踩在同一物理地面线上。
  final_bounds=$("$IM" "$WORK/composited.png" -format '%@' info:)
  final_size=${final_bounds%%+*}
  final_rest=${final_bounds#*+}
  final_height=${final_size#*x}
  final_top=${final_rest#*+}
  final_bottom=$((final_top + final_height - 1))
  delta_y=$((target_bottom - final_bottom))
  "$IM" "$WORK/composited.png" -roll "+0+${delta_y}" "$WORK/aligned.png"

  # 丢掉生成图偶发的孤立色点，并只在 alpha 轮廓两像素内清除洋红抠图溢色。
  # 内部的粉鼻、耳廓和舌头不在轮廓蒙版中，颜色不会被误伤。
  "$IM" "$WORK/aligned.png" -alpha extract -threshold 50% \
    -define connected-components:area-threshold=8 \
    -define connected-components:mean-color=true -connected-components 4 \
    "$WORK/component-mask.png"
  "$IM" "$WORK/aligned.png" "$WORK/component-mask.png" -alpha off \
    -compose CopyOpacity -composite "$WORK/components-clean.png"
  "$IM" "$WORK/components-clean.png" -alpha extract -morphology EdgeIn Diamond:2 \
    "$WORK/edge-mask.png"
  # 高饱和洋红有时会被模型画进腿部内部，先全局清理接近抠图键色的像素；
  # 普通粉色鼻头/耳廓不满足 2.5× 通道优势，因此会保留。
  "$IM" "$WORK/components-clean.png" -channel RGB \
    -fx '(r>0.30&&b>0.30&&r>g*2.5&&b>g*2.5)?g:u' +channel \
    "$WORK/key-clean.png"
  "$IM" "$WORK/key-clean.png" -channel RGB \
    -fx '(r>g*1.20&&b>g*1.20)?g:u' +channel "$WORK/despilled.png"
  "$IM" "$WORK/despilled.png" "$WORK/edge-mask.png" -alpha off \
    -compose CopyOpacity -composite "$WORK/despilled-edge.png"
  "$IM" "$WORK/key-clean.png" "$WORK/despilled-edge.png" \
    -compose over -composite "$output"
}

build_group() {
  breed=$1
  group=$2
  actions=$3
  input="$SOURCE_ROOT/$breed-$group.png"
  [ -f "$input" ] || { echo "missing generated sheet: $input" >&2; exit 1; }

  # 生成图负责品种美术；这里把网格、透明底与尺寸重新变成确定性资源。
  "$IM" "$input" -resize "${SHEET_W}x${SHEET_H}!" -alpha on \
    -fuzz 18% -transparent '#ff00ff' \
    -channel A -threshold 50% +channel "$WORK/$breed-$group.png"

  row=0
  for action in $actions; do
    frame=0
    while [ "$frame" -lt 6 ]; do
      "$IM" "$WORK/$breed-$group.png" \
        -crop "${FRAME_W}x${FRAME_H}+$((frame * FRAME_W))+$((row * FRAME_H))" \
        +repage "$WORK/source-$frame.png"
      normalise_frame "$WORK/source-$frame.png" "$action" "$frame" "$WORK/frame-$frame.png"
      frame=$((frame + 1))
    done

    mkdir -p "$ROOT/public/pets/$breed/actions"
    "$IM" "$WORK/frame-0.png" "$WORK/frame-1.png" "$WORK/frame-2.png" \
      "$WORK/frame-3.png" "$WORK/frame-4.png" "$WORK/frame-5.png" +append \
      -define webp:lossless=true "$ROOT/public/pets/$breed/actions/$action.webp"
    row=$((row + 1))
  done
}

# 修复生成模型把“窄边缘”画成木板或窗台的情况。覆盖源只包含横向排列的
# 六只猫，可以有任意画布尺寸；这里按六等分取格，再复用正式的去底、主体提取、
# 安全边距与脚底锚定流程。这样修 edge 不会重写其他十四个已验收动作。
build_edge_override() {
  breed=$1
  input="$EDGE_SOURCE_ROOT/$breed.png"
  [ -f "$input" ] || { echo "missing clean edge strip: $input" >&2; exit 1; }

  source_w=$("$IM" identify -format '%w' "$input")
  source_h=$("$IM" identify -format '%h' "$input")
  frame=0
  while [ "$frame" -lt 6 ]; do
    left=$((frame * source_w / 6))
    right=$(((frame + 1) * source_w / 6))
    cell_w=$((right - left))
    "$IM" "$input" -crop "${cell_w}x${source_h}+${left}+0" +repage \
      -alpha on -fuzz 18% -transparent '#ff00ff' \
      -channel A -threshold 50% +channel "$WORK/edge-source-$frame.png"
    normalise_frame "$WORK/edge-source-$frame.png" edge "$frame" "$WORK/edge-$frame.png"
    frame=$((frame + 1))
  done

  mkdir -p "$ROOT/public/pets/$breed/actions"
  "$IM" "$WORK/edge-0.png" "$WORK/edge-1.png" "$WORK/edge-2.png" \
    "$WORK/edge-3.png" "$WORK/edge-4.png" "$WORK/edge-5.png" +append \
    -define webp:lossless=true "$ROOT/public/pets/$breed/actions/edge.webp"
}

alpha_area() {
  action=$1
  frame=$2
  "$IM" "$ROOT/public/pets/$breed/actions/$action.webp" \
    -crop "${FRAME_W}x${FRAME_H}+$((frame * FRAME_W))+0" +repage \
    -filter point -resize '72x56!' -alpha extract -threshold 12.5% \
    -format '%[fx:int(mean*w*h)]' info:
}

normalise_idle_transition() {
  breed=$1
  entry_area=$((( $(alpha_area walk 0) + $(alpha_area pounce 0) + $(alpha_area land 0) ) / 3))
  limit=$((entry_area * 104 / 100))
  max_idle=0
  frame=0
  while [ "$frame" -lt 6 ]; do
    area=$(alpha_area idle "$frame")
    [ "$area" -gt "$max_idle" ] && max_idle=$area
    frame=$((frame + 1))
  done
  [ "$max_idle" -le "$limit" ] && return

  # 同一百分比缩小六格，避免逐格归一造成新的呼吸缩放；预留 3% 给点采样量化。
  percent=$(awk -v limit="$limit" -v area="$max_idle" \
    'BEGIN { value=int(sqrt(limit/area)*97); if (value < 1) value=1; print value }')
  frame=0
  while [ "$frame" -lt 6 ]; do
    "$IM" "$ROOT/public/pets/$breed/actions/idle.webp" \
      -crop "${FRAME_W}x${FRAME_H}+$((frame * FRAME_W))+0" +repage \
      -trim +repage -resize "${percent}%" -gravity center -background none \
      -extent "${FRAME_W}x${FRAME_H}" "$WORK/idle-scaled.png"
    normalise_frame "$WORK/idle-scaled.png" idle "$frame" "$WORK/idle-$frame.png"
    frame=$((frame + 1))
  done
  "$IM" "$WORK/idle-0.png" "$WORK/idle-1.png" "$WORK/idle-2.png" \
    "$WORK/idle-3.png" "$WORK/idle-4.png" "$WORK/idle-5.png" +append \
    -define webp:lossless=true "$ROOT/public/pets/$breed/actions/idle.webp"
}

lock_lower_body() {
  breed=$1
  action=$2
  strip="$ROOT/public/pets/$breed/actions/$action.webp"
  target_center=0
  frame=0
  while [ "$frame" -lt 6 ]; do
    "$IM" "$strip" -crop "${FRAME_W}x${FRAME_H}+$((frame * FRAME_W))+0" \
      +repage "$WORK/lock-source-$frame.png"
    bounds=$("$IM" "$WORK/lock-source-$frame.png" -crop '288x96+0+128' +repage \
      -format '%@' info:)
    size=${bounds%%+*}
    rest=${bounds#*+}
    width=${size%%x*}
    left=${rest%%+*}
    center=$((left * 2 + width))
    if [ "$frame" -eq 0 ]; then
      target_center=$center
    fi
    delta=$(((target_center - center) / 2))
    "$IM" "$WORK/lock-source-$frame.png" -roll "+${delta}+0" "$WORK/lock-$frame.png"
    frame=$((frame + 1))
  done
  "$IM" "$WORK/lock-0.png" "$WORK/lock-1.png" "$WORK/lock-2.png" \
    "$WORK/lock-3.png" "$WORK/lock-4.png" "$WORK/lock-5.png" +append \
    -define webp:lossless=true "$strip"
}

ensure_min_width() {
  breed=$1
  action=$2
  target_frame=$3
  minimum=$4
  strip="$ROOT/public/pets/$breed/actions/$action.webp"
  current=$("$IM" "$strip" -crop "${FRAME_W}x${FRAME_H}+$((target_frame * FRAME_W))+0" \
    +repage -filter point -resize '72x56!' -channel A -threshold 12.5% +channel \
    -format '%@' info:)
  size=${current%%+*}
  width=${size%%x*}
  [ "$width" -ge "$minimum" ] && return

  percent=$(awk -v target="$minimum" -v width="$width" \
    'BEGIN { print int(target/width*105 + 0.5) }')
  frame=0
  while [ "$frame" -lt 6 ]; do
    "$IM" "$strip" -crop "${FRAME_W}x${FRAME_H}+$((frame * FRAME_W))+0" \
      +repage "$WORK/width-$frame.png"
    if [ "$frame" -eq "$target_frame" ]; then
      "$IM" "$WORK/width-$frame.png" -trim +repage -resize "${percent}%" \
        -gravity center -background none -extent "${FRAME_W}x${FRAME_H}" \
        "$WORK/width-scaled.png"
      normalise_frame "$WORK/width-scaled.png" "$action" "$frame" "$WORK/width-$frame.png"
    fi
    frame=$((frame + 1))
  done
  "$IM" "$WORK/width-0.png" "$WORK/width-1.png" "$WORK/width-2.png" \
    "$WORK/width-3.png" "$WORK/width-4.png" "$WORK/width-5.png" +append \
    -define webp:lossless=true "$strip"
}

if [ "$EDGE_ONLY" -eq 1 ]; then
  [ -n "$EDGE_SOURCE_ROOT" ] || {
    echo 'EDGE_ONLY=1 requires a clean edge source directory as the third argument' >&2
    exit 1
  }
  for breed in $BREED_LIST; do
    build_edge_override "$breed"
    echo "$breed edge asset: rebuilt"
  done
  exit 0
fi

for breed in $BREED_LIST; do
  build_group "$breed" daily 'idle sit lie sleep groom'
  build_group "$breed" motion 'walk pounce land leapUp leapDown'
  build_group "$breed" expressive 'eat yawn stretch held edge'
  if [ -n "$EDGE_SOURCE_ROOT" ] && [ -f "$EDGE_SOURCE_ROOT/$breed.png" ]; then
    build_edge_override "$breed"
  fi
  normalise_idle_transition "$breed"
  for action in idle lie sleep yawn groom; do
    lock_lower_body "$breed" "$action"
  done
  ensure_min_width "$breed" pounce 0 47
  ensure_min_width "$breed" pounce 5 38
  ensure_min_width "$breed" leapUp 0 47
  ensure_min_width "$breed" leapUp 5 40
  ensure_min_width "$breed" leapDown 5 40
  echo "$breed action assets: built"
done
