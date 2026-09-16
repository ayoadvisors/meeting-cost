/*
 * Minimal ZIP writer/reader, no dependencies.
 *
 * Why not PowerShell's Compress-Archive: it writes entry names with
 * backslashes ("icons\icon-16.png"), which the Chrome Web Store, AMO and
 * every Unix unzip read as a file literally named that, so the manifest's
 * "icons/icon-16.png" is missing. Entries here always use forward slashes,
 * are deflated, and carry a fixed timestamp so that identical sources give
 * byte-identical archives.
 */
'use strict';
const zlib = require('zlib');

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

function dosTime(d) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

/**
 * @param {Array<{name: string, data: Buffer}>} entries  names relative to the archive root
 * @param {{mtime?: Date}} [opts]
 * @returns {Buffer}
 */
function createZip(entries, opts) {
  const stamp = dosTime((opts && opts.mtime) || new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name).replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed to extract: 2.0
    local.writeUInt16LE(0x0800, 6);      // general purpose flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);             // version made by: 2.0, MS-DOS attributes
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(stamp.time, 12);
    cd.writeUInt16LE(stamp.date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);             // extra length
    cd.writeUInt16LE(0, 32);             // comment length
    cd.writeUInt16LE(0, 34);             // disk number
    cd.writeUInt16LE(0, 36);             // internal attributes
    cd.writeUInt32LE(0, 38);             // external attributes
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat(parts.concat([directory, end]));
}

/**
 * Read a ZIP's central directory. Returns { entries, read(entry) -> Buffer }.
 * Enough for validating our own packages (deflate and store only).
 */
function readZip(buf) {
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(i + 10);
  let p = buf.readUInt32LE(i + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, crc, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  function read(entry) {
    const h = entry.offset;
    if (buf.readUInt32LE(h) !== 0x04034b50) throw new Error('corrupt local header: ' + entry.name);
    const nameLen = buf.readUInt16LE(h + 26);
    const extraLen = buf.readUInt16LE(h + 28);
    const start = h + 30 + nameLen + extraLen;
    const body = buf.subarray(start, start + entry.compressedSize);
    let data;
    if (entry.method === 8) data = zlib.inflateRawSync(body);
    else if (entry.method === 0) data = Buffer.from(body);
    else throw new Error('unsupported compression method ' + entry.method + ' for ' + entry.name);
    if (crc32(data) !== entry.crc) throw new Error('CRC mismatch: ' + entry.name);
    return data;
  }
  return { entries, read };
}

module.exports = { createZip, readZip, crc32 };
