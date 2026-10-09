//! Cloud speech recognition for recordings: live slices while recording and
//! the full-file pass after it. Off by default — recordings stay on the
//! device unless the user turns this on, has chosen a cloud engine and saved
//! its API key, and Paranoid Mode is off.
//!
//! The API key is read here from the encrypted vault; the page never sends
//! it with a live slice.

use crate::storage::get_storage_dir;
use crate::transcriber::TranscriptSegment;
use serde::Serialize;
use std::path::{Path, PathBuf};

pub const PROVIDERS: [&str; 3] = ["groq", "openai", "gemini"];

/// Longest piece sent in one request: 8 minutes of 16 kHz mono 16-bit WAV is
/// about 15 MB, under the 25 MB upload limit of the Whisper APIs.
const PIECE_SECONDS: usize = 8 * 60;

fn prefs_path() -> PathBuf {
    get_storage_dir().join("cloud_recording.txt")
}

fn read_enabled(path: &Path) -> bool {
    std::fs::read_to_string(path).is_ok_and(|s| s.trim() == "on")
}

/// The cloud provider of an engine id ("cloud_groq" → "groq").
pub fn provider_of(engine: &str) -> Option<&'static str> {
    let name = engine.strip_prefix("cloud_")?;
    PROVIDERS.iter().copied().find(|p| *p == name)
}

/// Vault entry holding a provider's API key (the page saves it there).
pub fn key_name(provider: &str) -> String {
    format!("echomind_{provider}_key")
}

/// What recordings would use, and why not when they can't.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CloudRecordingState {
    pub enabled: bool,
    /// The cloud engine chosen in the model hub, if any.
    pub provider: Option<String>,
    pub has_key: bool,
    /// False in Paranoid Mode.
    pub allowed: bool,
}

impl CloudRecordingState {
    /// Recordings actually go to the cloud.
    pub fn active(&self) -> bool {
        self.enabled && self.provider.is_some() && self.has_key && self.allowed
    }
}

fn api_key(provider: &str) -> Option<String> {
    crate::credentials::get_secure_credential(key_name(provider))
        .ok()
        .flatten()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
}

fn state() -> (CloudRecordingState, Option<String>) {
    let provider = crate::asr_engine::stored_engine()
        .as_deref()
        .and_then(provider_of)
        .map(str::to_string);
    let key = provider.as_deref().and_then(api_key);
    let state = CloudRecordingState {
        enabled: read_enabled(&prefs_path()),
        has_key: key.is_some(),
        provider,
        allowed: crate::security::check_cloud_access_allowed().is_ok(),
    };
    (state, key)
}

#[tauri::command]
pub fn get_cloud_recording() -> CloudRecordingState {
    state().0
}

#[tauri::command]
pub fn set_cloud_recording(enabled: bool) -> Result<CloudRecordingState, String> {
    let path = prefs_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, if enabled { "on" } else { "off" }).map_err(|e| e.to_string())?;
    Ok(state().0)
}

/// A cloud engine recordings should use right now.
#[derive(Debug, Clone)]
pub struct CloudChoice {
    pub provider: String,
    pub api_key: String,
    pub model: Option<String>,
}

impl CloudChoice {
    /// Engine label stored on the meeting (same as imports use).
    pub fn label(&self) -> String {
        label(&self.provider)
    }
}

pub fn label(provider: &str) -> String {
    format!("⚡ Bulut Zekası ({})", provider.to_uppercase())
}

/// The cloud engine for recordings, or `None` to stay on the device.
/// `model`: the provider model the user picked (the provider's default
/// otherwise).
pub fn active(model: Option<String>) -> Option<CloudChoice> {
    let (state, key) = state();
    if !state.active() {
        return None;
    }
    Some(CloudChoice {
        provider: state.provider?,
        api_key: key?,
        model: model
            .map(|m| m.trim().to_string())
            .filter(|m| !m.is_empty()),
    })
}

/// Transcribes 16 kHz audio with the cloud engine, in pieces small enough
/// for the upload limits, cut at natural pauses. Times are relative to the
/// start of `pcm`. Any failed piece fails the whole call, so the caller can
/// fall back to the device instead of keeping a transcript with holes.
pub fn transcribe_pcm(
    choice: &CloudChoice,
    pcm: &[f32],
    language: &str,
) -> Result<Vec<TranscriptSegment>, String> {
    crate::security::check_cloud_access_allowed()?;
    let lang = if language.trim().is_empty() {
        "auto"
    } else {
        language
    };
    let mut out = Vec::new();
    for (offset_ms, piece) in
        crate::transcriber::split_audio_at_natural_pauses(pcm, 16000, PIECE_SECONDS)
    {
        let wav = std::env::temp_dir().join(format!(
            "echomind_cloud_{}_{}.wav",
            std::process::id(),
            offset_ms
        ));
        crate::offline_engines::write_wav_16k_mono(&wav, &piece)?;
        let result = crate::cloud_transcriber::transcribe_audio_cloud(
            &wav,
            &choice.provider,
            &choice.api_key,
            lang,
            choice.model.as_deref(),
        );
        let _ = std::fs::remove_file(&wav);
        for mut seg in result? {
            seg.start_time_ms += offset_ms;
            seg.end_time_ms += offset_ms;
            seg.timestamp_formatted =
                crate::transcriber::format_span(seg.start_time_ms, seg.end_time_ms);
            out.push(seg);
        }
    }
    for (i, seg) in out.iter_mut().enumerate() {
        seg.id = i + 1;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engines_map_to_providers() {
        assert_eq!(provider_of("cloud_groq"), Some("groq"));
        assert_eq!(provider_of("cloud_openai"), Some("openai"));
        assert_eq!(provider_of("cloud_gemini"), Some("gemini"));
        assert_eq!(provider_of("cloud_other"), None);
        assert_eq!(provider_of("local"), None);
        assert_eq!(provider_of("apple_speech"), None);
        assert_eq!(key_name("groq"), "echomind_groq_key");
    }

    #[test]
    fn off_unless_the_file_says_on() {
        let dir = std::env::temp_dir().join(format!("echomind-cloudrec-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("cloud_recording.txt");
        assert!(!read_enabled(&p), "missing file means off");
        std::fs::write(&p, "off").unwrap();
        assert!(!read_enabled(&p));
        std::fs::write(&p, "on\n").unwrap();
        assert!(read_enabled(&p));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn active_needs_every_condition() {
        let ready = CloudRecordingState {
            enabled: true,
            provider: Some("groq".into()),
            has_key: true,
            allowed: true,
        };
        assert!(ready.active());
        for broken in [
            CloudRecordingState {
                enabled: false,
                ..ready.clone()
            },
            CloudRecordingState {
                provider: None,
                ..ready.clone()
            },
            CloudRecordingState {
                has_key: false,
                ..ready.clone()
            },
            CloudRecordingState {
                allowed: false,
                ..ready.clone()
            },
        ] {
            assert!(!broken.active(), "{broken:?}");
        }
    }

    #[test]
    fn nothing_goes_to_the_cloud_by_default() {
        // Unit tests use an empty data directory: the setting is off.
        assert!(!get_cloud_recording().enabled);
        assert!(active(None).is_none());
    }

    #[test]
    fn label_names_the_provider() {
        assert_eq!(label("groq"), "⚡ Bulut Zekası (GROQ)");
    }
}
