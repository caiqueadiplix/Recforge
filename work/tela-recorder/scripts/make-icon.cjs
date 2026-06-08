const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..", "..");
const outputPath = path.join(root, "outputs", "RecForge.ico");
const appIconPath = path.join(__dirname, "..", "electron", "RecForge.ico");
const size = 256;
const pixels = Buffer.alloc(size * size * 4);

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function setPixel(x, y, r, g, b, a = 255) {
  const index = (y * size + x) * 4;
  pixels[index] = b;
  pixels[index + 1] = g;
  pixels[index + 2] = r;
  pixels[index + 3] = a;
}

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const nx = (x - size / 2) / (size / 2);
    const ny = (y - size / 2) / (size / 2);
    const distance = Math.sqrt(nx * nx + ny * ny);
    const corner = Math.max(Math.abs(nx), Math.abs(ny));
    const roundedMask = corner < 0.88 || distance < 1.04;
    const glow = Math.max(0, 1 - distance);
    const base = roundedMask ? 15 + glow * 24 : 0;
    setPixel(x, y, base + 8, base + 6, base + 8, roundedMask ? 255 : 0);
  }
}

function drawCircle(cx, cy, radius, color, strokeWidth = 0, strokeColor = null) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (strokeColor && distance <= radius && distance >= radius - strokeWidth) {
        setPixel(x, y, ...strokeColor);
      } else if (distance < radius - strokeWidth) {
        setPixel(x, y, ...color);
      }
    }
  }
}

function drawRect(x0, y0, width, height, color) {
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      if (x >= 0 && y >= 0 && x < size && y < size) {
        setPixel(x, y, ...color);
      }
    }
  }
}

drawCircle(128, 128, 88, [12, 12, 14], 8, [255, 184, 175]);
drawCircle(128, 128, 58, [255, 59, 59]);

// RF monogram, intentionally blocky so it remains readable as a desktop icon.
drawRect(70, 78, 24, 102, [255, 242, 239]);
drawRect(70, 78, 58, 20, [255, 242, 239]);
drawRect(70, 120, 50, 20, [255, 242, 239]);
drawRect(120, 96, 20, 30, [255, 242, 239]);
drawRect(110, 134, 24, 18, [255, 242, 239]);
drawRect(128, 150, 20, 30, [255, 242, 239]);

drawRect(156, 78, 24, 102, [255, 242, 239]);
drawRect(156, 78, 58, 20, [255, 242, 239]);
drawRect(156, 120, 48, 20, [255, 242, 239]);

// BMP/DIB inside ICO, bottom-up BGRA.
const dibHeaderSize = 40;
const xorSize = pixels.length;
const andMaskStride = Math.ceil(size / 32) * 4;
const andMaskSize = andMaskStride * size;
const imageSize = dibHeaderSize + xorSize + andMaskSize;
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);

const directory = Buffer.alloc(16);
directory[0] = 0;
directory[1] = 0;
directory[2] = 0;
directory[3] = 0;
directory.writeUInt16LE(1, 4);
directory.writeUInt16LE(32, 6);
directory.writeUInt32LE(imageSize, 8);
directory.writeUInt32LE(22, 12);

const dib = Buffer.alloc(imageSize);
dib.writeUInt32LE(dibHeaderSize, 0);
dib.writeInt32LE(size, 4);
dib.writeInt32LE(size * 2, 8);
dib.writeUInt16LE(1, 12);
dib.writeUInt16LE(32, 14);
dib.writeUInt32LE(0, 16);
dib.writeUInt32LE(xorSize, 20);
dib.writeInt32LE(0, 24);
dib.writeInt32LE(0, 28);
dib.writeUInt32LE(0, 32);
dib.writeUInt32LE(0, 36);

for (let y = 0; y < size; y += 1) {
  const srcY = size - y - 1;
  pixels.copy(dib, dibHeaderSize + y * size * 4, srcY * size * 4, (srcY + 1) * size * 4);
}

const ico = Buffer.concat([icoHeader, directory, dib]);
fs.writeFileSync(outputPath, ico);
fs.writeFileSync(appIconPath, ico);
console.log(outputPath);
