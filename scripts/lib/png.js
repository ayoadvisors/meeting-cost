/*
 * Tiny PNG codec, no dependencies: read dimensions, decode 8-bit
 * non-interlaced images to RGBA, encode RGB (24-bit, the form the Chrome Web
 * Store wants for screenshots) or RGBA. Used by the validator (icon sizes)
 * and the store-asset builder (strip the alpha channel from headless
 * screenshots).
 */
'use strict';
const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

let table = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  const out = [];
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    out.push({ type, data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

/** { width, height, bitDepth, colorType, interlace } */
function info(buf) {
  const ihdr = readChunks(buf).find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG without IHDR');
  const d = ihdr.data;
  return { width: d.readUInt32BE(0), height: d.readUInt32BE(4), bitDepth: d[8], colorType: d[9], interlace: d[12] };
}

/** Decode to { width, height, data: RGBA Buffer }. 8-bit, non-interlaced, non-palette only. */
function decode(buf) {
  const h = info(buf);
  if (h.bitDepth !== 8 || h.interlace !== 0 || !(h.colorType in CHANNELS)) {
    throw new Error('unsupported PNG: need 8-bit, non-interlaced, non-palette (got depth ' + h.bitDepth + ', type ' + h.colorType + ')');
  }
  const channels = CHANNELS[h.colorType];
  const raw = zlib.inflateSync(Buffer.concat(readChunks(buf).filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = h.width * channels;
  const out = Buffer.alloc(h.width * h.height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h.height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let x = row[i];
      switch (filter) {
        case 0: break;
        case 1: x += a; break;
        case 2: x += b; break;
        case 3: x += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          x += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error('bad PNG filter type ' + filter + ' on row ' + y);
      }
      row[i] = x & 0xff;
    }
    for (let px = 0; px < h.width; px++) {
      const o = (y * h.width + px) * 4;
      const s = px * channels;
      if (channels === 1) { out[o] = out[o + 1] = out[o + 2] = row[s]; out[o + 3] = 255; }
      else if (channels === 2) { out[o] = out[o + 1] = out[o + 2] = row[s]; out[o + 3] = row[s + 1]; }
      else if (channels === 3) { out[o] = row[s]; out[o + 1] = row[s + 1]; out[o + 2] = row[s + 2]; out[o + 3] = 255; }
      else { out[o] = row[s]; out[o + 1] = row[s + 1]; out[o + 2] = row[s + 2]; out[o + 3] = row[s + 3]; }
    }
    prev = row;
  }
  return { width: h.width, height: h.height, data: out };
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode RGBA pixels. Default is 24-bit RGB with transparency composited on
 * white; { alpha: true } keeps the channel.
 */
function encode(img, opts) {
  const alpha = !!(opts && opts.alpha);
  const channels = alpha ? 4 : 3;
  const stride = img.width * channels;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      const d = y * (stride + 1) + 1 + x * channels;
      if (alpha) {
        raw[d] = img.data[s]; raw[d + 1] = img.data[s + 1]; raw[d + 2] = img.data[s + 2]; raw[d + 3] = img.data[s + 3];
      } else {
        const a = img.data[s + 3] / 255;
        raw[d] = Math.round(img.data[s] * a + 255 * (1 - a));
        raw[d + 1] = Math.round(img.data[s + 1] * a + 255 * (1 - a));
        raw[d + 2] = Math.round(img.data[s + 2] * a + 255 * (1 - a));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { info, decode, encode, crc32 };
