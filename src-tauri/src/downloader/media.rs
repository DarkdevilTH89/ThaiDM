use crate::downloader::manager::DownloadManager;
use crate::downloader::{
    app_data_binary_path, format_eta, resolve_sidecar_binary, sanitize_filename,
    DownloadErrorEvent, DownloadItem, DownloadProgressEvent, DownloadStatus, MediaFormatOption,
    MediaProbeResult, EVENT_DOWNLOAD_ERROR, EVENT_DOWNLOAD_PROGRESS,
};
use crate::settings::{AppSettings, SettingsStore};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn configure_hidden(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = cmd;
    }
}

/// Probe a YouTube, TikTok, Facebook, Instagram, X, or social video URL via `yt-dlp --dump-single-json`.
pub async fn probe_media(app: &AppHandle, url: &str) -> Result<MediaProbeResult, String> {
    let yt_dlp = resolve_sidecar_binary(app, "yt-dlp").ok_or_else(|| {
        "yt-dlp sidecar binary not found. Run `npm run fetch-sidecars` to install yt-dlp and ffmpeg."
            .to_string()
    })?;

    let mut cmd = Command::new(&yt_dlp);
    configure_hidden(&mut cmd);
    cmd.args([
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--skip-download",
        url,
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute yt-dlp sidecar: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp probe failed: {}", stderr.trim()));
    }

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse yt-dlp metadata JSON: {e}"))?;

    let title = json
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled Video")
        .to_string();
    let uploader = json
        .get("uploader")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let thumbnail = json
        .get("thumbnail")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let duration_seconds = json.get("duration").and_then(|v| v.as_u64());
    let extractor = json
        .get("extractor_key")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Collect available video resolutions from yt-dlp `formats`
    let mut heights: BTreeSet<u64> = BTreeSet::new();
    if let Some(arr) = json.get("formats").and_then(|v| v.as_array()) {
        for fmt in arr {
            if let Some(h) = fmt.get("height").and_then(|v| v.as_u64()) {
                if h >= 360 {
                    heights.insert(h);
                }
            }
        }
    }

    let mut options: Vec<MediaFormatOption> = vec![MediaFormatOption {
        id: "best-mp4".to_string(),
        label: "Best Quality (MP4)".to_string(),
        format_selector: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".to_string(),
        ext: "mp4".to_string(),
        audio_only: false,
        filesize_approx: json
            .get("filesize_approx")
            .and_then(|v| v.as_u64()),
    }];

    for target_h in [2160_u64, 1440, 1080, 720, 480] {
        if heights.contains(&target_h) || (heights.is_empty() && (target_h == 1080 || target_h == 720)) {
            let tag = match target_h {
                2160 => "4K 2160p (MP4)",
                1440 => "2K 1440p (MP4)",
                1080 => "Full HD 1080p (MP4)",
                720 => "HD 720p (MP4)",
                _ => "SD 480p (MP4)",
            };
            options.push(MediaFormatOption {
                id: format!("mp4-{target_h}p"),
                label: tag.to_string(),
                format_selector: format!(
                    "bestvideo[height<={target_h}][ext=mp4]+bestaudio[ext=m4a]/best[height<={target_h}]/best"
                ),
                ext: "mp4".to_string(),
                audio_only: false,
                filesize_approx: None,
            });
        }
    }

    options.push(MediaFormatOption {
        id: "audio-mp3".to_string(),
        label: "Audio Only (MP3 192kbps)".to_string(),
        format_selector: "bestaudio/best".to_string(),
        ext: "mp3".to_string(),
        audio_only: true,
        filesize_approx: None,
    });

    Ok(MediaProbeResult {
        url: url.to_string(),
        title,
        uploader,
        thumbnail,
        duration_seconds,
        extractor,
        formats: options,
    })
}

pub async fn run_media_download(
    app: AppHandle,
    manager: Arc<DownloadManager>,
    item: DownloadItem,
    token: CancellationToken,
) {
    let id = item.id.clone();
    let result = execute_yt_dlp_transfer(&app, &manager, &item, &token).await;

    manager.remove_token(&id);

    match result {
        Ok(MediaOutcome::Completed {
            total_bytes,
            downloaded_bytes,
        }) => {
            manager.update_status(
                &app,
                &id,
                DownloadStatus::Completed,
                100.0,
                total_bytes.max(downloaded_bytes),
                downloaded_bytes,
                None,
            );
        }
        Ok(MediaOutcome::Paused {
            total_bytes,
            downloaded_bytes,
            progress,
        }) => {
            manager.update_status(
                &app,
                &id,
                DownloadStatus::Paused,
                progress,
                total_bytes,
                downloaded_bytes,
                None,
            );
        }
        Err(err_msg) => {
            let _ = app.emit(
                EVENT_DOWNLOAD_ERROR,
                DownloadErrorEvent {
                    id: id.clone(),
                    message: err_msg.clone(),
                },
            );
            manager.update_status(
                &app,
                &id,
                DownloadStatus::Error,
                item.progress,
                item.size_bytes,
                item.downloaded_bytes,
                Some(err_msg),
            );
        }
    }
}

enum MediaOutcome {
    Completed {
        total_bytes: u64,
        downloaded_bytes: u64,
    },
    Paused {
        total_bytes: u64,
        downloaded_bytes: u64,
        progress: f64,
    },
}

fn parse_optional_u64(raw: &str) -> u64 {
    raw.trim()
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .map(|v| v as u64)
        .unwrap_or(0)
}

fn parse_percent(raw: &str) -> Option<f64> {
    raw.trim()
        .trim_end_matches('%')
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
        .map(|v| v.clamp(0.0, 100.0))
}

async fn execute_yt_dlp_transfer(
    app: &AppHandle,
    manager: &Arc<DownloadManager>,
    item: &DownloadItem,
    token: &CancellationToken,
) -> Result<MediaOutcome, String> {
    let yt_dlp = resolve_sidecar_binary(app, "yt-dlp").ok_or_else(|| {
        "yt-dlp sidecar binary not found. Run `npm run fetch-sidecars` to install yt-dlp and ffmpeg."
            .to_string()
    })?;
    let ffmpeg_opt = resolve_sidecar_binary(app, "ffmpeg");

    let save_dir = PathBuf::from(&item.save_dir);
    fs::create_dir_all(&save_dir)
        .await
        .map_err(|e| format!("Failed to create destination folder: {e}"))?;

    let safe_name = sanitize_filename(&item.file_name);
    let output_path = save_dir.join(&safe_name);

    let mut args: Vec<String> = vec![
        "--newline".to_string(),
        "--no-warnings".to_string(),
        "--no-playlist".to_string(),
        "--continue".to_string(),
        "--progress-template".to_string(),
        "download:THAIDM_PROG|%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s".to_string(),
    ];

    let app_settings = app
        .try_state::<Arc<SettingsStore>>()
        .map(|s| s.get())
        .unwrap_or_else(AppSettings::default);
    let (default_selector, default_audio_only) = app_settings.default_format_selector();
    let effective_audio_only = item.audio_only || (item.format_selector.is_none() && default_audio_only);

    let has_ffmpeg = ffmpeg_opt.is_some();
    if let Some(ffmpeg_path) = ffmpeg_opt {
        args.push("--ffmpeg-location".to_string());
        args.push(ffmpeg_path.to_string_lossy().to_string());
    }

    if effective_audio_only {
        args.extend([
            "-f".to_string(),
            item.format_selector
                .clone()
                .unwrap_or_else(|| "bestaudio/best".to_string()),
            "-x".to_string(),
            "--audio-format".to_string(),
            "mp3".to_string(),
            "--audio-quality".to_string(),
            "192K".to_string(),
        ]);
    } else {
        args.extend([
            "-f".to_string(),
            item.format_selector
                .clone()
                .unwrap_or_else(|| default_selector.to_string()),
            "--merge-output-format".to_string(),
            "mp4".to_string(),
        ]);
    }

    if app_settings.embed_metadata && has_ffmpeg {
        args.push("--embed-metadata".to_string());
    }
    if app_settings.embed_thumbnail && has_ffmpeg {
        args.push("--embed-thumbnail".to_string());
    }

    args.push("-o".to_string());
    args.push(output_path.to_string_lossy().to_string());
    args.push(item.url.clone());

    let mut cmd = Command::new(&yt_dlp);
    configure_hidden(&mut cmd);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch yt-dlp process: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture yt-dlp stdout".to_string())?;
    let mut lines = BufReader::new(stdout).lines();

    let mut last_emit = Instant::now() - Duration::from_millis(300);
    let mut latest_downloaded: u64 = item.downloaded_bytes;
    let mut latest_total: u64 = item.size_bytes;
    let mut latest_progress: f64 = item.progress;

    loop {
        let next_line = tokio::select! {
            _ = token.cancelled() => {
                // Cleanly kill yt-dlp child process to prevent orphaned processes
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Ok(MediaOutcome::Paused {
                    total_bytes: latest_total,
                    downloaded_bytes: latest_downloaded,
                    progress: latest_progress,
                });
            }
            line_res = lines.next_line() => line_res,
        };

        let Ok(Some(line)) = next_line else {
            break;
        };

        if let Some(payload) = line.strip_prefix("THAIDM_PROG|") {
            let parts: Vec<&str> = payload.split('|').collect();
            if parts.len() >= 6 {
                let pct = parse_percent(parts[0]).unwrap_or(latest_progress);
                let dl_bytes = parse_optional_u64(parts[1]);
                let tot_exact = parse_optional_u64(parts[2]);
                let tot_est = parse_optional_u64(parts[3]);
                let total_bytes = if tot_exact > 0 {
                    tot_exact
                } else if tot_est > 0 {
                    tot_est
                } else {
                    latest_total
                };
                let speed_bps = parts[4].trim().parse::<f64>().ok().unwrap_or(0.0);
                let speed_kbps = (speed_bps / 1024.0).max(0.0);
                let eta_secs = parse_optional_u64(parts[5]);
                let time_left = if eta_secs > 0 {
                    format_eta(eta_secs)
                } else {
                    "—".to_string()
                };

                latest_downloaded = dl_bytes.max(latest_downloaded);
                latest_total = total_bytes.max(latest_downloaded);
                latest_progress = (pct * 10.0).round() / 10.0;

                if last_emit.elapsed() >= Duration::from_millis(250) {
                    manager.update_progress_in_memory(
                        &item.id,
                        latest_downloaded,
                        latest_total,
                        latest_progress,
                        speed_kbps,
                        &time_left,
                    );
                    let _ = app.emit(
                        EVENT_DOWNLOAD_PROGRESS,
                        DownloadProgressEvent {
                            id: item.id.clone(),
                            downloaded_bytes: latest_downloaded,
                            size_bytes: latest_total,
                            progress: latest_progress,
                            speed_kbps,
                            time_left,
                        },
                    );
                    last_emit = Instant::now();
                }
            }
        }
    }

    let wait_outcome = tokio::select! {
        _ = token.cancelled() => None,
        st = child.wait() => Some(st),
    };

    let status = match wait_outcome {
        None => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Ok(MediaOutcome::Paused {
                total_bytes: latest_total,
                downloaded_bytes: latest_downloaded,
                progress: latest_progress,
            });
        }
        Some(st) => st.map_err(|e| format!("Error waiting for yt-dlp: {e}"))?,
    };

    if !status.success() {
        return Err(format!(
            "yt-dlp exited with code {}",
            status.code().unwrap_or(-1)
        ));
    }

    let final_size = fs::metadata(&output_path)
        .await
        .map(|m| m.len())
        .unwrap_or(latest_total.max(latest_downloaded));

    Ok(MediaOutcome::Completed {
        total_bytes: final_size,
        downloaded_bytes: final_size,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateYtDlpResult {
    pub updated: bool,
    pub version: Option<String>,
    pub path: String,
    pub message: String,
}

pub async fn detect_binary_version(binary_path: &Path, version_arg: &str) -> Option<String> {
    let mut cmd = Command::new(binary_path);
    configure_hidden(&mut cmd);
    cmd.arg(version_arg)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().await.ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next()?.trim();
    if first_line.is_empty() {
        None
    } else {
        Some(first_line.to_string())
    }
}

/// Update `yt-dlp`: if a writable copy already exists in `<app_data_dir>/bin/`, run `yt-dlp -U`.
/// Otherwise download the latest official release binary into `<app_data_dir>/bin/` so YouTube
/// and social grabbing stay working even when the bundled sidecar is inside a read-only install dir.
pub async fn update_yt_dlp_binary(app: &AppHandle) -> Result<UpdateYtDlpResult, String> {
    let target_path = app_data_binary_path(app, "yt-dlp")
        .ok_or_else(|| "Could not resolve Tauri app data directory.".to_string())?;

    if target_path.is_file() {
        let mut cmd = Command::new(&target_path);
        configure_hidden(&mut cmd);
        cmd.arg("-U")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Ok(output) = cmd.output().await {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let ver = detect_binary_version(&target_path, "--version").await;
                return Ok(UpdateYtDlpResult {
                    updated: !stdout.to_lowercase().contains("up to date"),
                    version: ver,
                    path: target_path.to_string_lossy().to_string(),
                    message: if stdout.is_empty() {
                        "yt-dlp check completed.".to_string()
                    } else {
                        stdout.lines().last().unwrap_or("yt-dlp updated.").to_string()
                    },
                });
            }
        }
    }

    // Download the latest official release binary into app data directory
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create bin directory: {e}"))?;
    }

    let download_url = if cfg!(target_os = "windows") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    };

    let client = reqwest::Client::builder()
        .user_agent("ThaiDM/0.1.0")
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let resp = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download latest yt-dlp: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "GitHub returned HTTP {} while downloading yt-dlp.",
            resp.status()
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read yt-dlp binary payload: {e}"))?;

    let tmp_path = target_path.with_extension("download.tmp");
    fs::write(&tmp_path, &bytes)
        .await
        .map_err(|e| format!("Failed to save downloaded yt-dlp: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        let _ = std::fs::set_permissions(&tmp_path, perms);
    }

    if target_path.exists() {
        let _ = fs::remove_file(&target_path).await;
    }
    fs::rename(&tmp_path, &target_path)
        .await
        .map_err(|e| format!("Failed to activate updated yt-dlp binary: {e}"))?;

    let ver = detect_binary_version(&target_path, "--version").await;
    Ok(UpdateYtDlpResult {
        updated: true,
        version: ver.clone(),
        path: target_path.to_string_lossy().to_string(),
        message: match ver {
            Some(v) => format!("Updated yt-dlp to {v} in app data directory."),
            None => "Downloaded latest yt-dlp binary into app data directory.".to_string(),
        },
    })
}
