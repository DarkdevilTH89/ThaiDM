#!/usr/bin/env node
/**
 * Packages the cross-browser MV3 extension in `extension/` into:
 *   - dist/thaidm-extension-chromium.zip (Chrome, Edge, Brave)
 *   - dist/thaidm-extension-firefox.zip  (Mozilla Firefox)
 *
 * Uses a zero-dependency standard ZIP writer (deflate + CRC32) so it runs identically
 * on Windows, macOS, and Linux.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const extDir = path.join(rootDir, "extension");
const distDir = path.join(rootDir, "dist");

// Precompute CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, "/"), "utf8");
    const rawData = entry.data;
    const compressed = zlib.deflateRawSync(rawData, { level: 9 });
    const checksum = crc32(rawData);

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8); // deflate compression
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x5421, 12); // mod date
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, compressed);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirBuf, eocd]);
}

function collectFiles(dir, baseRel = "") {
  const results = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    const rel = baseRel ? `${baseRel}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) {
      results.push(...collectFiles(full, rel));
    } else if (dirent.isFile()) {
      results.push({ name: rel, data: fs.readFileSync(full) });
    }
  }
  return results;
}

// Validate extension before packaging
execFileSync(process.execPath, [path.join(__dirname, "build-extension.mjs")], {
  stdio: "inherit",
});

fs.mkdirSync(distDir, { recursive: true });

const baseEntries = collectFiles(extDir);
const manifestEntry = baseEntries.find((e) => e.name === "manifest.json");
if (!manifestEntry) {
  throw new Error("extension/manifest.json not found");
}
const rawManifest = JSON.parse(manifestEntry.data.toString("utf8"));

// 1. Chromium ZIP (clean service_worker manifest without Firefox-only warnings)
const chromiumManifest = structuredClone(rawManifest);
delete chromiumManifest.browser_specific_settings;
if (chromiumManifest.background) {
  delete chromiumManifest.background.scripts;
}
const chromiumEntries = baseEntries.map((e) =>
  e.name === "manifest.json"
    ? { name: e.name, data: Buffer.from(JSON.stringify(chromiumManifest, null, 2) + "\n", "utf8") }
    : e
);
const chromiumZipPath = path.join(distDir, "thaidm-extension-chromium.zip");
fs.writeFileSync(chromiumZipPath, buildZip(chromiumEntries));

// 2. Firefox ZIP (preserves gecko browser_specific_settings and scripts event page)
const firefoxManifest = structuredClone(rawManifest);
if (firefoxManifest.background) {
  delete firefoxManifest.background.service_worker;
}
const firefoxEntries = baseEntries.map((e) =>
  e.name === "manifest.json"
    ? { name: e.name, data: Buffer.from(JSON.stringify(firefoxManifest, null, 2) + "\n", "utf8") }
    : e
);
const firefoxZipPath = path.join(distDir, "thaidm-extension-firefox.zip");
fs.writeFileSync(firefoxZipPath, buildZip(firefoxEntries));

console.log(`[package-extension] Created: ${chromiumZipPath}`);
console.log(`[package-extension] Created: ${firefoxZipPath}`);
