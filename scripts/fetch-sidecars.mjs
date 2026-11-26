#!/usr/bin/env node
/**
 * Fetches official yt-dlp and ffmpeg binaries and places them in `src-tauri/binaries/`
 * renamed with the exact Tauri v2 target triple suffix.
 *
 * Usage:
 *   node scripts/fetch-sidecars.mjs
 *   node scripts/fetch-sidecars.mjs --target aarch64-apple-darwin
 *   node scripts/fetch-sidecars.mjs --target x86_64-pc-windows-msvc
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.resolve(__dirname, "..", "src-tauri", "binaries");

function detectTargetTriple() {
  const argIdx = process.argv.indexOf("--target");
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return process.argv[argIdx + 1];
  }
  const platform = os.platform();
  const arch = os.arch();
  if (platform === "win32") {
    return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
}

async function downloadToFile(url, destPath) {
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  console.log(`Saved ${(buf.length / (1024 * 1024)).toFixed(1)} MB -> ${destPath}`);
}

function ytDlpAssetUrl(triple) {
  if (triple.includes("windows")) {
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
  }
  if (triple.includes("apple-darwin")) {
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
  }
  return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
}

function ffmpegAssetInfo(triple) {
  if (triple.includes("windows")) {
    return {
      url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
      archiveType: "zip",
      binaryName: "ffmpeg.exe",
    };
  }
  if (triple.includes("apple-darwin")) {
    return {
      url: "https://evermeet.cx/ffmpeg/getrelease/zip",
      archiveType: "zip",
      binaryName: "ffmpeg",
    };
  }
  return {
    url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz",
    archiveType: "tar.xz",
    binaryName: "ffmpeg",
  };
}

function findFileRecursive(dir, targetName) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, targetName);
      if (found) return found;
    } else if (entry.name.toLowerCase() === targetName.toLowerCase()) {
      return full;
    }
  }
  return null;
}

async function main() {
  const triple = detectTargetTriple();
  const ext = triple.includes("windows") ? ".exe" : "";
  fs.mkdirSync(BIN_DIR, { recursive: true });

  console.log(`Preparing ไทยDM sidecars for target triple: ${triple}`);

  // 1. Fetch yt-dlp
  const ytDlpDest = path.join(BIN_DIR, `yt-dlp-${triple}${ext}`);
  if (!fs.existsSync(ytDlpDest) || process.argv.includes("--force")) {
    await downloadToFile(ytDlpAssetUrl(triple), ytDlpDest);
    if (!triple.includes("windows")) fs.chmodSync(ytDlpDest, 0o755);
  } else {
    console.log(`yt-dlp already present: ${ytDlpDest}`);
  }

  // 2. Fetch ffmpeg
  const ffmpegDest = path.join(BIN_DIR, `ffmpeg-${triple}${ext}`);
  if (!fs.existsSync(ffmpegDest) || process.argv.includes("--force")) {
    const ffInfo = ffmpegAssetInfo(triple);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "thaidm-ffmpeg-"));
    try {
      const archivePath = path.join(tmpDir, `ffmpeg.${ffInfo.archiveType}`);
      await downloadToFile(ffInfo.url, archivePath);

      if (ffInfo.archiveType === "zip") {
        if (os.platform() === "win32") {
          execFileSync(
            "powershell",
            [
              "-NoProfile",
              "-Command",
              `Expand-Archive -Path '${archivePath}' -DestinationPath '${tmpDir}\\out' -Force`,
            ],
            { stdio: "inherit" }
          );
        } else {
          execFileSync("unzip", ["-q", archivePath, "-d", path.join(tmpDir, "out")], {
            stdio: "inherit",
          });
        }
      } else {
        fs.mkdirSync(path.join(tmpDir, "out"), { recursive: true });
        execFileSync("tar", ["-xf", archivePath, "-C", path.join(tmpDir, "out")], {
          stdio: "inherit",
        });
      }

      const extracted = findFileRecursive(path.join(tmpDir, "out"), ffInfo.binaryName);
      if (!extracted) {
        throw new Error(`Could not locate ${ffInfo.binaryName} inside downloaded archive.`);
      }
      fs.copyFileSync(extracted, ffmpegDest);
      if (!triple.includes("windows")) fs.chmodSync(ffmpegDest, 0o755);
      console.log(`Installed ffmpeg sidecar -> ${ffmpegDest}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } else {
    console.log(`ffmpeg already present: ${ffmpegDest}`);
  }

  console.log("All ไทยDM sidecars ready!");
}

main().catch((err) => {
  console.error("Failed to fetch sidecars:", err);
  process.exit(1);
});
