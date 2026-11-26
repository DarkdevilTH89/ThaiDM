use crate::downloader::manager::DownloadManager;
use crate::downloader::{is_media_site_url, AddDownloadRequest, DownloadCategory};
use crate::settings::{SettingsStore, DEFAULT_BRIDGE_PORT};
use axum::extract::State;
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tower_http::cors::{AllowOrigin, CorsLayer};

pub const BRIDGE_HOST: &str = "127.0.0.1";
pub const EVENT_BRIDGE_URL_RECEIVED: &str = "bridge-url-received";
pub const EVENT_BRIDGE_STATUS_CHANGED: &str = "bridge-status-changed";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub online: bool,
    pub address: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BridgeAddRequest {
    pub url: String,
    pub filename: Option<String>,
    pub referrer: Option<String>,
    pub user_agent: Option<String>,
    pub is_media: Option<bool>,
    pub auto_start: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeUrlEvent {
    pub url: String,
    pub filename: Option<String>,
    pub referrer: Option<String>,
    pub user_agent: Option<String>,
    pub is_media: bool,
    pub auto_started: bool,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    app: &'static str,
    version: &'static str,
}

#[derive(Debug, Serialize)]
struct AddResponse {
    accepted: bool,
    message: String,
    auto_started: bool,
}

pub struct BridgeRegistry {
    status: Mutex<BridgeStatus>,
}

impl BridgeRegistry {
    pub fn new(port: u16) -> Self {
        Self {
            status: Mutex::new(BridgeStatus {
                online: false,
                address: format!("{BRIDGE_HOST}:{port}"),
                error: None,
            }),
        }
    }

    pub fn get_status(&self) -> BridgeStatus {
        self.status
            .lock()
            .map(|g| g.clone())
            .unwrap_or(BridgeStatus {
                online: false,
                address: format!("{BRIDGE_HOST}:{DEFAULT_BRIDGE_PORT}"),
                error: Some("Bridge lock poisoned".to_string()),
            })
    }

    pub fn set_status(&self, app: &AppHandle, port: u16, online: bool, error: Option<String>) {
        let next = BridgeStatus {
            online,
            address: format!("{BRIDGE_HOST}:{port}"),
            error,
        };
        if let Ok(mut guard) = self.status.lock() {
            *guard = next.clone();
        }
        let _ = app.emit(EVENT_BRIDGE_STATUS_CHANGED, next);
    }
}

#[derive(Clone)]
struct BridgeAppState {
    app: AppHandle,
    manager: Arc<DownloadManager>,
    settings: Arc<SettingsStore>,
}

fn infer_category_for_bridge(url: &str, filename: Option<&str>, is_media: bool) -> DownloadCategory {
    if is_media {
        return DownloadCategory::Video;
    }
    let combined = format!("{} {}", url, filename.unwrap_or("")).to_lowercase();
    if combined.ends_with(".mp3")
        || combined.ends_with(".flac")
        || combined.ends_with(".wav")
        || combined.ends_with(".m4a")
    {
        return DownloadCategory::Music;
    }
    if combined.ends_with(".zip")
        || combined.ends_with(".rar")
        || combined.ends_with(".7z")
        || combined.ends_with(".tar")
        || combined.ends_with(".gz")
        || combined.ends_with(".iso")
    {
        return DownloadCategory::Compressed;
    }
    if combined.ends_with(".exe")
        || combined.ends_with(".msi")
        || combined.ends_with(".dmg")
        || combined.ends_with(".pkg")
    {
        return DownloadCategory::Programs;
    }
    if combined.ends_with(".mp4")
        || combined.ends_with(".mkv")
        || combined.ends_with(".webm")
        || combined.ends_with(".mov")
    {
        return DownloadCategory::Video;
    }
    DownloadCategory::Documents
}

async fn handle_health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        app: "ThaiDM",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn handle_add(
    State(state): State<BridgeAppState>,
    Json(payload): Json<BridgeAddRequest>,
) -> (StatusCode, Json<AddResponse>) {
    let trimmed_url = payload.url.trim().to_string();
    if !(trimmed_url.starts_with("http://") || trimmed_url.starts_with("https://")) {
        return (
            StatusCode::BAD_REQUEST,
            Json(AddResponse {
                accepted: false,
                message: "URL must start with http:// or https://".to_string(),
                auto_started: false,
            }),
        );
    }

    let current_settings = state.settings.get();
    let is_media = payload.is_media.unwrap_or_else(|| is_media_site_url(&trimmed_url));
    let auto_start = payload
        .auto_start
        .unwrap_or(current_settings.auto_start_bridge_downloads);

    // Bring main ไทยDM window to the foreground
    if let Some(window) = state.app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    if auto_start {
        let (default_fmt, default_audio_only) = current_settings.default_format_selector();
        let category = if is_media && default_audio_only {
            DownloadCategory::Music
        } else {
            infer_category_for_bridge(&trimmed_url, payload.filename.as_deref(), is_media)
        };
        let req = AddDownloadRequest {
            url: trimmed_url.clone(),
            file_name: payload.filename.clone(),
            save_dir: current_settings.default_download_dir.clone(),
            category,
            start_now: true,
            format_selector: if is_media {
                Some(default_fmt.to_string())
            } else {
                None
            },
            audio_only: Some(is_media && default_audio_only),
            source_label: Some("Browser Extension".to_string()),
        };
        if let Err(err) = state.manager.add_download(&state.app, req) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(AddResponse {
                    accepted: false,
                    message: err,
                    auto_started: false,
                }),
            );
        }
    }

    // Notify frontend to open pre-filled modal (or refresh list when auto_started)
    let _ = state.app.emit(
        EVENT_BRIDGE_URL_RECEIVED,
        BridgeUrlEvent {
            url: trimmed_url,
            filename: payload.filename,
            referrer: payload.referrer,
            user_agent: payload.user_agent,
            is_media,
            auto_started: auto_start,
        },
    );

    (
        StatusCode::OK,
        Json(AddResponse {
            accepted: true,
            message: if auto_start {
                "Download started in ไทยDM.".to_string()
            } else {
                "Sent to ไทยDM.".to_string()
            },
            auto_started: auto_start,
        }),
    )
}

/// Spawn the loopback-only HTTP bridge strictly on `127.0.0.1:<port>` (never `0.0.0.0`).
pub fn spawn_localhost_bridge(
    app: AppHandle,
    manager: Arc<DownloadManager>,
    settings: Arc<SettingsStore>,
    registry: Arc<BridgeRegistry>,
) {
    let port = settings.get().bridge_port;

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(
            |origin: &HeaderValue, _req_parts| {
                origin
                    .to_str()
                    .map(|o| {
                        o.starts_with("chrome-extension://")
                            || o.starts_with("moz-extension://")
                            || o == "http://localhost:1420"
                            || o == "http://127.0.0.1:1420"
                    })
                    .unwrap_or(false)
            },
        ))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::ACCEPT]);

    let state = BridgeAppState {
        app: app.clone(),
        manager,
        settings,
    };

    let router = Router::new()
        .route("/health", get(handle_health))
        .route("/add", post(handle_add))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                registry.set_status(&app, port, true, None);
                if let Err(err) = axum::serve(listener, router).await {
                    registry.set_status(
                        &app,
                        port,
                        false,
                        Some(format!("Bridge server stopped: {err}")),
                    );
                }
            }
            Err(err) => {
                registry.set_status(
                    &app,
                    port,
                    false,
                    Some(format!("Could not bind 127.0.0.1:{port}: {err}")),
                );
            }
        }
    });
}
