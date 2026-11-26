export type DownloadCategory =
  | "video"
  | "music"
  | "documents"
  | "programs"
  | "compressed";

export type SidebarFilter =
  | "all"
  | DownloadCategory
  | "unfinished"
  | "finished";

export type DownloadStatus = "downloading" | "completed" | "paused" | "queued" | "error";

export interface DownloadItem {
  id: string;
  fileName: string;
  url: string;
  saveDir: string;
  category: DownloadCategory;
  sizeBytes: number;
  downloadedBytes?: number;
  progress: number; // 0..100
  status: DownloadStatus;
  timeLeft: string;
  speedKBps: number; // mapped from speedKbps in Rust
  lastTryDate: string;
  sourceLabel?: string | null;
  isMedia?: boolean;
  formatSelector?: string | null;
  audioOnly?: boolean;
  errorMessage?: string | null;
}

export interface MediaFormatOption {
  id: string;
  label: string;
  formatSelector: string;
  ext: string;
  audioOnly: boolean;
  filesizeApprox?: number | null;
}

export interface MediaProbeResult {
  url: string;
  title: string;
  uploader?: string | null;
  thumbnail?: string | null;
  durationSeconds?: number | null;
  extractor?: string | null;
  formats: MediaFormatOption[];
}

export interface SidecarStatus {
  ytDlpReady: boolean;
  ffmpegReady: boolean;
  ytDlpPath?: string | null;
  ffmpegPath?: string | null;
  defaultDownloadDir: string;
}

export interface DownloadProgressEvent {
  id: string;
  downloadedBytes: number;
  sizeBytes: number;
  progress: number;
  speedKbps: number;
  timeLeft: string;
}

export interface DownloadStatusEvent {
  id: string;
  status: DownloadStatus;
  progress: number;
  sizeBytes: number;
  downloadedBytes: number;
  fileName: string;
  lastTryDate: string;
}

export interface DownloadErrorEvent {
  id: string;
  message: string;
}

export interface BridgeStatus {
  online: boolean;
  address: string;
  error?: string | null;
}

export interface BridgeUrlEvent {
  url: string;
  filename?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  isMedia: boolean;
  autoStarted: boolean;
}

export type PreferredQuality = "best_mp4" | "1080p" | "720p" | "audio_mp3";

export interface AppSettings {
  defaultDownloadDir: string;
  maxConcurrent: number;
  autoStartBridgeDownloads: boolean;
  minimizeToTrayOnClose: boolean;
  preferredQuality: PreferredQuality;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  bridgePort: number;
}

export interface DiagnosticsInfo {
  bridge: BridgeStatus;
  ytDlpVersion?: string | null;
  ffmpegVersion?: string | null;
  ytDlpPath?: string | null;
  ffmpegPath?: string | null;
  usingUpdatedYtDlp: boolean;
}

export interface UpdateYtDlpResult {
  updated: boolean;
  version?: string | null;
  path: string;
  message: string;
}

export const CATEGORY_LABELS: Record<DownloadCategory, string> = {
  video: "Video (YouTube / Social)",
  music: "Music",
  documents: "Documents",
  programs: "Programs",
  compressed: "Compressed",
};

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(idx >= 2 ? 2 : 1)} ${units[idx]}`;
}

export function formatSpeed(speedKBps: number): string {
  if (!speedKBps || speedKBps <= 0) return "0 KB/s";
  if (speedKBps >= 1024) {
    return `${(speedKBps / 1024).toFixed(2)} MB/s`;
  }
  return `${Math.round(speedKBps)} KB/s`;
}

export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

const MEDIA_HOSTS = [
  "youtube.com",
  "youtu.be",
  "music.youtube.com",
  "tiktok.com",
  "facebook.com",
  "fb.watch",
  "instagram.com",
  "twitter.com",
  "x.com",
  "vimeo.com",
  "dailymotion.com",
  "bilibili.com",
];

export function isMediaSiteUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return MEDIA_HOSTS.some((h) => lower.includes(h));
}

export function inferCategoryFromUrl(url: string, fileName: string): DownloadCategory {
  const combined = `${url} ${fileName}`.toLowerCase();
  if (isMediaSiteUrl(url) || /\.(mp4|mkv|webm|mov|avi)\b/.test(combined)) {
    return "video";
  }
  if (/\.(mp3|flac|wav|m4a|aac|ogg)\b/.test(combined)) {
    return "music";
  }
  if (/\.(pdf|docx?|xlsx?|pptx?|odt|txt|epub)\b/.test(combined)) {
    return "documents";
  }
  if (/\.(exe|msi|dmg|pkg|deb|appimage)\b/.test(combined)) {
    return "programs";
  }
  if (/\.(zip|rar|7z|tar|gz)\b/.test(combined)) {
    return "compressed";
  }
  return "documents";
}

export function inferFileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && last.includes(".")) {
      return decodeURIComponent(last);
    }
    if (parsed.hostname.includes("youtube") || parsed.hostname.includes("youtu.be")) {
      return "YouTube_Video.mp4";
    }
    if (parsed.hostname.includes("tiktok") || parsed.hostname.includes("instagram")) {
      return "Social_Clip.mp4";
    }
    return `${parsed.hostname.replace(/^www\./, "")}_download.bin`;
  } catch {
    return "downloaded_file.bin";
  }
}

export function formatNowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
