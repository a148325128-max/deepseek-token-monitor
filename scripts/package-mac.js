#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const APP_NAME = "DeepSeek监控助手";
const BUNDLE_ID = "com.houziai.deepseek-token-monitor";
const VERSION = require(path.join(ROOT, "package.json")).version || "0.1.0";
const ELECTRON_APP = path.join(ROOT, "node_modules", "electron", "dist", "Electron.app");
const DIST_DIR = path.join(ROOT, "dist", "mac");
const OUT_APP = path.join(DIST_DIR, `${APP_NAME}.app`);
const BUILD_DIR = path.join(ROOT, "build");
const ICONSET_DIR = path.join(BUILD_DIR, "DeepSeekMonitor.iconset");
const ICNS_PATH = path.join(BUILD_DIR, "DeepSeekMonitor.icns");
const DEFAULT_ICNS_PATH = path.join(BUILD_DIR, "icon.icns");
const DEFAULT_ICO_PATH = path.join(BUILD_DIR, "icon.ico");

function ensureElectronApp() {
  if (!fs.existsSync(ELECTRON_APP)) {
    throw new Error("Electron.app not found. Run npm install first.");
  }
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function mix(c1, c2, t) {
  return [
    lerp(c1[0], c2[0], t),
    lerp(c1[1], c2[1], t),
    lerp(c1[2], c2[2], t),
    lerp(c1[3], c2[3], t),
  ];
}

function drawRoundedRect(pixels, size, x, y, w, h, radius, color) {
  for (let py = Math.max(0, y); py < Math.min(size, y + h); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(size, x + w); px += 1) {
      const dx = px < x + radius ? x + radius - px : px > x + w - radius ? px - (x + w - radius) : 0;
      const dy = py < y + radius ? y + radius - py : py > y + h - radius ? py - (y + h - radius) : 0;
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(pixels, size, px, py, color);
      }
    }
  }
}

function setPixel(pixels, size, x, y, color) {
  const index = (y * size + x) * 4;
  const alpha = color[3] / 255;
  const inv = 1 - alpha;
  pixels[index] = Math.round(color[0] * alpha + pixels[index] * inv);
  pixels[index + 1] = Math.round(color[1] * alpha + pixels[index + 1] * inv);
  pixels[index + 2] = Math.round(color[2] * alpha + pixels[index + 2] * inv);
  pixels[index + 3] = Math.min(255, Math.round(color[3] + pixels[index + 3] * inv));
}

function drawCircle(pixels, size, cx, cy, radius, color) {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(size - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(size - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance <= radius) {
        const edge = Math.min(1, Math.max(0, radius - distance));
        setPixel(pixels, size, x, y, [color[0], color[1], color[2], Math.round(color[3] * Math.max(0.35, edge))]);
      }
    }
  }
}

function drawSegment(pixels, size, x1, y1, x2, y2, width, color) {
  const radius = width / 2;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - radius));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x1, x2) + radius));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - radius));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y1, y2) + radius));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = lengthSq ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSq)) : 0;
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      if (Math.hypot(x - px, y - py) <= radius) setPixel(pixels, size, x, y, color);
    }
  }
}

function drawD(pixels, size) {
  const white = [246, 255, 255, 255];
  const x = Math.round(size * 0.34);
  const y = Math.round(size * 0.30);
  const h = Math.round(size * 0.40);
  const w = Math.round(size * 0.28);
  const stroke = Math.round(size * 0.085);
  drawRoundedRect(pixels, size, x, y, stroke, h, Math.round(stroke * 0.45), white);
  drawSegment(pixels, size, x + stroke * 0.65, y + stroke / 2, x + w * 0.58, y + stroke / 2, stroke, white);
  drawSegment(pixels, size, x + stroke * 0.65, y + h - stroke / 2, x + w * 0.58, y + h - stroke / 2, stroke, white);
  drawSegment(pixels, size, x + w * 0.58, y + stroke / 2, x + w, y + h * 0.35, stroke, white);
  drawSegment(pixels, size, x + w, y + h * 0.35, x + w, y + h * 0.65, stroke, white);
  drawSegment(pixels, size, x + w, y + h * 0.65, x + w * 0.58, y + h - stroke / 2, stroke, white);
}

function createIconPng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const top = [99, 232, 201, 255];
  const mid = [80, 177, 255, 255];
  const bottom = [135, 96, 244, 255];
  const radius = Math.round(size * 0.22);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const rx = x < radius ? radius - x : x > size - radius ? x - (size - radius) : 0;
      const ry = y < radius ? radius - y : y > size - radius ? y - (size - radius) : 0;
      if (rx * rx + ry * ry <= radius * radius) {
        const vertical = y / Math.max(1, size - 1);
        const horizontal = x / Math.max(1, size - 1);
        const base = vertical < 0.52 ? mix(top, mid, vertical / 0.52) : mix(mid, bottom, (vertical - 0.52) / 0.48);
        const shine = Math.max(0, 1 - Math.hypot(horizontal - 0.28, vertical - 0.18) * 2.3);
        setPixel(pixels, size, x, y, [
          Math.min(255, base[0] + shine * 38),
          Math.min(255, base[1] + shine * 38),
          Math.min(255, base[2] + shine * 42),
          255,
        ]);
      }
    }
  }

  drawCircle(pixels, size, size * 0.72, size * 0.28, size * 0.11, [255, 255, 255, 44]);
  drawCircle(pixels, size, size * 0.26, size * 0.76, size * 0.12, [29, 59, 103, 48]);
  drawD(pixels, size);

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function generateIcns() {
  fs.rmSync(ICONSET_DIR, { recursive: true, force: true });
  fs.mkdirSync(ICONSET_DIR, { recursive: true });
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const masterPng = path.join(BUILD_DIR, "icon-master.png");
  fs.writeFileSync(masterPng, createIconPng(1024));

  const iconSpecs = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];
  for (const [name, size] of iconSpecs) {
    const out = path.join(ICONSET_DIR, name);
    let ok = false;
    try {
      const result = spawnSync("/usr/bin/sips", ["-z", String(size), String(size), masterPng, "--out", out], {
        stdio: "ignore",
      });
      ok = result.status === 0;
    } catch {
      ok = false;
    }
    if (!ok) {
      fs.writeFileSync(out, createIconPng(size));
    }
  }

  let icnsOk = false;
  try {
    const result = spawnSync("/usr/bin/iconutil", ["-c", "icns", ICONSET_DIR, "-o", ICNS_PATH], {
      stdio: "inherit",
    });
    icnsOk = result.status === 0;
  } catch {
    icnsOk = false;
  }
  if (!icnsOk) generateFallbackIcns();
  fs.copyFileSync(ICNS_PATH, DEFAULT_ICNS_PATH);
  generateIco();
}

function generateIco() {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => ({ size, png: createIconPng(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.png.length;
  }

  fs.writeFileSync(DEFAULT_ICO_PATH, Buffer.concat([header, ...entries, ...images.map((image) => image.png)]));
}

function icnsBlock(type, data) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
}

function generateFallbackIcns() {
  const blocks = [
    ["icp4", createIconPng(16)],
    ["icp5", createIconPng(32)],
    ["icp6", createIconPng(64)],
    ["ic07", createIconPng(128)],
    ["ic08", createIconPng(256)],
    ["ic09", createIconPng(512)],
    ["ic10", createIconPng(1024)],
  ].map(([type, data]) => icnsBlock(type, data));
  const payload = Buffer.concat(blocks);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(payload.length + 8, 4);
  fs.writeFileSync(ICNS_PATH, Buffer.concat([header, payload]));
}

function plistBuddy(args) {
  const result = spawnSync("/usr/libexec/PlistBuddy", args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`PlistBuddy failed: ${args.join(" ")}`);
}

function setPlistValue(plist, key, type, value) {
  const encoded = String(value);
  let result = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${encoded}`, plist]);
  if (result.status !== 0) {
    plistBuddy(["-c", `Add :${key} ${type} ${encoded}`, plist]);
  }
}

function copyAppSource(resourcesDir) {
  const appDir = path.join(resourcesDir, "app");
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  const packageJson = require(path.join(ROOT, "package.json"));
  const packagedPackage = {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    main: packageJson.main,
    type: packageJson.type,
    license: packageJson.license,
  };
  fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify(packagedPackage, null, 2));
  fs.cpSync(path.join(ROOT, "src"), path.join(appDir, "src"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(appDir, "LICENSE"));
  fs.copyFileSync(path.join(ROOT, "README.md"), path.join(appDir, "README.md"));
}

function packageMacApp() {
  ensureElectronApp();
  generateIcns();

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.rmSync(OUT_APP, { recursive: true, force: true });
  fs.cpSync(ELECTRON_APP, OUT_APP, { recursive: true });

  const contentsDir = path.join(OUT_APP, "Contents");
  const resourcesDir = path.join(contentsDir, "Resources");
  const plist = path.join(contentsDir, "Info.plist");
  fs.copyFileSync(ICNS_PATH, path.join(resourcesDir, "DeepSeekMonitor.icns"));
  copyAppSource(resourcesDir);

  setPlistValue(plist, "CFBundleDisplayName", "string", APP_NAME);
  setPlistValue(plist, "CFBundleName", "string", APP_NAME);
  setPlistValue(plist, "CFBundleIdentifier", "string", BUNDLE_ID);
  setPlistValue(plist, "CFBundleIconFile", "string", "DeepSeekMonitor.icns");
  setPlistValue(plist, "CFBundleShortVersionString", "string", VERSION);
  setPlistValue(plist, "CFBundleVersion", "string", VERSION);
  setPlistValue(plist, "LSApplicationCategoryType", "string", "public.app-category.developer-tools");
  setPlistValue(plist, "LSUIElement", "bool", "true");

  console.log(`Packaged ${OUT_APP}`);
}

if (process.argv.includes("--icons-only")) {
  generateIcns();
  console.log(`Generated ${DEFAULT_ICNS_PATH} and ${DEFAULT_ICO_PATH}`);
} else if (process.argv.includes("--ico-only")) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  generateIco();
  console.log(`Generated ${DEFAULT_ICO_PATH}`);
} else {
  packageMacApp();
}
