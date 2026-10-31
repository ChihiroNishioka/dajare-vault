import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = row + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pixel(x, y, size) {
  const paper = [250, 243, 231, 255];
  const card = [255, 253, 248, 255];
  const ink = [46, 52, 64, 255];
  const coral = [242, 162, 160, 255];
  const butter = [245, 217, 139, 255];
  const nx = x / (size - 1);
  const ny = y / (size - 1);
  const inCard = nx > 0.16 && nx < 0.84 && ny > 0.18 && ny < 0.86;
  const fold = nx > 0.68 && ny < 0.34 && nx + ny < 1.02;
  const tape = ny > 0.12 && ny < 0.2 && nx > 0.28 && nx < 0.62;
  const cx = (nx - 0.5) * 2;
  const cy = (ny - 0.58) * 2;
  const dist = Math.hypot(cx * 1.05, cy);
  const ring = dist > 0.34 && dist < 0.46;
  if (tape) return butter;
  if (ring) return coral;
  if (fold) return [232, 214, 186, 255];
  if (inCard) {
    const mark = Math.abs(nx - 0.5) < 0.012 && ny > 0.42 && ny < 0.74;
    const bar = Math.abs(ny - 0.58) < 0.012 && nx > 0.38 && nx < 0.62;
    if (mark || bar) return ink;
    return card;
  }
  return paper;
}

mkdirSync('public', { recursive: true });
for (const [name, size] of [
  ['icon-32.png', 32],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  writeFileSync(`public/${name}`, png(size, pixel));
}
