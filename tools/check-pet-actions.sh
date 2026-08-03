#!/bin/sh

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FRAME_W=288
FRAME_H=224
LOGICAL_W=72
LOGICAL_H=56
GROUND=50
WORK=$(mktemp -d "${TMPDIR:-/tmp}/cyber-cat-pet-check.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

if command -v magick >/dev/null 2>&1; then
  IM=magick
elif command -v convert >/dev/null 2>&1; then
  IM=convert
else
  echo "check-pet-actions: ImageMagick is required" >&2
  exit 1
fi

alpha_bounds() {
  action=$1
  frame=$2
  x=$((frame * FRAME_W))
  "$IM" "$ASSETS/$action.webp" \
    -crop "${FRAME_W}x${FRAME_H}+${x}+0" +repage \
    -filter point -resize "${LOGICAL_W}x${LOGICAL_H}!" \
    -channel A -threshold 12.5% +channel \
    -format '%@' info:
}

alpha_bounds_physical() {
  action=$1
  frame=$2
  x=$((frame * FRAME_W))
  "$IM" "$ASSETS/$action.webp" \
    -crop "${FRAME_W}x${FRAME_H}+${x}+0" +repage \
    -channel A -threshold 12.5% +channel \
    -format '%@' info:
}

bottom_of() {
  # 先在原始分辨率取脚底。细腿品种的末端像素可能恰好落在 4× point
  # 下采样采样点之间，不能因此被误判为悬空。
  bounds=$(alpha_bounds_physical "$1" "$2")
  size=${bounds%%+*}
  rest=${bounds#*+}
  height=${size#*x}
  y=${rest#*+}
  physical_bottom=$((y + height - 1))
  physical_logical=$((physical_bottom * LOGICAL_H / FRAME_H))

  logical_bounds=$(alpha_bounds "$1" "$2")
  logical_size=${logical_bounds%%+*}
  logical_rest=${logical_bounds#*+}
  logical_height=${logical_size#*x}
  logical_y=${logical_rest#*+}
  sampled_bottom=$((logical_y + logical_height - 1))

  # 一行抗锯齿造成的量化差异沿用采样结果；若细脚被下采样漏掉多行，
  # 则相信原分辨率脚底，避免把高挑品种误判成悬空。
  delta=$((physical_logical - sampled_bottom))
  [ "$delta" -lt 0 ] && delta=$((-delta))
  if [ "$delta" -gt 1 ]; then
    echo "$physical_logical"
  else
    echo "$sampled_bottom"
  fi
}

width_of() {
  bounds=$(alpha_bounds "$1" "$2")
  size=${bounds%%+*}
  echo "${size%%x*}"
}

alpha_area_of() {
  action=$1
  frame=$2
  x=$((frame * FRAME_W))
  "$IM" "$ASSETS/$action.webp" \
    -crop "${FRAME_W}x${FRAME_H}+${x}+0" +repage \
    -filter point -resize "${LOGICAL_W}x${LOGICAL_H}!" \
    -alpha extract -threshold 12.5% \
    -format '%[fx:int(mean*w*h)]' info:
}

lower_center_twice() {
  action=$1
  frame=$2
  x=$((frame * FRAME_W))
  bounds=$("$IM" "$ASSETS/$action.webp" \
    -crop "${FRAME_W}x${FRAME_H}+${x}+0" +repage \
    -filter point -resize "${LOGICAL_W}x${LOGICAL_H}!" \
    -crop '72x20+0+32' +repage \
    -channel A -threshold 12.5% +channel \
    -format '%@' info:)
  size=${bounds%%+*}
  rest=${bounds#*+}
  width=${size%%x*}
  left=${rest%%+*}
  echo $((left * 2 + width))
}

assert_center_span() {
  action=$1
  limit=$2
  min=999
  max=-999
  frame=0
  while [ "$frame" -lt 6 ]; do
    center=$(lower_center_twice "$action" "$frame")
    [ "$center" -lt "$min" ] && min=$center
    [ "$center" -gt "$max" ] && max=$center
    frame=$((frame + 1))
  done
  span=$((max - min))
  if [ "$span" -gt "$limit" ]; then
    echo "$PET/$action lower-body anchor moves by more than $((limit / 2)) logical pixels (span=$span/2)" >&2
    exit 1
  fi
}

check_asset() {
  PET=$(basename "$(dirname "$ASSETS")")
  anchored_actions='idle walk sit lie sleep groom eat yawn stretch held land leapUp leapDown edge'
  for action in $anchored_actions pounce; do
    if [ ! -f "$ASSETS/$action.webp" ]; then
      echo "$PET is missing $action.webp" >&2
      exit 1
    fi
    dimensions=$("$IM" identify -format '%wx%h' "$ASSETS/$action.webp" 2>/dev/null || \
      "$IM" "$ASSETS/$action.webp" -format '%wx%h' info:)
    if [ "$dimensions" != '1728x224' ]; then
      echo "$PET/$action strip is $dimensions; expected 1728x224" >&2
      exit 1
    fi
  done

  # 除扑跳外，所有完整帧都必须踩在同一条地面线上；这是二次掉落和漂浮的硬门禁。
  for action in $anchored_actions; do
    frame=0
    while [ "$frame" -lt 6 ]; do
      bottom=$(bottom_of "$action" "$frame")
      if [ "$bottom" -ne "$GROUND" ]; then
        echo "$PET/$action/$frame ends at logical row $bottom; expected $GROUND" >&2
        exit 1
      fi
      frame=$((frame + 1))
    done
  done

  # 扑跳首尾落地，中间腾空。与运行时的第 2–3 格物理时间窗保持同一份事实。
  pounce_bottoms='50 50 46 42 50 50'
  frame=0
  for expected in $pounce_bottoms; do
    bottom=$(bottom_of pounce "$frame")
    if [ "$bottom" -ne "$expected" ]; then
      echo "$PET/pounce/$frame ends at logical row $bottom; expected $expected" >&2
      exit 1
    fi
    frame=$((frame + 1))
  done

  # 每格都留安全边距，防止相邻格互相露出一部分，形成“前后帧重叠”。
  for action in $anchored_actions pounce; do
    frame=0
    while [ "$frame" -lt 6 ]; do
      bounds=$(alpha_bounds "$action" "$frame")
      size=${bounds%%+*}
      rest=${bounds#*+}
      width=${size%%x*}
      height=${size#*x}
      left=${rest%%+*}
      top=${rest#*+}
      # held 从窗口顶部被拎住，接触顶边是动作语义；左右与底部仍必须留边距。
      if [ "$left" -le 0 ] || \
         { [ "$action" != 'held' ] && [ "$top" -le 0 ]; } || \
         [ $((left + width)) -ge "$LOGICAL_W" ] || [ $((top + height)) -ge "$LOGICAL_H" ]; then
        echo "$PET/$action/$frame touches a frame edge ($bounds)" >&2
        exit 1
      fi
      frame=$((frame + 1))
    done
  done

  # 边缘步态只画猫，真实窗口上沿由桌面本身提供。AI 偶尔会把「窄边缘」
  # 画成木板、窗台或瓷砖，并且因为爪子与平台相连而逃过最大连通组件清理。
  # 正常猫爪在物理落脚线附近只有少量接触像素；横跨大半格的连续前景就是场景残留。
  frame=0
  while [ "$frame" -lt 6 ]; do
    contact_pixels=$("$IM" "$ASSETS/edge.webp" \
      -crop "${FRAME_W}x2+$((frame * FRAME_W))+$((GROUND * FRAME_H / LOGICAL_H + 2))" \
      +repage -alpha extract -threshold 50% \
      -format '%[fx:int(mean*w*h)]' info:)
    if [ "$contact_pixels" -gt 128 ]; then
      echo "$PET/edge/$frame has $contact_pixels foreground pixels along the foot line; likely contains a platform or board" >&2
      exit 1
    fi
    frame=$((frame + 1))
  done

  # 静态动作的下半身必须锁住；只允许呼吸/眨眼带来的 0.5 像素量化误差。
  assert_center_span idle 2
  assert_center_span lie 2
  assert_center_span sleep 2
  # 哈欠与舔毛有前肢参与，给 3–4 像素动作预算，但禁止整只猫横向滑动。
  assert_center_span yawn 6
  assert_center_span groom 8

  land_contact_bounds=$(alpha_bounds land 2)
  land_contact_size=${land_contact_bounds%%+*}
  land_contact_height=${land_contact_size#*x}
  if [ "$land_contact_height" -gt 30 ]; then
    echo "$PET land contact frame is $land_contact_height logical pixels tall; expected impact compression" >&2
    exit 1
  fi

  # 跳跃入口与收尾不能比常态猫缩小一圈。
  for spec in 'pounce 0 47' 'pounce 5 38' 'leapUp 0 47' 'leapUp 5 40' 'leapDown 5 40'; do
    set -- $spec
    width=$(width_of "$1" "$2")
    if [ "$width" -lt "$3" ]; then
      echo "$PET/$1/$2 is only $width logical pixels wide; jump cat reads smaller than normal" >&2
      exit 1
    fi
  done

  # 站立是走路、扑跳和落地共同的收尾，不能在切回 idle 时突然膨胀。
  entry_area=$((($(alpha_area_of walk 0) + $(alpha_area_of pounce 0) + $(alpha_area_of land 0)) / 3))
  idle_area_limit=$((entry_area * 105 / 100))
  frame=0
  while [ "$frame" -lt 6 ]; do
    idle_area=$(alpha_area_of idle "$frame")
    if [ "$idle_area" -gt "$idle_area_limit" ]; then
      echo "$PET/idle/$frame area is $idle_area; transition average $entry_area (limit $idle_area_limit)" >&2
      exit 1
    fi
    frame=$((frame + 1))
  done

  # 半透明轮廓中不允许绿色占优的像素，挡住曾经的绿边与绿色胡须回归。
  for action in $anchored_actions pounce; do
    spill=$("$IM" "$ASSETS/$action.webp" -alpha on \
      -fx '(a>0.03 && a<0.98 && g>r*1.25 && g>b*1.10)?1:0' -alpha off \
      -format '%[fx:mean]' info:)
    spill_bad=$(awk -v value="$spill" 'BEGIN { print (value > 0.000001 ? 1 : 0) }')
    if [ "$spill_bad" -eq 1 ]; then
      echo "$PET/$action contains green/cyan semi-transparent edge pixels ($spill)" >&2
      exit 1
    fi
  done

  # AI 美术使用洋红抠图底；品种资源的 alpha 轮廓不允许残留紫/洋红溢色。
  if [ "$PET" != xiaomi ]; then
    for action in $anchored_actions pounce; do
      key_core=$("$IM" "$ASSETS/$action.webp" -alpha on \
        -fx '(a>0.03&&r>0.30&&b>0.30&&r>g*2.5&&b>g*2.5)?1:0' -alpha off \
        -format '%[fx:mean]' info:)
      core_bad=$(awk -v value="$key_core" 'BEGIN { print (value > 0.000001 ? 1 : 0) }')
      if [ "$core_bad" -eq 1 ]; then
        echo "$PET/$action contains chroma-key magenta inside the cat ($key_core)" >&2
        exit 1
      fi
      key_spill=$("$IM" "$ASSETS/$action.webp" \
        \( +clone -alpha extract -morphology EdgeIn Diamond:2 \) -alpha off \
        -fx '(v>0.5&&u.r>u.g*1.20&&u.b>u.g*1.20)?1:0' \
        -format '%[fx:mean]' info:)
      key_bad=$(awk -v value="$key_spill" 'BEGIN { print (value > 0.000001 ? 1 : 0) }')
      if [ "$key_bad" -eq 1 ]; then
        echo "$PET/$action contains magenta chroma spill on the alpha edge ($key_spill)" >&2
        exit 1
      fi
    done
  fi

  # 小米母版历史回归：舔毛最低头格的左眼线整段必须保持深色，不能黑白闪。
  if [ "$PET" = 'xiaomi' ]; then
    groom_left_eye_luma=$("$IM" "$ASSETS/groom.webp" \
      -crop "${FRAME_W}x${FRAME_H}+$((3 * FRAME_W))+0" +repage \
      -colorspace gray \
      -format '%[fx:int(255*min(u.p{172,114},u.p{173,114}))]' info:)
    if [ "$groom_left_eye_luma" -gt 120 ]; then
      echo "$PET/groom/3 left eyeliner contains a pale segment ($groom_left_eye_luma)" >&2
      exit 1
    fi
  fi

  # 品种必须拥有独立解剖轮廓，不能把小米的 alpha 蒙版原样保留后只换 RGB。
  if [ "$PET" != xiaomi ]; then
    "$IM" "$ASSETS/idle.webp" -crop "${FRAME_W}x${FRAME_H}+0+0" +repage \
      -filter point -resize "${LOGICAL_W}x${LOGICAL_H}!" -alpha extract \
      -threshold 12.5% "$WORK/$PET-alpha.png"
    "$IM" "$ROOT/public/pets/xiaomi/actions/idle.webp" \
      -crop "${FRAME_W}x${FRAME_H}+0+0" +repage \
      -filter point -resize "${LOGICAL_W}x${LOGICAL_H}!" -alpha extract \
      -threshold 12.5% "$WORK/xiaomi-alpha.png"
    difference=$("$IM" compare -metric AE "$WORK/$PET-alpha.png" \
      "$WORK/xiaomi-alpha.png" null: 2>&1) || true
    difference=${difference%% *}
    too_close=$(awk -v value="$difference" 'BEGIN { print (value < 120 ? 1 : 0) }')
    if [ "$too_close" -eq 1 ]; then
      echo "$PET idle silhouette differs from Xiaomi by only $difference pixels; looks like a recolor" >&2
      exit 1
    fi
  fi

  echo "$PET action geometry: ok"
}

found=0
if [ "$#" -gt 0 ]; then
  for pet in "$@"; do
    ASSETS="$ROOT/public/pets/$pet/actions"
    [ -d "$ASSETS" ] || { echo "unknown pet asset: $pet" >&2; exit 1; }
    found=1
    check_asset
  done
else
  for ASSETS in "$ROOT"/public/pets/*/actions; do
    [ -d "$ASSETS" ] || continue
    found=1
    check_asset
  done
fi

if [ "$found" -eq 0 ]; then
  echo 'check-pet-actions: no pet action directories found' >&2
  exit 1
fi
