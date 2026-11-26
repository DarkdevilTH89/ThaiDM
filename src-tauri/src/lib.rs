mod bridge;
mod downloader;
mod settings;

use bridge::{spawn_localhost_bridge, BridgeRegistry, BridgeStatus};
use downloader::manager::DownloadManager;
use downloader::media::{self, UpdateYtDlpResult};
use downloader::{
    app_data_binary_path, default_download_dir, resolve_sidecar_binary, AddDownloadRequest,
    DownloadItem, MediaProbeResult, SidecarStatus,
};
use serde::Serialize;
use settings::{AppSettings, SettingsStore};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsInfo {
    bridge: BridgeStatus,
    yt_dlp_version: Option<String>,
    ffmpeg_version: Option<String>,
    yt_dlp_path: Option<String>,
    ffmpeg_path: Option<String>,
    using_updated_yt_dlp: bool,
}

#[tauri::command]
fn check_sidecars(app: AppHandle) -> SidecarStatus {
    let yt_dlp = resolve_sidecar_binary(&app, "yt-dlp");
    let ffmpeg = resolve_sidecar_binary(&app, "ffmpeg");
    SidecarStatus {
        yt_dlp_ready: yt_dlp.is_some(),
        ffmpeg_ready: ffmpeg.is_some(),
        yt_dlp_path: yt_dlp.map(|p| p.to_string_lossy().to_string()),
        ffmpeg_path: ffmpeg.map(|p| p.to_string_lossy().to_string()),
        default_download_dir: default_download_dir(),
    }
}

#[tauri::command]
fn get_bridge_status(registry: State<'_, Arc<BridgeRegistry>>) -> BridgeStatus {
    registry.get_status()
}

#[tauri::command]
fn get_settings(store: State<'_, Arc<SettingsStore>>) -> AppSettings {
    store.get()
}

#[tauri::command]
fn save_settings(
    store: State<'_, Arc<SettingsStore>>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    store.save(settings)
}

#[tauri::command]
async fn get_diagnostics(
    app: AppHandle,
    registry: State<'_, Arc<BridgeRegistry>>,
) -> Result<DiagnosticsInfo, String> {
    let yt_dlp = resolve_sidecar_binary(&app, "yt-dlp");
    let ffmpeg = resolve_sidecar_binary(&app, "ffmpeg");

    let yt_dlp_version = match &yt_dlp {
        Some(p) => media::detect_binary_version(p, "--version").await,
        None => None,
    };
    let ffmpeg_version = match &ffmpeg {
        Some(p) => media::detect_binary_version(p, "-version").await,
        None => None,
    };

    let app_data_yt_dlp = app_data_binary_path(&app, "yt-dlp");
    let using_updated_yt_dlp = match (&yt_dlp, &app_data_yt_dlp) {
        (Some(active), Some(updated)) => active == updated,
        _ => false,
    };

    Ok(DiagnosticsInfo {
        bridge: registry.get_status(),
        yt_dlp_version,
        ffmpeg_version,
        yt_dlp_path: yt_dlp.map(|p| p.to_string_lossy().to_string()),
        ffmpeg_path: ffmpeg.map(|p| p.to_string_lossy().to_string()),
        using_updated_yt_dlp,
    })
}

#[tauri::command]
async fn update_yt_dlp(app: AppHandle) -> Result<UpdateYtDlpResult, String> {
    media::update_yt_dlp_binary(&app).await
}

#[tauri::command]
fn list_downloads(manager: State<'_, Arc<DownloadManager>>) -> Vec<DownloadItem> {
    manager.list_downloads()
}

#[tauri::command]
async fn probe_media(app: AppHandle, url: String) -> Result<MediaProbeResult, String> {
    media::probe_media(&app, url.trim()).await
}

#[tauri::command]
fn add_download(
    app: AppHandle,
    manager: State<'_, Arc<DownloadManager>>,
    request: AddDownloadRequest,
) -> Result<DownloadItem, String> {
    manager.add_download(&app, request)
}

#[tauri::command]
fn pause_download(
    app: AppHandle,
    manager: State<'_, Arc<DownloadManager>>,
    id: String,
) -> Result<(), String> {
    manager.pause_download(&app, &id)
}

#[tauri::command]
fn resume_download(
    app: AppHandle,
    manager: State<'_, Arc<DownloadManager>>,
    id: String,
) -> Result<DownloadItem, String> {
    manager.resume_download(&app, &id)
}

#[tauri::command]
fn stop_all_downloads(
    app: AppHandle,
    manager: State<'_, Arc<DownloadManager>>,
) -> Result<(), String> {
    manager.stop_all_downloads(&app)
}

#[tauri::command]
fn delete_download(manager: State<'_, Arc<DownloadManager>>, id: String) -> Result<(), String> {
    manager.delete_download(&id)
}

#[tauri::command]
fn open_file(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Failed to open file: {e}"))
}

#[tauri::command]
fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Failed to open folder: {e}"))
}

#[tauri::command]
async fn pick_download_folder(app: AppHandle) -> Result<Option<String>, String> {
    let picked = tokio::task::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await
        .map_err(|e| format!("Folder dialog task failed: {e}"))?;

    match picked {
        Some(file_path) => {
            let path_buf = file_path
                .into_path()
                .map_err(|e| format!("Invalid folder path: {e}"))?;
            Ok(Some(path_buf.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn setup_system_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "tray_show", "Show ไทยDM", true, None::<&str>)?;
    let resume_all_item =
        MenuItem::with_id(app, "tray_resume_all", "Resume All", true, None::<&str>)?;
    let stop_all_item = MenuItem::with_id(app, "tray_stop_all", "Stop All", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &resume_all_item,
            &stop_all_item,
            &separator,
            &quit_item,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("ไทยDM — Download Manager")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| match event.id.as_ref() {
            "tray_show" => show_main_window(app_handle),
            "tray_resume_all" => {
                if let Some(manager) = app_handle.try_state::<Arc<DownloadManager>>() {
                    let _ = manager.resume_all_downloads(app_handle);
                }
            }
            "tray_stop_all" => {
                if let Some(manager) = app_handle.try_state::<Arc<DownloadManager>>() {
                    let _ = manager.stop_all_downloads(app_handle);
                }
            }
            "tray_quit" => {
                if let Some(manager) = app_handle.try_state::<Arc<DownloadManager>>() {
                    let _ = manager.stop_all_downloads(app_handle);
                }
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let _tray = builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));

            let settings_store = Arc::new(SettingsStore::new(app_data_dir.clone()));
            let manager = Arc::new(DownloadManager::new(app_data_dir));
            let bridge_port = settings_store.get().bridge_port;
            let bridge_registry = Arc::new(BridgeRegistry::new(bridge_port));

            spawn_localhost_bridge(
                app.handle().clone(),
                Arc::clone(&manager),
                Arc::clone(&settings_store),
                Arc::clone(&bridge_registry),
            );

            app.manage(settings_store);
            app.manage(manager);
            app.manage(bridge_registry);

            let _ = setup_system_tray(app);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let minimize_to_tray = window
                    .app_handle()
                    .try_state::<Arc<SettingsStore>>()
                    .map(|s| s.get().minimize_to_tray_on_close)
                    .unwrap_or(true);

                if minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_sidecars,
            get_bridge_status,
            get_settings,
            save_settings,
            get_diagnostics,
            update_yt_dlp,
            list_downloads,
            probe_media,
            add_download,
            pause_download,
            resume_download,
            stop_all_downloads,
            delete_download,
            open_file,
            open_folder,
            pick_download_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ไทยDM application");
}
