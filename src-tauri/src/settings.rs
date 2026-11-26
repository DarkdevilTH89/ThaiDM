use crate::downloader::default_download_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

pub const DEFAULT_BRIDGE_PORT: u16 = 17890;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_download_dir")]
    pub default_download_dir: String,
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent: u32,
    #[serde(default)]
    pub auto_start_bridge_downloads: bool,
    #[serde(default = "default_true")]
    pub minimize_to_tray_on_close: bool,
    /// Preferred yt-dlp quality: "best_mp4" | "1080p" | "720p" | "audio_mp3"
    #[serde(default = "default_preferred_quality")]
    pub preferred_quality: String,
    #[serde(default = "default_true")]
    pub embed_thumbnail: bool,
    #[serde(default = "default_true")]
    pub embed_metadata: bool,
    #[serde(default = "default_bridge_port")]
    pub bridge_port: u16,
}

fn default_max_concurrent() -> u32 {
    3
}

fn default_true() -> bool {
    true
}

fn default_preferred_quality() -> String {
    "best_mp4".to_string()
}

fn default_bridge_port() -> u16 {
    DEFAULT_BRIDGE_PORT
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_download_dir: default_download_dir(),
            max_concurrent: default_max_concurrent(),
            auto_start_bridge_downloads: false,
            minimize_to_tray_on_close: true,
            preferred_quality: default_preferred_quality(),
            embed_thumbnail: true,
            embed_metadata: true,
            bridge_port: default_bridge_port(),
        }
    }
}

impl AppSettings {
    pub fn sanitized(mut self) -> Self {
        let trimmed_dir = self.default_download_dir.trim();
        if trimmed_dir.is_empty() {
            self.default_download_dir = default_download_dir();
        } else {
            self.default_download_dir = trimmed_dir.to_string();
        }

        self.max_concurrent = self.max_concurrent.clamp(1, 8);

        if !matches!(
            self.preferred_quality.as_str(),
            "best_mp4" | "1080p" | "720p" | "audio_mp3"
        ) {
            self.preferred_quality = default_preferred_quality();
        }

        if self.bridge_port < 1024 {
            self.bridge_port = DEFAULT_BRIDGE_PORT;
        }

        self
    }

    pub fn default_format_selector(&self) -> (&'static str, bool) {
        match self.preferred_quality.as_str() {
            "1080p" => (
                "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best",
                false,
            ),
            "720p" => (
                "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best",
                false,
            ),
            "audio_mp3" => ("bestaudio/best", true),
            _ => (
                "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                false,
            ),
        }
    }
}

pub struct SettingsStore {
    settings: Mutex<AppSettings>,
    settings_file: PathBuf,
}

impl SettingsStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&app_data_dir);
        let settings_file = app_data_dir.join("settings.json");
        let loaded = Self::load_from_disk(&settings_file);

        Self {
            settings: Mutex::new(loaded),
            settings_file,
        }
    }

    fn load_from_disk(path: &PathBuf) -> AppSettings {
        let Ok(raw) = fs::read_to_string(path) else {
            return AppSettings::default();
        };
        serde_json::from_str::<AppSettings>(&raw)
            .map(AppSettings::sanitized)
            .unwrap_or_default()
    }

    pub fn get(&self) -> AppSettings {
        self.settings
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn save(&self, next: AppSettings) -> Result<AppSettings, String> {
        let clean = next.sanitized();
        if let Some(parent) = self.settings_file.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create settings directory: {e}"))?;
        }
        let json = serde_json::to_string_pretty(&clean)
            .map_err(|e| format!("Failed to serialize settings: {e}"))?;
        let tmp = self.settings_file.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| format!("Failed to write settings file: {e}"))?;
        fs::rename(&tmp, &self.settings_file)
            .map_err(|e| format!("Failed to commit settings file: {e}"))?;

        if let Ok(mut guard) = self.settings.lock() {
            *guard = clean.clone();
        }
        Ok(clean)
    }
}
