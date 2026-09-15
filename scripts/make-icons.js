#!/usr/bin/env node
/*
 * Generates the PNG icons (a white "$" on a green disc) for the browser
 * extension and the Outlook add-in without any image dependency: pixels are
 * rasterized here and written with a tiny PNG encoder on top of zlib.
 *
 *   node scripts/make-icons.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  { dir: path.join(ROOT, 'packages', 'browser-extension', 'icons'), sizes: [16, 32, 48, 128] },
  { dir: path.join(ROOT, 'packages', 'outlook-addin', 'assets'), sizes: [16, 32, 64, 80, 128] },
  { dir: path.join(ROOT, 'packages', 'google-workspace-addon'), sizes: [128] }
];

const GREEN = [24, 128, 56];   // Google green 700
const RING = [15, 100, 42];
const WHITE = [255, 255, 255];

/* ---- CRC-32 (zlib.crc32 exists on Node >= 22; keep a fallback) ------- */
let crcTable = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---- the picture, in unit coordinates ------------------------------ */

const R_BOWL = 0.125;      // radius of each half of the "S"
const STROKE = 0.075;      // stroke width of the glyph
const BAR_HALF = 0.03;     // half width of the vertical bar

function onArc(dx, dy, radius, excludeFrom, excludeTo) {
  const dist = Math.hypot(dx, dy);
  if (Math.abs(dist - radius) > STROKE / 2) return false;
  let deg = Math.atan2(dy, dx) * 180 / Math.PI; // y grows downward
  if (deg < 0) deg += 360;
  const inGap = excludeFrom < excludeTo
    ? (deg > excludeFrom && deg < excludeTo)
    : (deg > excludeFrom || deg < excludeTo);
  return !inGap;
}

function sample(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const dist = Math.hypot(dx, dy);
  if (dist > 0.48) return null;
  if (dist > 0.44) return RING;

  const barTop = 0.5 - 2 * R_BOWL - 0.06;
  const barBottom = 0.5 + 2 * R_BOWL + 0.06;
  if (Math.abs(dx) < BAR_HALF && y > barTop && y < barBottom) return WHITE;

  // Upper bowl opens to the right (gap from 330° through 0° to 80°).
  if (onArc(dx, y - (0.5 - R_BOWL), R_BOWL, 330, 80)) return WHITE;
  // Lower bowl opens to the left (gap from 150° to 260°).
  if (onArc(dx, y - (0.5 + R_BOWL), R_BOWL, 150, 260)) return WHITE;

  return GREEN;
}

function rasterize(size) {
  const SS = 4; // supersampling factor per axis
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = SS * SS;
      const o = (py * size + px) * 4;
      const covered = a / 255;
      rgba[o] = covered ? Math.round(r / covered) : 0;
      rgba[o + 1] = covered ? Math.round(g / covered) : 0;
      rgba[o + 2] = covered ? Math.round(b / covered) : 0;
      rgba[o + 3] = Math.round(a / n);
    }
  }
  return rgba;
}

const cache = {};
for (const target of TARGETS) {
  fs.mkdirSync(target.dir, { recursive: true });
  for (const size of target.sizes) {
    cache[size] = cache[size] || encodePng(size, rasterize(size));
    const file = path.join(target.dir, 'icon-' + size + '.png');
    fs.writeFileSync(file, cache[size]);
    console.log('wrote', path.relative(ROOT, file), cache[size].length + ' bytes');
  }
}
