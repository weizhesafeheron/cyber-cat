#!/bin/sh

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ASSETS="$ROOT/public/pets/xiaomi/actions"
FRAME_W=288
FRAME_H=224
LOGICAL_W=72
LOGICAL_H=56
GROUND=50

if ! command -v magick >/dev/null 2>&1; then
  echo "check-xiaomi-actions: ImageMagick (magick) is required" >&2
  exit 1
fi

alpha_bounds() {
  action=$1
  frame=$2
  x=$((frame * FRAME_W))
  magick "$ASSETS/$action.webp" \
    -crop "${FRAME_W}x${FRAME_H}+${x}+0" +repage \
    -filter point -resize "${LOGICAL_W}x${LOGICAL_H}!" \
    -channel A -threshold 12.5% +channel \
    -format '%@' info:
}

bottom_of() {
  bounds=$(alpha_bounds "$1" "$2")
  size=${bounds%%+*}
  rest=${bounds#*+}
  height=${size#*x}
  y=${rest#*+}
  echo $((y + height - 1))
}

anchored_actions='idle walk sit lie sleep groom eat yawn stretch held land leapUp leapDown edge'
for action in $anchored_actions; do
  dimensions=$(magick identify -format '%wx%h' "$ASSETS/$action.webp")
  if [ "$dimensions" != '1728x224' ]; then
    echo "$action strip is $dimensions; expected 1728x224" >&2
    exit 1
  fi
  frame=0
  while [ "$frame" -lt 6 ]; do
    bottom=$(bottom_of "$action" "$frame")
    if [ "$bottom" -ne "$GROUND" ]; then
      echo "$action/$frame ends at logical row $bottom; expected ground row $GROUND" >&2
      exit 1
    fi
    frame=$((frame + 1))
  done
done

# 扑跳没有运行时竖向位移，腾空弧线有意保留在动作帧内；首尾仍落在地面线上。
pounce_bottoms='50 50 46 42 50 50'
frame=0
for expected in $pounce_bottoms; do
  bottom=$(bottom_of pounce "$frame")
  if [ "$bottom" -ne "$expected" ]; then
    echo "pounce/$frame ends at logical row $bottom; expected $expected" >&2
    exit 1
  fi
  frame=$((frame + 1))
done

# land/2 是运行时在物理接触那一刻选择的压缩格，必须明显低于直立姿态。
land_contact_bounds=$(alpha_bounds land 2)
land_contact_size=${land_contact_bounds%%+*}
land_contact_height=${land_contact_size#*x}
if [ "$land_contact_height" -gt 30 ]; then
  echo "land contact frame is $land_contact_height logical pixels tall; expected impact compression" >&2
  exit 1
fi

# 跳跃入口与收尾不能比常态猫缩小一圈。阈值只锁明显失真，允许蓄力/蜷身自然变窄。
width_of() {
  bounds=$(alpha_bounds "$1" "$2")
  size=${bounds%%+*}
  echo "${size%%x*}"
}

for spec in 'pounce 0 47' 'pounce 5 38' 'leapUp 0 47' 'leapUp 5 40' 'leapDown 5 40'; do
  set -- $spec
  width=$(width_of "$1" "$2")
  if [ "$width" -lt "$3" ]; then
    echo "$1/$2 is only $width logical pixels wide; jump cat reads smaller than normal" >&2
    exit 1
  fi
done

# 舔毛最低头格的两条闭眼线必须同为深色。groom/3 左眼曾被画成灰白，
# 缩到运行时 72×56 后会读成一只眼消失；取眼线中心像素守住这个具体退化。
groom_left_eye_luma=$(magick "$ASSETS/groom.webp" \
  -crop "${FRAME_W}x${FRAME_H}+$((3 * FRAME_W))+0" +repage \
  -filter point -resize "${LOGICAL_W}x${LOGICAL_H}!" \
  -colorspace gray -format '%[fx:int(255*u.p{44,29})]' info:)
if [ "$groom_left_eye_luma" -gt 100 ]; then
  echo "groom/3 left eyeliner is too light ($groom_left_eye_luma); expected a dark line like the right eye" >&2
  exit 1
fi

echo "xiaomi action geometry: ok"
