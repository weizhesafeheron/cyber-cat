import { deflateSync } from 'node:zlib';

/**
 * 极简 PNG 编码器（RGBA、8 位、非隔行）。
 *
 * 只为「把渲染器的输出写成图标文件」这一件事存在，不追求通用。
 * Node 没有内置的 PNG 编码，而为了生成一个图标引入图像库不值得。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/**
 * 把 RGBA 像素编码成 PNG。
 *
 * @param scale 整数放大倍数。用最近邻放大，保持像素边缘锐利 -
 *   图标必须用整数倍放大，否则单个源像素会落在非整数个目标像素上而发虚。
 */
export function encodePng(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  scale = 1,
): Buffer {
  const w = width * scale;
  const h = height * scale;

  // 每行前置一个滤波器字节（0 = None）
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    const sy = (y / scale) | 0;
    for (let x = 0; x < w; x++) {
      const si = (sy * width + ((x / scale) | 0)) * 4;
      raw[o++] = pixels[si]!;
      raw[o++] = pixels[si + 1]!;
      raw[o++] = pixels[si + 2]!;
      raw[o++] = pixels[si + 3]!;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 色彩类型 RGBA
  ihdr[10] = 0; // 压缩方法
  ihdr[11] = 0; // 滤波方法
  ihdr[12] = 0; // 非隔行

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
