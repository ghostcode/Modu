#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const icons = path.join(root, "src-tauri", "icons");
const sources = [
  { size: 32, file: "32x32.png" },
  { size: 128, file: "128x128.png" },
  { size: 256, file: "128x128@2x.png" },
];

const images = sources.map(({ size, file }) => {
  const target = path.join(icons, file);
  if (!fs.existsSync(target)) throw new Error(`Missing icon source: ${file}`);
  const data = fs.readFileSync(target);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== size || height !== size)
    throw new Error(`Icon ${file} is ${width}x${height}, expected ${size}x${size}`);
  return { size, data };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

let offset = header.length + images.length * 16;
const entries = [];
const payloads = [];
for (const image of images) {
  const entry = Buffer.alloc(16);
  const dimension = image.size >= 256 ? 0 : image.size;
  entry.writeUInt8(dimension, 0);
  entry.writeUInt8(dimension, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += image.data.length;
  entries.push(entry);
  payloads.push(image.data);
}

const ico = path.join(icons, "icon.ico");
fs.writeFileSync(ico, Buffer.concat([header, ...entries, ...payloads]));
console.log(`Wrote ${ico} with sizes ${images.map((item) => item.size).join(", ")}`);
