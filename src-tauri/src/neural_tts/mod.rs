//! Neural Turkish voice (EMA Lightning, in-process via ONNX Runtime) for the
//! audio briefing. Turkish only; other languages keep the system voices
//! (src/tts.rs).
//!
//! The briefing is rendered one section at a time and played by the page, so
//! the first section starts while the rest is still being made.

pub mod ema;
pub mod frontend;
pub mod pronounce;

use std::path::PathBuf;
use std::sync::Mutex;

/// Where the three ONNX files live: `<models>/ema-lightning/`.
pub fn model_dir() -> PathBuf {
    crate::storage::get_models_dir().join("ema-lightning")
}

/// The neural voice reads this language (Turkish only).
pub fn speaks(lang: &str) -> bool {
    lang.split(['-', '_'])
        .next()
        .is_some_and(|l| l.eq_ignore_ascii_case("tr"))
}

fn engine() -> &'static Mutex<Option<ema::Ema>> {
    static ENGINE: Mutex<Option<ema::Ema>> = Mutex::new(None);
    &ENGINE
}

/// The neural voice can read `lang` on this machine.
#[tauri::command]
pub fn neural_voice_available(lang: String) -> bool {
    speaks(&lang) && ema::installed(&model_dir())
}

fn hints(foreign: &[String]) -> pronounce::Hints {
    pronounce::Hints {
        lexicon: crate::glossary::pronunciations(),
        foreign: foreign
            .iter()
            .map(|w| w.trim().to_lowercase())
            .filter(|w| !w.is_empty())
            .collect(),
    }
}

fn render(text: &str, foreign: &[String]) -> Result<Vec<u8>, String> {
    let mut guard = engine()
        .lock()
        .map_err(|_| "EMA: engine lock poisoned".to_string())?;
    if guard.is_none() {
        *guard = Some(ema::Ema::load(&model_dir())?);
    }
    let audio = guard.as_mut().expect("engine loaded").synthesize(
        text,
        &hints(foreign),
        1.0,
        None,
        &|_| {},
    )?;
    Ok(ema::wav_bytes(&audio))
}

/// One section of the briefing as a 48 kHz WAV (raw bytes to the page).
/// `foreign`: words the script writer marked as English.
#[tauri::command]
pub async fn neural_voice_render(
    text: String,
    lang: String,
    foreign: Option<Vec<String>>,
) -> Result<tauri::ipc::Response, String> {
    if !speaks(&lang) {
        return Err("unsupported_language".into());
    }
    if !ema::installed(&model_dir()) {
        return Err("no_voice_model".into());
    }
    let wav =
        tauri::async_runtime::spawn_blocking(move || render(&text, &foreign.unwrap_or_default()))
            .await
            .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(wav))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turkish_only() {
        assert!(speaks("tr"));
        assert!(speaks("tr-TR"));
        assert!(speaks("TR_tr"));
        assert!(!speaks("en"));
        assert!(!speaks(""));
    }

    #[test]
    fn foreign_words_become_lowercase_hints() {
        let h = hints(&["Deadline ".into(), "".into(), "Pipeline".into()]);
        assert!(h.foreign.contains("deadline") && h.foreign.contains("pipeline"));
        assert_eq!(h.foreign.len(), 2);
    }

    #[test]
    fn availability_needs_the_model_files() {
        // Unit tests use an empty temporary models directory.
        assert!(!neural_voice_available("tr".into()));
        assert!(!neural_voice_available("en".into()));
    }
}
