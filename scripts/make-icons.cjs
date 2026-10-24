#!/usr/bin/env node
/**
 * make-icons.cjs
 * --------------
 * Builds the Windows (.ico) and macOS (.icns) application icons from the PNG
 * set in build/icons/ (the icons ship with the upstream app).
 *
 * Usage: node scripts/make-icons.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ICONS_DIR = path.join(ROOT, "build", "icons");

function png(size) {
  const file = path.join(ICONS_DIR, `${size}.png`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

/* ------------------------------- ICO --------------------------------- */
// ICO can store PNG-compressed images (Vista+), which keeps things simple.
function buildIco() {
  const sizes = [16, 32, 48, 64, 128, 256].map((size) => ({ size, data: png(size) })).filter(Boolean);
  if (sizes.length === 0) throw new Error("no PNG icons found in build/icons");

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);

  const entries = [];
  let offset = header.length + sizes.length * 16;
  for (const { size, data } of sizes) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette size
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }

  const file = Buffer.concat([header, ...entries, ...sizes.map((s) => s.data)]);
  const out = path.join(ROOT, "build", "icon.ico");
  fs.writeFileSync(out, file);
  console.log(`[icons] ${path.relative(ROOT, out)} (${(file.length / 1024).toFixed(1)} KB, ${sizes.length} sizes)`);
}

/* ------------------------------- ICNS -------------------------------- */
// ic07 = 128px, ic08 = 256px, ic09 = 512px, ic10 = 1024px (PNG compressed).
function buildIcns() {
  const types = { 128: "ic07", 256: "ic08", 512: "ic09", 1024: "ic10" };
  const blocks = [];
  for (const [size, type] of Object.entries(types)) {
    const data = png(Number(size));
    if (data == null) continue;
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(data.length + 8, 4);
    blocks.push(Buffer.concat([header, data]));
  }
  if (blocks.length === 0) {
    console.log("[icons] no PNGs for icns — skipping");
    return;
  }
  const total = 8 + blocks.reduce((sum, block) => sum + block.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(total, 4);
  const file = Buffer.concat([header, ...blocks]);
  const out = path.join(ROOT, "build", "icon.icns");
  fs.writeFileSync(out, file);
  console.log(`[icons] ${path.relative(ROOT, out)} (${(file.length / 1024).toFixed(1)} KB, ${blocks.length} entries)`);
}

buildIco();
buildIcns();
