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

echo "xiaomi action geometry: ok"
