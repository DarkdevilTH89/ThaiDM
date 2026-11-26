/**
 * ไทยDM (ThaiDM) Cross-Browser Background Script (Chrome, Edge, Brave, Firefox MV3)
 * All localhost bridge requests run from here to bypass page CSP and Brave Shields.
 */

const ext = globalThis.browser ?? globalThis.chrome;

const BRIDGE_BASE = "http://127.0.0.1:17890";
const HEALTH_TIMEOUT_MS = 500;
const ADD_TIMEOUT_MS = 4000;
const CONTEXT_MENU_ID = "thaidm-download-item";
const SIZE_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5 MB

const INTERCEPT_EXTENSIONS = [
  ".zip",
  ".rar",
  ".7z",
  ".pdf",
  ".exe",
  ".dmg",
  ".pkg",
  ".mp4",
  ".mkv",
  ".mp3",
  ".iso",
];

const MEDIA_HOSTS = [
  "youtube.com",
  "youtu.be",
  "music.youtube.com",
  "tiktok.com",
  "facebook.com",
  "fb.watch",
  "instagram.com",
  "x.com",
  "twitter.com",
];

function storageGet(defaults) {
  return new Promise((resolve) => {
    try {
      const maybePromise = ext.storage.local.get(defaults, (res) => {
        if (ext.runtime?.lastError) {
          resolve({ ...defaults });
        } else {
          resolve(res ?? { ...defaults });
        }
      });
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then((res) => resolve(res ?? { ...defaults })).catch(() => resolve({ ...defaults }));
      }
    } catch {
      resolve({ ...defaults });
    }
  });
}

function storageSet(values) {
  return new Promise((resolve) => {
    try {
      const maybePromise = ext.storage.local.set(values, () => resolve());
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(() => resolve()).catch(() => resolve());
      }
    } catch {
      resolve();
    }
  });
}

function queryActiveTab() {
  return new Promise((resolve) => {
    try {
      const maybePromise = ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(Array.isArray(tabs) ? tabs[0] ?? null : null);
      });
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then((tabs) => resolve(Array.isArray(tabs) ? tabs[0] ?? null : null)).catch(() => resolve(null));
      }
    } catch {
      resolve(null);
    }
  });
}

function cancelAndEraseDownload(downloadId) {
  try {
    const cancelRes = ext.downloads.cancel(downloadId);
    if (cancelRes && typeof cancelRes.catch === "function") {
      cancelRes.catch(() => {});
    }
  } catch {
    // Ignore if already canceled
  }
  try {
    const eraseRes = ext.downloads.erase({ id: downloadId });
    if (eraseRes && typeof eraseRes.catch === "function") {
      eraseRes.catch(() => {});
    }
  } catch {
    // Ignore erase errors
  }
}

function isHttpUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

function isMediaUrl(url) {
  if (!isHttpUrl(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return MEDIA_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function extractBaseFilename(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return undefined;
  const normalized = rawPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

function matchesInterceptCriteria(downloadItem) {
  const url = (downloadItem.finalUrl || downloadItem.url || "").toLowerCase();
  const filename = (downloadItem.filename || "").toLowerCase();

  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    pathname = url;
  }

  const extMatch = INTERCEPT_EXTENSIONS.some(
    (suffix) => pathname.endsWith(suffix) || filename.endsWith(suffix)
  );
  if (extMatch) return true;

  if (typeof downloadItem.totalBytes === "number" && downloadItem.totalBytes >= SIZE_THRESHOLD_BYTES) {
    return true;
  }

  return false;
}

async function pingBridge(timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${BRIDGE_BASE}/health`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!resp.ok) {
      return { online: false, info: null };
    }
    const info = await resp.json();
    return { online: info?.status === "ok", info };
  } catch {
    return { online: false, info: null };
  } finally {
    clearTimeout(timer);
  }
}

async function sendToBridge(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ADD_TIMEOUT_MS);
  try {
    const body = {
      url: payload.url,
      filename: payload.filename || undefined,
      referrer: payload.referrer || undefined,
      user_agent: payload.user_agent || globalThis.navigator?.userAgent || undefined,
      is_media: typeof payload.is_media === "boolean" ? payload.is_media : isMediaUrl(payload.url),
      auto_start: Boolean(payload.auto_start),
    };

    const resp = await fetch(`${BRIDGE_BASE}/add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.accepted === false) {
      return {
        ok: false,
        offline: false,
        message: data.message || `Bridge returned HTTP ${resp.status}`,
      };
    }
    return {
      ok: true,
      offline: false,
      message: data.message || "Sent to ไทยDM.",
      autoStarted: Boolean(data.auto_started),
    };
  } catch {
    return {
      ok: false,
      offline: true,
      message: "ไทยDM desktop app is offline.",
    };
  } finally {
    clearTimeout(timer);
  }
}

// Register right-click context menu for links, videos, and audio
function ensureContextMenus() {
  if (!ext.contextMenus) return;
  try {
    const removeAllRes = ext.contextMenus.removeAll(() => {
      try {
        ext.contextMenus.create({
          id: CONTEXT_MENU_ID,
          title: "Download with ไทยDM",
          contexts: ["link", "video", "audio"],
        });
      } catch {
        // Ignore duplicate menu ID races
      }
    });
    if (removeAllRes && typeof removeAllRes.then === "function") {
      removeAllRes
        .then(() => {
          ext.contextMenus.create({
            id: CONTEXT_MENU_ID,
            title: "Download with ไทยDM",
            contexts: ["link", "video", "audio"],
          });
        })
        .catch(() => {});
    }
  } catch {
    // Ignore context menu setup errors
  }
}

ext.runtime.onInstalled.addListener(async () => {
  const existing = await storageGet({ interceptEnabled: null });
  if (existing.interceptEnabled === null) {
    await storageSet({ interceptEnabled: true });
  }
  ensureContextMenus();
});

if (ext.runtime.onStartup) {
  ext.runtime.onStartup.addListener(() => {
    ensureContextMenus();
  });
}

// Also ensure context menu exists when service worker / event page wakes up
ensureContextMenus();

if (ext.contextMenus?.onClicked) {
  ext.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID) return;
    const targetUrl = info.linkUrl || info.srcUrl || info.pageUrl || tab?.url;
    if (!isHttpUrl(targetUrl)) return;

    const isMedia = info.mediaType === "video" || info.mediaType === "audio" || isMediaUrl(targetUrl);
    await sendToBridge({
      url: targetUrl,
      referrer: info.pageUrl || tab?.url,
      is_media: isMedia,
    });
  });
}

// Browser download interception with safe offline fallback
if (ext.downloads?.onCreated) {
  ext.downloads.onCreated.addListener(async (downloadItem) => {
    const url = downloadItem.finalUrl || downloadItem.url;
    if (!isHttpUrl(url)) return;

    const settings = await storageGet({ interceptEnabled: true });
    if (!settings.interceptEnabled) return;

    if (!matchesInterceptCriteria(downloadItem)) return;

    // Fast ~500ms health check before touching the browser download
    const health = await pingBridge(HEALTH_TIMEOUT_MS);
    if (!health.online) {
      // Desktop app is offline -> let the browser download proceed untouched
      return;
    }

    const result = await sendToBridge({
      url,
      filename: extractBaseFilename(downloadItem.filename),
      referrer: downloadItem.referrer,
      is_media: isMediaUrl(url),
    });

    if (result.ok) {
      cancelAndEraseDownload(downloadItem.id);
    }
  });
}

// Unified message handler for popup.js and content.js
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    switch (message?.type) {
      case "CHECK_HEALTH": {
        return await pingBridge(HEALTH_TIMEOUT_MS);
      }
      case "GET_SETTINGS": {
        const settings = await storageGet({ interceptEnabled: true });
        return { interceptEnabled: Boolean(settings.interceptEnabled) };
      }
      case "SET_SETTINGS": {
        const next = { interceptEnabled: Boolean(message.interceptEnabled) };
        await storageSet(next);
        return next;
      }
      case "SEND_TO_THAIDM": {
        const url = message.payload?.url || sender?.tab?.url;
        if (!isHttpUrl(url)) {
          return { ok: false, offline: false, message: "No valid http(s) URL found." };
        }
        return await sendToBridge({
          url,
          filename: message.payload?.filename,
          referrer: message.payload?.referrer || sender?.tab?.url,
          is_media: message.payload?.is_media,
          auto_start: message.payload?.auto_start,
        });
      }
      case "GRAB_CURRENT_TAB": {
        const tab = await queryActiveTab();
        if (!tab || !isHttpUrl(tab.url)) {
          return { ok: false, offline: false, message: "Active tab does not have an http(s) URL." };
        }
        return await sendToBridge({
          url: tab.url,
          referrer: tab.url,
          is_media: true,
        });
      }
      default:
        return { ok: false, message: "Unknown message type." };
    }
  };

  handle()
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ ok: false, message: String(err) }));

  return true; // Keep message channel open for async response
});
