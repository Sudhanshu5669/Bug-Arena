// Placeholder sprite generator (dev tool — NOT part of the runtime).
//
// Produces simple top-down bug PNGs at /public/assets/sprites/<id>.png so the
// sprite pipeline is visible immediately. Replace these with real art at the same
// paths and dimensions; nothing else changes.
//
//   node tools/genPlaceholderSprites.js
//
// Output format (this is exactly what to generate/source for real art):
//   • 128 x 128 px, PNG, RGBA with a transparent background
//   • top-down view, insect facing UP (head toward the top edge)
//   • the bug roughly centered, filling ~70% of the canvas
//
// Pure Node: a tiny PNG encoder (zlib + CRC32) and a 2x-supersampled software
// rasterizer. No native/canvas dependency.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'assets', 'sprites');

const SIZE = 128;
const SS = 2; // supersample factor for cheap anti-aliasing
const BW = SIZE * SS;

// --- PNG encoding -------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
             : Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- software rasterizer (operates on the BWxBW supersampled buffer) ----------

function makeBuffer() {
  return new Uint8ClampedArray(BW * BW * 4); // transparent
}

function blend(buf, x, y, [r, g, b], a) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= BW || y >= BW || a <= 0) return;
  const i = (y * BW + x) * 4;
  const sa = a;
  const da = buf[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  buf[i] = (r * sa + buf[i] * da * (1 - sa)) / oa;
  buf[i + 1] = (g * sa + buf[i + 1] * da * (1 - sa)) / oa;
  buf[i + 2] = (b * sa + buf[i + 2] * da * (1 - sa)) / oa;
  buf[i + 3] = oa * 255;
}

// Coordinates are authored in 128-space; scaled by SS here.
function ellipse(buf, cx, cy, rx, ry, color, a = 1) {
  cx *= SS; cy *= SS; rx *= SS; ry *= SS;
  const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) blend(buf, x, y, color, a);
    }
  }
}

function disc(buf, cx, cy, r, color, a = 1) {
  ellipse(buf, cx, cy, r, r, color, a);
}

function seg(buf, x0, y0, x1, y1, thick, color, a = 1) {
  x0 *= SS; y0 *= SS; x1 *= SS; y1 *= SS;
  const t = (thick * SS) / 2;
  const minX = Math.floor(Math.min(x0, x1) - t), maxX = Math.ceil(Math.max(x0, x1) + t);
  const minY = Math.floor(Math.min(y0, y1) - t), maxY = Math.ceil(Math.max(y0, y1) + t);
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let tt = ((x - x0) * dx + (y - y0) * dy) / len2;
      tt = Math.max(0, Math.min(1, tt));
      const px = x0 + tt * dx, py = y0 + tt * dy;
      if ((x - px) ** 2 + (y - py) ** 2 <= t * t) blend(buf, x, y, color, a);
    }
  }
}

/** Two-segment leg with a knee. */
function leg(buf, ax, ay, kx, ky, fx, fy, thick, color) {
  seg(buf, ax, ay, kx, ky, thick, color);
  seg(buf, kx, ky, fx, fy, thick * 0.85, color);
}

// --- downsample + save --------------------------------------------------------

function downsampleAndSave(buf, filePath) {
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * BW + (x * SS + sx)) * 4;
          const pa = buf[i + 3];
          r += buf[i] * pa; g += buf[i + 1] * pa; b += buf[i + 2] * pa; a += pa;
        }
      }
      const o = (y * SIZE + x) * 4;
      out[o] = a ? r / a : 0;
      out[o + 1] = a ? g / a : 0;
      out[o + 2] = a ? b / a : 0;
      out[o + 3] = a / (SS * SS);
    }
  }
  fs.writeFileSync(filePath, encodePNG(SIZE, SIZE, out));
}

// --- bug art (facing UP: head near the top) -----------------------------------

function drawAnt(buf) {
  const base = [255, 90, 44], dark = [90, 22, 0], light = [255, 155, 110];
  // legs
  for (const s of [-1, 1]) {
    leg(buf, 64 + s * 6, 60, 64 + s * 24, 52, 64 + s * 40, 44, 4, dark);
    leg(buf, 64 + s * 6, 64, 64 + s * 26, 64, 64 + s * 42, 66, 4, dark);
    leg(buf, 64 + s * 6, 68, 64 + s * 24, 80, 64 + s * 40, 90, 4, dark);
  }
  // antennae + mandibles
  seg(buf, 60, 36, 52, 20, 2.4, dark);
  seg(buf, 68, 36, 76, 20, 2.4, dark);
  seg(buf, 60, 32, 55, 25, 2.4, dark);
  seg(buf, 68, 32, 73, 25, 2.4, dark);
  // dark outline pass
  ellipse(buf, 64, 92, 17, 22, dark);
  ellipse(buf, 64, 62, 13, 14, dark);
  disc(buf, 64, 40, 12, dark);
  // body
  ellipse(buf, 64, 92, 14, 19, base);
  ellipse(buf, 64, 62, 10, 11, base);
  disc(buf, 64, 40, 9.5, base);
  // segment cinch lines
  seg(buf, 52, 80, 76, 80, 2, dark, 0.5);
  seg(buf, 54, 100, 74, 100, 2, dark, 0.5);
  // highlights + eyes
  ellipse(buf, 60, 84, 6, 8, light, 0.7);
  ellipse(buf, 60, 58, 4, 4, light, 0.7);
  disc(buf, 61, 37, 4, light, 0.6);
  disc(buf, 59, 39, 2, dark);
  disc(buf, 69, 39, 2, dark);
}

function drawSpider(buf) {
  const base = [155, 93, 229], dark = [46, 20, 80], light = [201, 168, 255];
  // 8 long legs with knees
  const attachY = 54;
  const legsL = [
    [18, 34, 6, 22], // kneeX,kneeY,footX,footY offsets pattern handled below
  ];
  for (const s of [-1, 1]) {
    leg(buf, 64 + s * 10, attachY - 6, 64 + s * 34, 34, 64 + s * 46, 22, 3.4, dark);
    leg(buf, 64 + s * 12, attachY, 64 + s * 40, 52, 64 + s * 52, 50, 3.4, dark);
    leg(buf, 64 + s * 12, attachY + 6, 64 + s * 40, 72, 64 + s * 50, 82, 3.4, dark);
    leg(buf, 64 + s * 10, attachY + 12, 64 + s * 34, 90, 64 + s * 44, 104, 3.4, dark);
  }
  // outline
  ellipse(buf, 64, 84, 23, 25, dark);
  ellipse(buf, 64, 52, 16, 17, dark);
  // body
  ellipse(buf, 64, 84, 20, 22, base);
  ellipse(buf, 64, 52, 13, 14, base);
  // abdomen marking + highlight
  ellipse(buf, 64, 84, 7, 12, dark, 0.4);
  ellipse(buf, 58, 76, 6, 8, light, 0.6);
  // eye cluster (front)
  for (const [ex, ey] of [[59, 44], [69, 44], [62, 47], [66, 47], [64, 42]]) disc(buf, ex, ey, 1.8, dark);
  disc(buf, 60, 48, 1.4, light, 0.8);
}

function drawMantis(buf) {
  const base = [56, 176, 0], dark = [15, 58, 8], light = [127, 221, 80];
  // hind legs
  for (const s of [-1, 1]) {
    leg(buf, 64 + s * 6, 66, 64 + s * 22, 74, 64 + s * 30, 90, 3, dark);
    leg(buf, 64 + s * 6, 74, 64 + s * 22, 88, 64 + s * 28, 104, 3, dark);
  }
  // raptorial forelegs (folded, reaching forward/up)
  for (const s of [-1, 1]) {
    leg(buf, 64 + s * 5, 52, 64 + s * 20, 36, 64 + s * 8, 22, 5, dark);
  }
  // antennae
  seg(buf, 61, 32, 54, 14, 1.8, dark);
  seg(buf, 67, 32, 74, 14, 1.8, dark);
  // outline
  ellipse(buf, 64, 94, 10, 24, dark);
  ellipse(buf, 64, 62, 9, 20, dark);
  disc(buf, 64, 36, 10, dark);
  // body (slender)
  ellipse(buf, 64, 94, 8, 22, base);
  ellipse(buf, 64, 62, 7, 18, base);
  disc(buf, 64, 36, 8, base);
  // big eyes
  disc(buf, 57, 33, 4.5, dark);
  disc(buf, 71, 33, 4.5, dark);
  disc(buf, 56, 32, 1.6, light);
  disc(buf, 70, 32, 1.6, light);
  // highlight stripe
  ellipse(buf, 61, 58, 3, 12, light, 0.55);
}

// --- run ----------------------------------------------------------------------

const SPRITES = { fireAnt: drawAnt, spider: drawSpider, mantis: drawMantis };

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [id, draw] of Object.entries(SPRITES)) {
  const buf = makeBuffer();
  draw(buf);
  const file = path.join(OUT_DIR, `${id}.png`);
  downsampleAndSave(buf, file);
  console.log(`wrote ${path.relative(path.resolve(__dirname, '..'), file)} (${SIZE}x${SIZE} RGBA)`);
}
console.log('done.');
