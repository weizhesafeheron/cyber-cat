"""最小 PNG 读取器（8 位 RGB/RGBA、非隔行）。

**必须实现滤波器反算。** 之前手写的版本只处理了 filter type 0，
而 macOS 的 screencapture 输出用 Sub/Up/Average/Paeth 滤波，
导致读出来的像素全是垃圾，连续给出四个错误结论（找不到猫、
判定窗口不渲染、像素块不均匀）。这是本项目「工具比被测对象更可疑」
最贵的一次教训。

另一条同样重要：**截图的颜色不等于源码里的调色板。**
macOS 合成与截图会做色彩配置转换（sRGB → 显示器 P3），像素值会整体偏移。
用精确 RGB 去匹配调色板一定失败，必须按色相/距离做容差匹配。
"""

import struct
import zlib


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def read_png(path):
    """返回 (width, height, channels, rows)，rows 是每行的 bytearray。"""
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG"
    pos = 8
    width = height = None
    color_type = bit_depth = None
    idat = b""
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if ctype == b"IHDR":
            width, height, bit_depth, color_type, comp, filt, interlace = struct.unpack(
                ">IIBBBBB", body[:13]
            )
            assert bit_depth == 8, f"只支持 8 位，实际 {bit_depth}"
            assert interlace == 0, "不支持隔行"
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break
        pos += 12 + length

    channels = {2: 3, 6: 4, 0: 1, 4: 2}[color_type]
    raw = zlib.decompress(idat)
    stride = width * channels
    rows = []
    prev = bytearray(stride)
    p = 0
    for _ in range(height):
        ft = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        if ft == 1:  # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ft == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:  # Average
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ft == 4:  # Paeth
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                upleft = prev[i - channels] if i >= channels else 0
                line[i] = (line[i] + _paeth(left, prev[i], upleft)) & 0xFF
        elif ft != 0:
            raise ValueError(f"未知滤波器类型 {ft}")
        rows.append(line)
        prev = line
    return width, height, channels, rows


def orange_bbox(path, sample_step=1):
    """找出「橘猫毛色」像素的包围盒与重心 x。

    按色相判断而不是精确 RGB - 截图经过色彩配置转换，值会整体偏移。
    """
    w, h, ch, rows = read_png(path)
    xs = []
    ys = []
    for y in range(0, h, sample_step):
        row = rows[y]
        for x in range(0, w, sample_step):
            o = x * ch
            r, g, b = row[o], row[o + 1], row[o + 2]
            # 橘色族：红最高、蓝最低、跨度够大，且不是灰
            if r > 140 and r > g > b and (r - b) > 60 and (g - b) > 20:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return {
        "n": len(xs),
        "x0": min(xs),
        "x1": max(xs),
        "y0": min(ys),
        "y1": max(ys),
        "cx": sum(xs) / len(xs),
        "w": w,
        "h": h,
    }
