# ไทยDM (ThaiDM) — Desktop Download Manager

A classic IDM-inspired desktop download manager styled in a glossy Royal Blue theme, built with **Tauri v2**, **Rust**, **React**, **TypeScript**, and **Tailwind CSS**, paired with a cross-browser Manifest V3 extension for **Chrome, Edge, Brave, and Firefox**.

## Features

- **Classic IDM-Style Interface:** Glossy Royal Blue toolbar, collapsible category sidebar (`All`, `Video`, `Music`, `Documents`, `Programs`, `Compressed`, `Unfinished`, `Finished`), multi-select queue table, right-click context menu, and live status bar.
- **Direct HTTP/HTTPS Downloads (`reqwest` + `tokio`):** Pause/Resume via HTTP `Range` headers, live speed calculation, ETA, and persistent queue (`queue.json`).
- **YouTube & Social Media Grabber (`yt-dlp` + `ffmpeg` sidecars):** Auto-probes video title, thumbnail, duration, and quality options (`Best MP4`, `1080p`, `720p`, `Audio MP3`) with optional thumbnail & metadata embedding and built-in `yt-dlp` self-updater.
- **Localhost Browser Bridge (`127.0.0.1:17890`):** Loopback-only Axum HTTP bridge connecting the desktop app with Chrome, Edge, Brave, and Firefox without breaking browser downloads when the desktop app is offline.
- **Cross-Browser Manifest V3 Extension (`extension/`):** Intercepts archives/PDFs/installers/videos, adds `"Download with ไทยDM"` context menus, and injects a Shadow DOM-isolated draggable `"Download with ไทยDM"` floating pill on YouTube, TikTok, Facebook, Instagram, and X.
- **System Tray & Settings:** Minimizes to the Windows system tray / macOS menu bar to keep the browser bridge active, with persistent settings (`settings.json`).

## Quick Install (Windows)

Download from the **[Releases](../../releases/latest)** page:
1. Run **`ไทยDM_0.1.0_x64-setup.exe`** (or `.msi`) — includes bundled `yt-dlp` and `ffmpeg`.
2. Install the browser extension:
   - **Chrome / Edge / Brave:** Unzip `thaidm-extension-chromium.zip` (or use the `extension/` folder), open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
   - **Firefox:** Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and select `manifest.json` from `extension/` (or `thaidm-extension-firefox.zip`).

## Development

```bash
# 1. Install frontend dependencies
npm install

# 2. Fetch official yt-dlp & ffmpeg sidecars for your platform
npm run fetch-sidecars

# 3. Run in desktop dev mode
npm run tauri dev

# 4. Build native installer & package browser extensions
npm run tauri build
npm run package:extension
```
