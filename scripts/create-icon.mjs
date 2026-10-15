import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const size = 256;
const png = new PNG({ width: size, height: size });
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    const purple =
      (x >= 52 && x <= 78 && y >= 62 && y < 196) ||
      (x >= 178 && x < 204 && y >= 62 && y < 196) ||
      (y >= 62 && y < 141 && Math.abs(x - (65 + (y - 62) * 0.8)) < 16) ||
      (y >= 62 && y < 141 && Math.abs(x - (191 - (y - 62) * 0.8)) < 16);
    const corner =
      (x < 25 && y < 25 && Math.hypot(x - 25, y - 25) > 25) ||
      (x > 230 && y < 25 && Math.hypot(x - 230, y - 25) > 25) ||
      (x < 25 && y > 230 && Math.hypot(x - 25, y - 230) > 25) ||
      (x > 230 && y > 230 && Math.hypot(x - 230, y - 230) > 25);
    png.data[index] = purple ? 170 : 23;
    png.data[index + 1] = purple ? 126 : 20;
    png.data[index + 2] = purple ? 247 : 31;
    png.data[index + 3] = corner ? 0 : 255;
  }
const buffer = PNG.sync.write(png);
mkdirSync("build", { recursive: true });
writeFileSync("build/icon.png", buffer);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0;
header[7] = 0;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(buffer.length, 14);
header.writeUInt32LE(22, 18);
writeFileSync("build/icon.ico", Buffer.concat([header, buffer]));
