//! Which engine transcribes finished recordings in the background queue.
//!
//! The UI keeps its own copy in localStorage; the backend copy lets the queue
//! (which runs without the UI) honour the same choice. Live transcription
//! always uses Whisper — this preference only decides the full-file pass.

use crate::storage::get_storage_dir;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const ENGINE_LOCAL: &str = "local";
pub const ENGINE_APPLE: &str = "apple_speech";

/// Result label stored on meetings transcribed by Apple dictation.
pub const APPLE_ENGINE_LABEL: &str = "🍎 macOS Yerel Ses Tanıma";

fn prefs_path() -> PathBuf {
    get_storage_dir().join("asr_engine.txt")
}

/// Apple dictation on this Mac for the system language (asked once; the
/// answer cannot change while the app runs, except for asset installs which
/// the bridge performs on first use).
pub fn apple_available() -> bool {
    // Unit tests must not depend on the host's macOS version.
    if cfg!(test) {
        return false;
    }
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| crate::offline_engines::apple_dictation_available("auto"))
}

fn read_engine(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let engine = raw.trim();
    (!engine.is_empty()).then(|| engine.to_string())
}

/// The stored choice, or the default: Apple dictation where it exists (it
/// does not hallucinate on silence and handles Turkish far better than
/// Whisper Small), local Whisper otherwise.
fn resolve_engine(stored: Option<String>, apple: bool) -> String {
    match stored {
        Some(e) => e,
        None if apple => ENGINE_APPLE.to_string(),
        None => ENGINE_LOCAL.to_string(),
    }
}

/// True when the queue should transcribe with Apple dictation.
pub fn queue_uses_apple() -> bool {
    resolve_engine(read_engine(&prefs_path()), apple_available()) == ENGINE_APPLE
        && apple_available()
}

#[derive(Serialize)]
pub struct AsrEngineState {
    pub engine: String,
    /// False until a choice was saved (first launch of this version).
    pub stored: bool,
    pub apple_available: bool,
}

#[tauri::command]
pub fn get_asr_engine() -> AsrEngineState {
    let apple = apple_available();
    let stored = read_engine(&prefs_path());
    AsrEngineState {
        stored: stored.is_some(),
        engine: resolve_engine(stored, apple),
        apple_available: apple,
    }
}

#[tauri::command]
pub fn set_asr_engine(engine: String) -> Result<(), String> {
    let engine = engine.trim();
    if engine.is_empty() || engine.len() > 64 {
        return Err("Geçersiz motor".to_string());
    }
    let path = prefs_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, engine).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_prefers_apple_only_when_available() {
        assert_eq!(resolve_engine(None, true), ENGINE_APPLE);
        assert_eq!(resolve_engine(None, false), ENGINE_LOCAL);
    }

    #[test]
    fn stored_choice_wins_over_default() {
        assert_eq!(resolve_engine(Some("local".into()), true), ENGINE_LOCAL);
        assert_eq!(
            resolve_engine(Some("cloud_groq".into()), true),
            "cloud_groq"
        );
    }

    #[test]
    fn read_engine_ignores_blank_files() {
        let dir = std::env::temp_dir().join(format!("echomind-asr-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("asr_engine.txt");
        std::fs::write(&p, "  \n").unwrap();
        assert_eq!(read_engine(&p), None);
        std::fs::write(&p, "apple_speech\n").unwrap();
        assert_eq!(read_engine(&p).as_deref(), Some(ENGINE_APPLE));
        assert_eq!(read_engine(&dir.join("missing")), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
