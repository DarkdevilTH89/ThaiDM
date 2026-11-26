pub mod http;
pub mod manager;
pub mod media;

use chrono::Local;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const EVENT_DOWNLOAD_PROGRESS: &str = "download-progress";
pub const EVENT_DOWNLOAD_STATUS: &str = "download-status-changed";
pub const EVENT_DOWNLOAD_ERROR: &str = "download-error";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadCategory {
    Video,
    Music,
    Documents,
    Programs,
    Compressed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Downloading,
    Completed,
    Paused,
    Queued,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: String,
    pub file_name: String,
    pub url: String,
    pub save_dir: String,
    pub category: DownloadCategory,
    pub size_bytes: u64,
    pub downloaded_bytes: u64,
    pub progress: f64,
    pub status: DownloadStatus,
    pub time_left: String,
    pub speed_kbps: f64,
    pub last_try_date: String,
    pub source_label: Option<String>,
    pub is_media: bool,
    pub format_selector: Option<String>,
    pub audio_only: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDownloadRequest {
    pub url: String,
    pub file_name: Option<String>,
    pub save_dir: String,
    pub category: DownloadCategory,
    pub start_now: bool,
    pub format_selector: Option<String>,
    pub audio_only: Option<bool>,
    pub source_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFormatOption {
    pub id: String,
    pub label: String,
    pub format_selector: String,
    pub ext: String,
    pub audio_only: bool,
    pub filesize_approx: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbeResult {
    pub url: String,
    pub title: String,
    pub uploader: Option<String>,
    pub thumbnail: Option<String>,
    pub duration_seconds: Option<u64>,
    pub extractor: Option<String>,
    pub formats: Vec<MediaFormatOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub yt_dlp_ready: bool,
    pub ffmpeg_ready: bool,
    pub yt_dlp_path: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub default_download_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub id: String,
    pub downloaded_bytes: u64,
    pub size_bytes: u64,
    pub progress: f64,
    pub speed_kbps: f64,
    pub time_left: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadStatusEvent {
    pub id: String,
    pub status: DownloadStatus,
    pub progress: f64,
    pub size_bytes: u64,
    pub downloaded_bytes: u64,
    pub file_name: String,
    pub last_try_date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadErrorEvent {
    pub id: String,
    pub message: String,
}

pub fn now_timestamp() -> String {
    Local::now().format("%Y-%m-%d %H:%M").to_string()
}

pub fn format_eta(seconds: u64) -> String {
    if seconds == 0 {
        return "00:00".to_string();
    }
    let hrs = seconds / 3600;
    let mins = (seconds % 3600) / 60;
    let secs = seconds % 60;
    if hrs > 0 {
        format!("{hrs:02}:{mins:02}:{secs:02}")
    } else {
        format!("{mins:02}:{secs:02}")
    }
}

pub fn default_download_dir() -> String {
    let base = dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("ThaiDM").to_string_lossy().to_string()
}

pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "thaidm_download.bin".to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
}

pub fn infer_filename_from_url(raw_url: &str, audio_only: bool) -> String {
    if let Ok(parsed) = url::Url::parse(raw_url) {
        if let Some(mut segments) = parsed.path_segments() {
            if let Some(last) = segments.next_back().filter(|s| !s.is_empty()) {
                if last.contains('.') {
                    return sanitize_filename(last);
                }
            }
        }
        let host = parsed.host_str().unwrap_or("download").replace("www.", "");
        let ext = if audio_only { "mp3" } else if is_media_site_url(raw_url) { "mp4" } else { "bin" };
        return sanitize_filename(&format!("{host}_media.{ext}"));
    }
    "thaidm_download.bin".to_string()
}

pub fn is_media_site_url(raw_url: &str) -> bool {
    let lower = raw_url.to_lowercase();
    const MEDIA_HOSTS: [&str; 12] = [
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
    MEDIA_HOSTS.iter().any(|h| lower.contains(h))
}

fn current_target_triple() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64", target_env = "gnu"))]
    {
        "x86_64-pc-windows-gnu"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64", not(target_env = "gnu")))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        "aarch64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "aarch64-unknown-linux-gnu"
    }
}

/// Path inside the Tauri app data directory where an auto-updated sidecar binary is stored.
pub fn app_data_binary_path(app: &AppHandle, base_name: &str) -> Option<PathBuf> {
    let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("bin").join(format!("{base_name}{ext}")))
}

/// Resolve a bundled Tauri sidecar (`yt-dlp` or `ffmpeg`) across:
/// 0. User-updated binary in app data directory (`<app_data_dir>/bin/`),
/// 1. Production bundle sibling directory,
/// 2. Resource directory,
/// 3. Dev repo `src-tauri/binaries/`,
/// 4. System PATH fallback.
pub fn resolve_sidecar_binary(app: &AppHandle, base_name: &str) -> Option<PathBuf> {
    let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };
    let triple = current_target_triple();
    let triple_name = format!("{base_name}-{triple}{ext}");
    let plain_name = format!("{base_name}{ext}");

    let mut candidates: Vec<PathBuf> = Vec::new();

    // 0. User-updated binary in app data directory (e.g. updated yt-dlp)
    if let Some(updated_path) = app_data_binary_path(app, base_name) {
        candidates.push(updated_path);
    }

    // 1. Packaged Tauri binary sibling directory
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(&plain_name));
            candidates.push(exe_dir.join(&triple_name));
            candidates.push(exe_dir.join("binaries").join(&triple_name));
            candidates.push(exe_dir.join("binaries").join(&plain_name));
        }
    }

    // 2. Resource directory
    if let Ok(res_dir) = app.path().resource_dir() {
        candidates.push(res_dir.join("binaries").join(&triple_name));
        candidates.push(res_dir.join("binaries").join(&plain_name));
        candidates.push(res_dir.join(&plain_name));
    }

    // 3. Dev repo `src-tauri/binaries`
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("binaries").join(&triple_name));
    candidates.push(manifest_dir.join("binaries").join(&plain_name));

    for path in candidates {
        if path.is_file() {
            return Some(path);
        }
    }

    // 4. Fallback to system PATH
    if let Ok(path_env) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_env) {
            let p = dir.join(&plain_name);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    None
}
