import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
const publicDir = path.join(root, "public");

const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const icoSizes = [16, 32, 48, 64, 128, 256];

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
};

const png = (width, height, rgba) => {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rawRow = y * (width * 4 + 1);
    raw[rawRow] = 0;
    rgba.copy(raw, rawRow + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (value, min = 0, max = 255) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const blend = (image, size, x, y, color, alpha = 1) => {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= size || py >= size) return;
  const i = (py * size + px) * 4;
  const sourceAlpha = clamp(alpha * color[3], 0, 255) / 255;
  const destAlpha = image[i + 3] / 255;
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return;
  image[i] = clamp((color[0] * sourceAlpha + image[i] * destAlpha * (1 - sourceAlpha)) / outAlpha);
  image[i + 1] = clamp((color[1] * sourceAlpha + image[i + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha);
  image[i + 2] = clamp((color[2] * sourceAlpha + image[i + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha);
  image[i + 3] = clamp(outAlpha * 255);
};

const distanceToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  const x = ax + dx * t;
  const y = ay + dy * t;
  return Math.hypot(px - x, py - y);
};

const drawSegment = (image, size, ax, ay, bx, by, radius, color, glow = 0) => {
  const minX = Math.floor((Math.min(ax, bx) - radius - glow) * size);
  const maxX = Math.ceil((Math.max(ax, bx) + radius + glow) * size);
  const minY = Math.floor((Math.min(ay, by) - radius - glow) * size);
  const maxY = Math.ceil((Math.max(ay, by) + radius + glow) * size);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const d = distanceToSegment(nx, ny, ax, ay, bx, by);
      if (d < radius + glow) {
        const core = d <= radius ? 1 : 1 - (d - radius) / glow;
        blend(image, size, x, y, color, color[3] / 255 * core);
      }
    }
  }
};

const roundedMask = (x, y, size, radius) => {
  const px = x + 0.5;
  const py = y + 0.5;
  const r = radius * size;
  const min = r;
  const max = size - r;
  const cx = clamp(px, min, max);
  const cy = clamp(py, min, max);
  return clamp(r + 0.8 - Math.hypot(px - cx, py - cy), 0, 1);
};

const drawIcon = (size) => {
  const image = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const radius = size * 0.22;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const mask = roundedMask(x, y, size, 0.2);
      if (mask <= 0) continue;

      const nx = x / Math.max(1, size - 1);
      const ny = y / Math.max(1, size - 1);
      const diagonal = (nx + ny) * 0.5;
      const glow = Math.max(0, 1 - Math.hypot(x - center, y - center) / (size * 0.66));
      const base = mix([5, 7, 13], [15, 30, 42], diagonal);
      const cyber = [
        base[0] + glow * 20,
        base[1] + glow * 44,
        base[2] + glow * 52
      ];

      const gridLine = x % Math.max(1, Math.round(size / 8)) === 0 || y % Math.max(1, Math.round(size / 8)) === 0;
      image[i] = clamp(cyber[0] + (gridLine ? 10 : 0));
      image[i + 1] = clamp(cyber[1] + (gridLine ? 24 : 0));
      image[i + 2] = clamp(cyber[2] + (gridLine ? 32 : 0));
      image[i + 3] = clamp(mask * 255);
    }
  }

  const cyan = [81, 215, 255, 255];
  const green = [117, 240, 167, 255];
  drawSegment(image, size, 0.18, 0.19, 0.18, 0.81, 0.045, [81, 215, 255, 230], 0.052);
  drawSegment(image, size, 0.18, 0.19, 0.79, 0.81, 0.045, [102, 230, 214, 240], 0.055);
  drawSegment(image, size, 0.79, 0.19, 0.79, 0.81, 0.045, [117, 240, 167, 230], 0.052);
  drawSegment(image, size, 0.18, 0.19, 0.79, 0.19, 0.018, cyan, 0.025);
  drawSegment(image, size, 0.18, 0.81, 0.79, 0.81, 0.018, green, 0.025);

  for (const [cx, cy, color] of [
    [0.18, 0.19, cyan],
    [0.79, 0.19, green],
    [0.18, 0.81, green],
    [0.79, 0.81, cyan],
    [0.49, 0.5, [255, 209, 102, 255]]
  ]) {
    const r = size * 0.045;
    for (let y = Math.floor(cy * size - r); y <= Math.ceil(cy * size + r); y += 1) {
      for (let x = Math.floor(cx * size - r); x <= Math.ceil(cx * size + r); x += 1) {
        const d = Math.hypot(x + 0.5 - cx * size, y + 0.5 - cy * size);
        if (d <= r) blend(image, size, x, y, color, 1 - d / r * 0.2);
      }
    }
  }

  return image;
};

const ico = (pngEntries) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngEntries.length, 4);

  let offset = 6 + pngEntries.length * 16;
  const directories = pngEntries.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...directories, ...pngEntries.map((entry) => entry.data)]);
};

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#05070d"/>
      <stop offset="0.55" stop-color="#0d1d2a"/>
      <stop offset="1" stop-color="#07130f"/>
    </linearGradient>
    <filter id="glow" x="-35%" y="-35%" width="170%" height="170%">
      <feGaussianBlur stdDeviation="12" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <path d="M64 128h384M64 256h384M64 384h384M128 64v384M256 64v384M384 64v384" stroke="#51d7ff" stroke-opacity=".18" stroke-width="4"/>
  <g filter="url(#glow)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M94 414V98l324 316V98" stroke="#66e6d6" stroke-width="48"/>
    <path d="M94 98h324M94 414h324" stroke="#75f0a7" stroke-width="18"/>
  </g>
  <circle cx="256" cy="256" r="28" fill="#ffd166"/>
</svg>
`;

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

const pngEntries = sizes.map((size) => ({ size, data: png(size, size, drawIcon(size)) }));
for (const entry of pngEntries) {
  fs.writeFileSync(path.join(buildDir, `${entry.size}x${entry.size}.png`), entry.data);
}

fs.writeFileSync(path.join(buildDir, "icon.png"), pngEntries.find((entry) => entry.size === 512).data);
fs.writeFileSync(path.join(buildDir, "icon.ico"), ico(pngEntries.filter((entry) => icoSizes.includes(entry.size))));
fs.writeFileSync(path.join(buildDir, "icon.svg"), iconSvg);
fs.copyFileSync(path.join(buildDir, "icon.png"), path.join(publicDir, "icon.png"));
fs.copyFileSync(path.join(buildDir, "icon.svg"), path.join(publicDir, "icon.svg"));

console.log(`Generated NightGrid icons in ${buildDir}`);
