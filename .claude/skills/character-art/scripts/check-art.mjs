#!/usr/bin/env node
// Validates character PNGs: RGBA, transparent corners, empty margin around the silhouette.
// Usage: node .claude/skills/character-art/scripts/check-art.mjs [file.png ...]  (default: public/art/characters/*.png)
import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decode(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0; const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset), kind = buf.toString('ascii', offset + 4, offset + 8), data = buf.subarray(offset + 8, offset + 8 + length);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    if (kind === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  if (type !== 6 || depth !== 8) return { width, height, error: `color type ${type}, depth ${depth} (need RGBA 8-bit)` };
  if (interlace) return { width, height, error: 'interlaced PNG is not supported by this check' };
  const raw = inflateSync(Buffer.concat(idat)), stride = width * 4, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? pixels[y * stride + x - 4] : 0, b = y ? pixels[(y - 1) * stride + x] : 0, c = x >= 4 && y ? pixels[(y - 1) * stride + x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += a; else if (filter === 2) value += b; else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      pixels[y * stride + x] = value & 255;
    }
  }
  return { width, height, alpha: (x, y) => pixels[y * stride + x * 4 + 3] };
}

const files = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync('public/art/characters').filter(f => f.endsWith('.png')).map(f => `public/art/characters/${f}`);
let failures = 0;
for (const file of files) {
  const problems = [];
  try {
    const img = decode(file);
    if (img.error) problems.push(img.error);
    else {
      const { width: w, height: h, alpha } = img;
      const corners = [alpha(0, 0), alpha(w - 1, 0), alpha(0, h - 1), alpha(w - 1, h - 1)];
      if (corners.some(a => a > 8)) problems.push(`opaque corners (alpha ${corners.join('/')}) — background not removed`);
      let minX = w, minY = h, maxX = -1, maxY = -1, opaque = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha(x, y) > 24) { opaque++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      const share = opaque / (w * h);
      if (maxX < 0) problems.push('image is fully transparent');
      else {
        // Assets are trimmed to the silhouette, so touching the frame is fine; a long solid run on an edge means a cut-off figure.
        const edges = { top: [], bottom: [], left: [], right: [] };
        for (let x = 0; x < w; x++) { edges.top.push(alpha(x, 0)); edges.bottom.push(alpha(x, h - 1)); }
        for (let y = 0; y < h; y++) { edges.left.push(alpha(0, y)); edges.right.push(alpha(w - 1, y)); }
        for (const [side, line] of Object.entries(edges)) {
          const solid = line.filter(a => a > 200).length / line.length;
          if (solid > 0.08) problems.push(`${(solid * 100).toFixed(0)}% of the ${side} edge is opaque — figure looks cut off`);
        }
        if (share > 0.85) problems.push(`opaque area ${(share * 100).toFixed(0)}% — probably a background, not a cut-out`);
      }
      if (!problems.length) console.log(`PASS ${file} ${w}x${h}, figure ${(share * 100).toFixed(0)}% of frame, bbox ${minX},${minY}-${maxX},${maxY}`);
    }
  } catch (error) { problems.push(error.message); }
  if (problems.length) { failures++; console.log(`FAIL ${file}: ${problems.join('; ')}`); }
}
process.exit(failures ? 1 : 0);
