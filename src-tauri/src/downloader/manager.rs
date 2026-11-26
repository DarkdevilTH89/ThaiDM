use crate::downloader::http::run_http_download;
use crate::downloader::media::run_media_download;
use crate::downloader::{
    infer_filename_from_url, is_media_site_url, now_timestamp, sanitize_filename,
    AddDownloadRequest, DownloadItem, DownloadStatus, DownloadStatusEvent, EVENT_DOWNLOAD_STATUS,
};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub struct DownloadManager {
    items: Mutex<Vec<DownloadItem>>,
    active_tokens: Mutex<HashMap<String, CancellationToken>>,
    queue_file: PathBuf,
}

impl DownloadManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&app_data_dir);
        let queue_file = app_data_dir.join("queue.json");
        let loaded = Self::load_from_disk(&queue_file);

        Self {
            items: Mutex::new(loaded),
            active_tokens: Mutex::new(HashMap::new()),
            queue_file,
        }
    }

    fn load_from_disk(queue_file: &PathBuf) -> Vec<DownloadItem> {
        let Ok(raw) = fs::read_to_string(queue_file) else {
            return Vec::new();
        };
        let mut items: Vec<DownloadItem> = serde_json::from_str(&raw).unwrap_or_default();
        // Any download that was in-flight when the app closed is safely marked Paused
        for item in &mut items {
            if item.status == DownloadStatus::Downloading {
                item.status = DownloadStatus::Paused;
                item.speed_kbps = 0.0;
                item.time_left = "—".to_string();
            }
        }
        items
    }

    fn persist_snapshot(&self, snapshot: &[DownloadItem]) {
        if let Some(parent) = self.queue_file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(snapshot) {
            let tmp = self.queue_file.with_extension("json.tmp");
            if fs::write(&tmp, json).is_ok() {
                let _ = fs::rename(&tmp, &self.queue_file);
            }
        }
    }

    pub fn list_downloads(&self) -> Vec<DownloadItem> {
        self.items
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn add_download(
        self: &Arc<Self>,
        app: &AppHandle,
        req: AddDownloadRequest,
    ) -> Result<DownloadItem, String> {
        let trimmed_url = req.url.trim().to_string();
        if trimmed_url.is_empty() {
            return Err("URL cannot be empty.".to_string());
        }

        let audio_only = req.audio_only.unwrap_or(false);
        let is_media = is_media_site_url(&trimmed_url) || req.format_selector.is_some();

        let mut file_name = req
            .file_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(sanitize_filename)
            .unwrap_or_else(|| infer_filename_from_url(&trimmed_url, audio_only));

        if is_media {
            let desired_ext = if audio_only { ".mp3" } else { ".mp4" };
            if !file_name.to_lowercase().ends_with(desired_ext) {
                file_name.push_str(desired_ext);
            }
        }

        let initial_status = if req.start_now {
            DownloadStatus::Downloading
        } else {
            DownloadStatus::Queued
        };

        let item = DownloadItem {
            id: Uuid::new_v4().to_string(),
            file_name,
            url: trimmed_url,
            save_dir: req.save_dir.trim().to_string(),
            category: req.category,
            size_bytes: 0,
            downloaded_bytes: 0,
            progress: 0.0,
            status: initial_status,
            time_left: "—".to_string(),
            speed_kbps: 0.0,
            last_try_date: now_timestamp(),
            source_label: req.source_label.or_else(|| {
                Some(if is_media {
                    "Media Grabber".to_string()
                } else {
                    "Direct HTTPS".to_string()
                })
            }),
            is_media,
            format_selector: req.format_selector,
            audio_only,
            error_message: None,
        };

        {
            let mut guard = self.items.lock().map_err(|_| "Queue lock poisoned")?;
            guard.insert(0, item.clone());
            self.persist_snapshot(&guard);
        }

        if req.start_now {
            self.spawn_worker(app, item.clone());
        }

        Ok(item)
    }

    pub fn resume_download(self: &Arc<Self>, app: &AppHandle, id: &str) -> Result<DownloadItem, String> {
        let target: DownloadItem;
        {
            let mut guard = self.items.lock().map_err(|_| "Queue lock poisoned")?;
            let item = guard
                .iter_mut()
                .find(|d| d.id == id)
                .ok_or_else(|| "Download not found.".to_string())?;

            if item.status == DownloadStatus::Completed {
                return Ok(item.clone());
            }
            if item.status == DownloadStatus::Downloading {
                return Ok(item.clone());
            }

            item.status = DownloadStatus::Downloading;
            item.error_message = None;
            item.last_try_date = now_timestamp();
            target = item.clone();
            self.persist_snapshot(&guard);
        }

        let _ = app.emit(
            EVENT_DOWNLOAD_STATUS,
            DownloadStatusEvent {
                id: target.id.clone(),
                status: DownloadStatus::Downloading,
                progress: target.progress,
                size_bytes: target.size_bytes,
                downloaded_bytes: target.downloaded_bytes,
                file_name: target.file_name.clone(),
                last_try_date: target.last_try_date.clone(),
            },
        );

        self.spawn_worker(app, target.clone());
        Ok(target)
    }

    pub fn resume_all_downloads(self: &Arc<Self>, app: &AppHandle) -> Result<usize, String> {
        let ids_to_resume: Vec<String> = {
            let guard = self.items.lock().map_err(|_| "Queue lock poisoned")?;
            guard
                .iter()
                .filter(|d| {
                    matches!(
                        d.status,
                        DownloadStatus::Paused | DownloadStatus::Queued | DownloadStatus::Error
                    )
                })
                .map(|d| d.id.clone())
                .collect()
        };

        let mut resumed = 0;
        for id in ids_to_resume {
            if self.resume_download(app, &id).is_ok() {
                resumed += 1;
            }
        }
        Ok(resumed)
    }

    pub fn pause_download(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        if let Some(token) = self
            .active_tokens
            .lock()
            .map_err(|_| "Token registry lock poisoned")?
            .remove(id)
        {
            token.cancel();
        }

        let mut updated: Option<DownloadItem> = None;
        {
            let mut guard = self.items.lock().map_err(|_| "Queue lock poisoned")?;
            if let Some(item) = guard.iter_mut().find(|d| d.id == id) {
                if item.status == DownloadStatus::Downloading || item.status == DownloadStatus::Queued {
                    item.status = DownloadStatus::Paused;
                    item.speed_kbps = 0.0;
                    item.time_left = "—".to_string();
                    updated = Some(item.clone());
                    self.persist_snapshot(&guard);
                }
            }
        }

        if let Some(item) = updated {
            let _ = app.emit(
                EVENT_DOWNLOAD_STATUS,
                DownloadStatusEvent {
                    id: item.id,
                    status: DownloadStatus::Paused,
                    progress: item.progress,
                    size_bytes: item.size_bytes,
                    downloaded_bytes: item.downloaded_bytes,
                    file_name: item.file_name,
                    last_try_date: item.last_try_date,
                },
            );
        }

        Ok(())
    }

    pub fn stop_all_downloads(&self, app: &AppHandle) -> Result<(), String> {
        {
            let mut tokens = self
                .active_tokens
                .lock()
                .map_err(|_| "Token registry lock poisoned")?;
            for (_, token) in tokens.drain() {
                token.cancel();
            }
        }

        let mut changed: Vec<DownloadItem> = Vec::new();
        {
            let mut guard = self.items.lock().map_err(|_| "Queue lock poisoned")?;
            for item in guard.iter_mut() {
                if item.status == DownloadStatus::Downloading {
                    item.status = DownloadStatus::Paused;
                    item.speed_kbps = 0.0;
                    item.time_left = "—".to_string();
                    changed.push(item.clone());
                }
            }
            if !changed.is_empty() {
                self.persist_snapshot(&guard);
            }
        }

        for item in changed {
            let _ = app.emit(
                EVENT_DOWNLOAD_STATUS,
                DownloadStatusEvent {
                    id: item.id,
                    status: DownloadStatus::Paused,
                    progress: item.progress,
                    size_bytes: item.size_bytes,
                    downloaded_bytes: item.downloaded_bytes,
                    file_name: item.file_name,
                    last_try_date: item.last_try_date,
                },
            );
        }

        Ok(())
    }

    pub fn delete_download(&self, id: &str) -> Result<(), String> {
        if let Some(token) = self
            .active_tokens
            .lock()
            .map_err(|_| "Token registry lock poisoned")?
            .remove(id)
        {
            token.cancel();
        }

        let mut guard = self.items.lock().map_err(|_| "Queue lock poisoned")?;
        guard.retain(|d| d.id != id);
        self.persist_snapshot(&guard);
        Ok(())
    }

    pub fn remove_token(&self, id: &str) {
        if let Ok(mut tokens) = self.active_tokens.lock() {
            tokens.remove(id);
        }
    }

    pub fn update_progress_in_memory(
        &self,
        id: &str,
        downloaded_bytes: u64,
        size_bytes: u64,
        progress: f64,
        speed_kbps: f64,
        time_left: &str,
    ) {
        if let Ok(mut guard) = self.items.lock() {
            if let Some(item) = guard.iter_mut().find(|d| d.id == id) {
                item.downloaded_bytes = downloaded_bytes;
                if size_bytes > 0 {
                    item.size_bytes = size_bytes;
                }
                item.progress = progress;
                item.speed_kbps = speed_kbps;
                item.time_left = time_left.to_string();
            }
        }
    }

    pub fn update_status(
        &self,
        app: &AppHandle,
        id: &str,
        status: DownloadStatus,
        progress: f64,
        size_bytes: u64,
        downloaded_bytes: u64,
        error_message: Option<String>,
    ) {
        let mut emitted: Option<DownloadItem> = None;
        if let Ok(mut guard) = self.items.lock() {
            if let Some(item) = guard.iter_mut().find(|d| d.id == id) {
                item.status = status;
                item.progress = progress;
                if size_bytes > 0 {
                    item.size_bytes = size_bytes;
                }
                item.downloaded_bytes = downloaded_bytes;
                item.speed_kbps = 0.0;
                item.time_left = "—".to_string();
                item.last_try_date = now_timestamp();
                item.error_message = error_message;
                emitted = Some(item.clone());
                self.persist_snapshot(&guard);
            }
        }

        if let Some(item) = emitted {
            let _ = app.emit(
                EVENT_DOWNLOAD_STATUS,
                DownloadStatusEvent {
                    id: item.id,
                    status: item.status,
                    progress: item.progress,
                    size_bytes: item.size_bytes,
                    downloaded_bytes: item.downloaded_bytes,
                    file_name: item.file_name,
                    last_try_date: item.last_try_date,
                },
            );
        }
    }

    fn spawn_worker(self: &Arc<Self>, app: &AppHandle, item: DownloadItem) {
        let token = CancellationToken::new();
        if let Ok(mut tokens) = self.active_tokens.lock() {
            if let Some(prev) = tokens.insert(item.id.clone(), token.clone()) {
                prev.cancel();
            }
        }

        let app_clone = app.clone();
        let manager_clone = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            if item.is_media {
                run_media_download(app_clone, manager_clone, item, token).await;
            } else {
                run_http_download(app_clone, manager_clone, item, token).await;
            }
        });
    }
}
