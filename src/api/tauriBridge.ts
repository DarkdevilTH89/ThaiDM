/**
 * Typed bridge between the React frontend and Tauri v2 Rust commands/events.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  BridgeStatus,
  BridgeUrlEvent,
  DiagnosticsInfo,
  DownloadCategory,
  DownloadErrorEvent,
  DownloadItem,
  DownloadProgressEvent,
  DownloadStatusEvent,
  MediaProbeResult,
  SidecarStatus,
  UpdateYtDlpResult,
} from "../types/download";

interface RawRustDownloadItem {
  id: string;
  fileName: string;
  url: string;
  saveDir: string;
  category: DownloadCategory;
  sizeBytes: number;
  downloadedBytes: number;
  progress: number;
  status: DownloadItem["status"];
  timeLeft: string;
  speedKbps: number;
  lastTryDate: string;
  sourceLabel?: string | null;
  isMedia: boolean;
  formatSelector?: string | null;
  audioOnly: boolean;
  errorMessage?: string | null;
}

function normalizeRustItem(raw: RawRustDownloadItem): DownloadItem {
  return {
    id: raw.id,
    fileName: raw.fileName,
    url: raw.url,
    saveDir: raw.saveDir,
    category: raw.category,
    sizeBytes: raw.sizeBytes,
    downloadedBytes: raw.downloadedBytes,
    progress: raw.progress,
    status: raw.status,
    timeLeft: raw.timeLeft,
    speedKBps: raw.speedKbps ?? 0,
    lastTryDate: raw.lastTryDate,
    sourceLabel: raw.sourceLabel,
    isMedia: raw.isMedia,
    formatSelector: raw.formatSelector,
    audioOnly: raw.audioOnly,
    errorMessage: raw.errorMessage,
  };
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function checkSidecars(): Promise<SidecarStatus> {
  if (!isTauriRuntime()) {
    return {
      ytDlpReady: false,
      ffmpegReady: false,
      ytDlpPath: null,
      ffmpegPath: null,
      defaultDownloadDir: "C:\\Users\\Downloads\\ThaiDM",
    };
  }
  return invoke<SidecarStatus>("check_sidecars");
}

export async function getBridgeStatus(): Promise<BridgeStatus> {
  if (!isTauriRuntime()) {
    return {
      online: false,
      address: "127.0.0.1:17890",
      error: "Running outside Tauri desktop runtime",
    };
  }
  return invoke<BridgeStatus>("get_bridge_status");
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultDownloadDir: "C:\\Users\\Downloads\\ThaiDM",
  maxConcurrent: 3,
  autoStartBridgeDownloads: false,
  minimizeToTrayOnClose: true,
  preferredQuality: "best_mp4",
  embedThumbnail: true,
  embedMetadata: true,
  bridgePort: 17890,
};

export async function getSettings(): Promise<AppSettings> {
  if (!isTauriRuntime()) {
    return { ...DEFAULT_APP_SETTINGS };
  }
  return invoke<AppSettings>("get_settings");
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  if (!isTauriRuntime()) {
    return settings;
  }
  return invoke<AppSettings>("save_settings", { settings });
}

export async function getDiagnostics(): Promise<DiagnosticsInfo> {
  if (!isTauriRuntime()) {
    return {
      bridge: {
        online: false,
        address: "127.0.0.1:17890",
        error: "Running outside Tauri desktop runtime",
      },
      ytDlpVersion: null,
      ffmpegVersion: null,
      ytDlpPath: null,
      ffmpegPath: null,
      usingUpdatedYtDlp: false,
    };
  }
  return invoke<DiagnosticsInfo>("get_diagnostics");
}

export async function updateYtDlp(): Promise<UpdateYtDlpResult> {
  if (!isTauriRuntime()) {
    throw new Error("yt-dlp update requires the Tauri desktop runtime.");
  }
  return invoke<UpdateYtDlpResult>("update_yt_dlp");
}

export async function listDownloads(): Promise<DownloadItem[]> {
  if (!isTauriRuntime()) return [];
  const raw = await invoke<RawRustDownloadItem[]>("list_downloads");
  return raw.map(normalizeRustItem);
}

export async function probeMedia(url: string): Promise<MediaProbeResult> {
  if (!isTauriRuntime()) {
    throw new Error("Media probing requires the Tauri desktop runtime.");
  }
  return invoke<MediaProbeResult>("probe_media", { url });
}

export async function addDownload(request: {
  url: string;
  fileName?: string;
  saveDir: string;
  category: DownloadCategory;
  startNow: boolean;
  formatSelector?: string;
  audioOnly?: boolean;
  sourceLabel?: string;
}): Promise<DownloadItem> {
  if (!isTauriRuntime()) {
    throw new Error("Run inside the Tauri desktop app (`npm run tauri dev`) to start real downloads.");
  }
  const raw = await invoke<RawRustDownloadItem>("add_download", { request });
  return normalizeRustItem(raw);
}

export async function pauseDownload(id: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>("pause_download", { id });
}

export async function resumeDownload(id: string): Promise<DownloadItem | null> {
  if (!isTauriRuntime()) return null;
  const raw = await invoke<RawRustDownloadItem>("resume_download", { id });
  return normalizeRustItem(raw);
}

export async function stopAllDownloads(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>("stop_all_downloads");
}

export async function deleteDownload(id: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>("delete_download", { id });
}

export async function openFile(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>("open_file", { path });
}

export async function openFolder(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke<void>("open_folder", { path });
}

export async function pickDownloadFolder(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return invoke<string | null>("pick_download_folder");
}

export async function subscribeDownloadEvents(handlers: {
  onProgress: (ev: DownloadProgressEvent) => void;
  onStatusChanged: (ev: DownloadStatusEvent) => void;
  onError: (ev: DownloadErrorEvent) => void;
}): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const [unProgress, unStatus, unError] = await Promise.all([
    listen<DownloadProgressEvent>("download-progress", (e) => handlers.onProgress(e.payload)),
    listen<DownloadStatusEvent>("download-status-changed", (e) =>
      handlers.onStatusChanged(e.payload)
    ),
    listen<DownloadErrorEvent>("download-error", (e) => handlers.onError(e.payload)),
  ]);

  return () => {
    unProgress();
    unStatus();
    unError();
  };
}

export async function subscribeBridgeEvents(handlers: {
  onStatusChanged: (status: BridgeStatus) => void;
  onUrlReceived: (ev: BridgeUrlEvent) => void;
}): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const [unBridgeStatus, unBridgeUrl] = await Promise.all([
    listen<BridgeStatus>("bridge-status-changed", (e) => handlers.onStatusChanged(e.payload)),
    listen<BridgeUrlEvent>("bridge-url-received", (e) => handlers.onUrlReceived(e.payload)),
  ]);

  return () => {
    unBridgeStatus();
    unBridgeUrl();
  };
}
