use crate::downloader::manager::DownloadManager;
use crate::downloader::{
    format_eta, DownloadErrorEvent, DownloadItem, DownloadProgressEvent, DownloadStatus,
    EVENT_DOWNLOAD_ERROR, EVENT_DOWNLOAD_PROGRESS,
};
use futures_util::StreamExt;
use reqwest::header::{CONTENT_LENGTH, RANGE};
use reqwest::StatusCode;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

pub async fn run_http_download(
    app: AppHandle,
    manager: Arc<DownloadManager>,
    item: DownloadItem,
    token: CancellationToken,
) {
    let id = item.id.clone();
    let result = execute_http_transfer(&app, &manager, &item, &token).await;

    manager.remove_token(&id);

    match result {
        Ok(TransferOutcome::Completed {
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
        Ok(TransferOutcome::Paused {
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

enum TransferOutcome {
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

async fn execute_http_transfer(
    app: &AppHandle,
    manager: &Arc<DownloadManager>,
    item: &DownloadItem,
    token: &CancellationToken,
) -> Result<TransferOutcome, String> {
    let save_dir = PathBuf::from(&item.save_dir);
    fs::create_dir_all(&save_dir)
        .await
        .map_err(|e| format!("Failed to create destination folder: {e}"))?;

    let final_path = save_dir.join(&item.file_name);
    let part_path = save_dir.join(format!("{}.thaidm.part", item.file_name));

    let existing_bytes = match fs::metadata(&part_path).await {
        Ok(meta) => meta.len(),
        Err(_) => 0,
    };

    let client = reqwest::Client::builder()
        .user_agent("ThaiDM/0.1.0")
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;

    let mut req = client.get(&item.url);
    if existing_bytes > 0 {
        req = req.header(RANGE, format!("bytes={existing_bytes}-"));
    }

    let response = tokio::select! {
        _ = token.cancelled() => {
            let pct = if item.size_bytes > 0 {
                (existing_bytes as f64 / item.size_bytes as f64) * 100.0
            } else {
                item.progress
            };
            return Ok(TransferOutcome::Paused {
                total_bytes: item.size_bytes,
                downloaded_bytes: existing_bytes,
                progress: pct.clamp(0.0, 99.9),
            });
        }
        res = req.send() => res.map_err(|e| format!("Network request failed: {e}"))?,
    };

    let status = response.status();
    if !status.is_success() && status != StatusCode::PARTIAL_CONTENT {
        return Err(format!("Server returned HTTP status {}", status.as_u16()));
    }

    let is_resuming = existing_bytes > 0 && status == StatusCode::PARTIAL_CONTENT;
    let content_len = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);

    let total_bytes = if is_resuming {
        if content_len > 0 {
            existing_bytes + content_len
        } else {
            item.size_bytes
        }
    } else {
        content_len
    };

    let mut downloaded_bytes = if is_resuming { existing_bytes } else { 0 };

    let mut file = if is_resuming {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part_path)
            .await
            .map_err(|e| format!("Failed to open partial file for resume: {e}"))?
    } else {
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&part_path)
            .await
            .map_err(|e| format!("Failed to create partial file: {e}"))?
    };

    let mut stream = response.bytes_stream();
    let mut last_emit = Instant::now() - Duration::from_millis(300);
    let mut window_start = Instant::now();
    let mut window_bytes: u64 = 0;

    loop {
        let next_chunk = tokio::select! {
            _ = token.cancelled() => {
                let _ = file.flush().await;
                let pct = if total_bytes > 0 {
                    (downloaded_bytes as f64 / total_bytes as f64) * 100.0
                } else {
                    0.0
                };
                return Ok(TransferOutcome::Paused {
                    total_bytes,
                    downloaded_bytes,
                    progress: (pct * 10.0).round() / 10.0,
                });
            }
            chunk = stream.next() => chunk,
        };

        let Some(chunk_res) = next_chunk else {
            break;
        };
        let chunk = chunk_res.map_err(|e| format!("Stream read error: {e}"))?;

        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Disk write error: {e}"))?;

        let n = chunk.len() as u64;
        downloaded_bytes += n;
        window_bytes += n;

        // Throttle progress events to ~250ms per item
        if last_emit.elapsed() >= Duration::from_millis(250) {
            let elapsed_secs = window_start.elapsed().as_secs_f64().max(0.05);
            let bytes_per_sec = window_bytes as f64 / elapsed_secs;
            let speed_kbps = bytes_per_sec / 1024.0;
            let progress = if total_bytes > 0 {
                ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 99.9)
            } else {
                0.0
            };
            let time_left = if total_bytes > downloaded_bytes && bytes_per_sec > 1.0 {
                let rem_secs = ((total_bytes - downloaded_bytes) as f64 / bytes_per_sec) as u64;
                format_eta(rem_secs)
            } else {
                "—".to_string()
            };

            let rounded_pct = (progress * 10.0).round() / 10.0;
            manager.update_progress_in_memory(
                &item.id,
                downloaded_bytes,
                total_bytes,
                rounded_pct,
                speed_kbps,
                &time_left,
            );

            let _ = app.emit(
                EVENT_DOWNLOAD_PROGRESS,
                DownloadProgressEvent {
                    id: item.id.clone(),
                    downloaded_bytes,
                    size_bytes: total_bytes,
                    progress: rounded_pct,
                    speed_kbps,
                    time_left,
                },
            );

            last_emit = Instant::now();
            if window_start.elapsed() >= Duration::from_secs(2) {
                window_start = Instant::now();
                window_bytes = 0;
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush file to disk: {e}"))?;
    drop(file);

    if final_path.exists() {
        let _ = fs::remove_file(&final_path).await;
    }
    fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("Failed to finalize downloaded file: {e}"))?;

    Ok(TransferOutcome::Completed {
        total_bytes: total_bytes.max(downloaded_bytes),
        downloaded_bytes,
    })
}
