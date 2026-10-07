//! Natural on-device voices for the audio briefing, in-process via ONNX
//! Runtime: EMA Lightning for Turkish, Kokoro-82M for English. Other
//! languages keep the system voices (src/tts.rs).
//!
//! The briefing is rendered one section at a time and played by the page, so
//! the first section starts while the rest is still being made.

pub mod catalog;
pub mod ema;
pub mod english;
pub mod frontend;
pub mod kokoro;
pub mod pronounce;

use std::sync::Mutex;

/// Which voice engine reads `lang`, if any.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    Ema,
    Kokoro,
}

pub fn engine_for(lang: &str) -> Option<Engine> {
    match lang
        .split(['-', '_'])
        .next()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("tr") => Some(Engine::Ema),
        Some("en") => Some(Engine::Kokoro),
        _ => None,
    }
}

/// The Turkish voice reads this language.
pub fn speaks(lang: &str) -> bool {
    engine_for(lang) == Some(Engine::Ema)
}

fn installed(engine: Engine) -> bool {
    match engine {
        Engine::Ema => catalog::is_installed(&catalog::EMA_TR),
        Engine::Kokoro => catalog::is_installed(&catalog::KOKORO_EN),
    }
}

fn ema_engine() -> &'static Mutex<Option<ema::Ema>> {
    static E: Mutex<Option<ema::Ema>> = Mutex::new(None);
    &E
}

fn kokoro_engine() -> &'static Mutex<Option<kokoro::Kokoro>> {
    static K: Mutex<Option<kokoro::Kokoro>> = Mutex::new(None);
    &K
}

/// Drops loaded engines (before a pack is deleted).
pub fn forget_engines() {
    if let Ok(mut e) = ema_engine().lock() {
        *e = None;
    }
    if let Ok(mut k) = kokoro_engine().lock() {
        *k = None;
    }
}

/// A natural voice can read `lang` on this machine.
#[tauri::command]
pub fn neural_voice_available(lang: String) -> bool {
    engine_for(&lang).is_some_and(installed)
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

fn poisoned<T>(_: T) -> String {
    "voice engine lock poisoned".to_string()
}

fn render(
    engine: Engine,
    text: &str,
    foreign: &[String],
    voice: Option<&str>,
) -> Result<Vec<u8>, String> {
    match engine {
        Engine::Ema => {
            let mut guard = ema_engine().lock().map_err(poisoned)?;
            if guard.is_none() {
                *guard = Some(ema::Ema::load(&catalog::pack_dir(&catalog::EMA_TR))?);
            }
            let audio = guard.as_mut().expect("loaded").synthesize(
                text,
                &hints(foreign),
                1.0,
                None,
                &|_| {},
            )?;
            Ok(ema::wav_bytes(&audio))
        }
        Engine::Kokoro => {
            let mut guard = kokoro_engine().lock().map_err(poisoned)?;
            if guard.is_none() {
                *guard = Some(kokoro::Kokoro::load(&catalog::pack_dir(
                    &catalog::KOKORO_EN,
                ))?);
            }
            let voice = voice
                .filter(|v| kokoro::VOICES.contains(v))
                .unwrap_or(kokoro::VOICES[0]);
            let audio = guard
                .as_mut()
                .expect("loaded")
                .synthesize(text, voice, 1.0)?;
            Ok(ema::wav_bytes_at(&audio, kokoro::SAMPLE_RATE))
        }
    }
}

/// One section of the briefing as a WAV (raw bytes to the page).
/// `foreign`: words the script writer marked as English (Turkish voice);
/// `voice`: the English voice (`af_heart`, `bf_emma`).
#[tauri::command]
pub async fn neural_voice_render(
    text: String,
    lang: String,
    foreign: Option<Vec<String>>,
    voice: Option<String>,
) -> Result<tauri::ipc::Response, String> {
    let engine = engine_for(&lang).ok_or("unsupported_language")?;
    if !installed(engine) {
        return Err("no_voice_model".into());
    }
    let wav = tauri::async_runtime::spawn_blocking(move || {
        render(
            engine,
            &text,
            &foreign.unwrap_or_default(),
            voice.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(wav))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn languages_pick_their_engine() {
        assert_eq!(engine_for("tr"), Some(Engine::Ema));
        assert_eq!(engine_for("tr-TR"), Some(Engine::Ema));
        assert_eq!(engine_for("EN_us"), Some(Engine::Kokoro));
        assert_eq!(engine_for("de"), None);
        assert_eq!(engine_for(""), None);
        assert!(speaks("tr") && !speaks("en"));
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
        assert!(!neural_voice_available("de".into()));
    }
}
