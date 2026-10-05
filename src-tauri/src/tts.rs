//! Reads meeting summaries aloud with the operating system's own voices:
//! AVSpeechSynthesizer on macOS, SAPI on Windows. Offline and built in, so
//! nothing is installed. Other platforms report "unsupported" and the player
//! stays hidden.
//!
//! One utterance at a time. A watcher thread reports the natural end of the
//! reading as a `tts-state` event so the player can reset itself.

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::Emitter;

pub const STATE_EVENT: &str = "tts-state";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TtsState {
    Idle,
    Speaking,
    Paused,
}

impl TtsState {
    fn from_code(code: i32) -> Self {
        match code {
            1 => TtsState::Speaking,
            2 => TtsState::Paused,
            _ => TtsState::Idle,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TtsAvailability {
    /// This platform can read aloud at all.
    pub supported: bool,
    /// The voice that would read this language; `None` when none is installed.
    pub voice: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct StateEvent {
    state: TtsState,
    generation: u64,
}

/// Language tag for the system voices from the app's report language.
pub fn voice_language(lang: &str) -> &'static str {
    match lang
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "tr" => "tr-TR",
        "de" => "de-DE",
        "fr" => "fr-FR",
        "es" => "es-ES",
        _ => "en-US",
    }
}

fn clamp_rate(rate: f32) -> f32 {
    if rate.is_finite() {
        rate.clamp(0.5, 2.0)
    } else {
        1.0
    }
}

/// Bumped by every speak/stop, so a watcher from an earlier reading never
/// reports the end of a newer one.
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn tts_availability(lang: String) -> TtsAvailability {
    TtsAvailability {
        supported: backend::SUPPORTED,
        voice: backend::voice(voice_language(&lang)),
    }
}

/// Starts reading `text` and returns the voice used.
#[tauri::command]
pub fn tts_speak(
    app: tauri::AppHandle,
    text: String,
    lang: String,
    rate: Option<f32>,
) -> Result<String, String> {
    if !backend::SUPPORTED {
        return Err("unsupported".into());
    }
    let text = text.trim();
    if text.is_empty() {
        return Err("empty_text".into());
    }
    let voice = backend::speak(text, voice_language(&lang), clamp_rate(rate.unwrap_or(1.0)))?;
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::Builder::new()
        .name("echomind-tts-watch".into())
        .spawn(move || watch_until_idle(app, generation))
        .map_err(|e| e.to_string())?;
    Ok(voice)
}

#[tauri::command]
pub fn tts_stop() -> TtsState {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    backend::stop();
    TtsState::Idle
}

#[tauri::command]
pub fn tts_pause() -> TtsState {
    backend::pause();
    TtsState::from_code(backend::state())
}

#[tauri::command]
pub fn tts_resume() -> TtsState {
    backend::resume();
    TtsState::from_code(backend::state())
}

fn watch_until_idle(app: tauri::AppHandle, generation: u64) {
    // The engine may take a moment to start; give it that before trusting "idle".
    std::thread::sleep(Duration::from_millis(400));
    loop {
        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        if TtsState::from_code(backend::state()) == TtsState::Idle {
            let _ = app.emit(
                STATE_EVENT,
                StateEvent {
                    state: TtsState::Idle,
                    generation,
                },
            );
            return;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(target_os = "macos")]
mod backend {
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;

    pub const SUPPORTED: bool = true;

    extern "C" {
        fn echomind_tts_voice(lang: *const c_char) -> *mut c_char;
        fn echomind_tts_speak(text: *const c_char, lang: *const c_char, rate: f32) -> *mut c_char;
        fn echomind_tts_stop();
        fn echomind_tts_pause();
        fn echomind_tts_resume();
        fn echomind_tts_state() -> i32;
        fn echomind_free_cstring(ptr: *mut c_char);
    }

    /// Takes ownership of a string returned by the Swift side.
    unsafe fn take(raw: *mut c_char) -> String {
        if raw.is_null() {
            return String::new();
        }
        let out = CStr::from_ptr(raw).to_string_lossy().into_owned();
        echomind_free_cstring(raw);
        out
    }

    pub fn voice(lang: &str) -> Option<String> {
        let lang = CString::new(lang).ok()?;
        // SAFETY: valid NUL-terminated string; the result is freed by `take`.
        let name = unsafe { take(echomind_tts_voice(lang.as_ptr())) };
        (!name.is_empty()).then_some(name)
    }

    pub fn speak(text: &str, lang: &str, rate: f32) -> Result<String, String> {
        let text = CString::new(text.replace('\0', " ")).map_err(|e| e.to_string())?;
        let lang = CString::new(lang).map_err(|e| e.to_string())?;
        // SAFETY: both strings outlive the call; the result is freed by `take`.
        let name = unsafe { take(echomind_tts_speak(text.as_ptr(), lang.as_ptr(), rate)) };
        if name.is_empty() {
            Err("no_voice".into())
        } else {
            Ok(name)
        }
    }

    pub fn stop() {
        // SAFETY: no arguments; the Swift side serialises on the main queue.
        unsafe { echomind_tts_stop() }
    }

    pub fn pause() {
        // SAFETY: as above.
        unsafe { echomind_tts_pause() }
    }

    pub fn resume() {
        // SAFETY: as above.
        unsafe { echomind_tts_resume() }
    }

    pub fn state() -> i32 {
        // SAFETY: reads a lock-protected integer.
        unsafe { echomind_tts_state() }
    }
}

#[cfg(target_os = "windows")]
mod backend {
    //! SAPI lives in a COM apartment, so one thread owns the voice and the
    //! commands reach it over a channel.
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::{Mutex, OnceLock};
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::BOOL;
    use windows::Win32::Media::Speech::{
        IEnumSpObjectTokens, ISpObjectToken, ISpObjectTokenCategory, ISpVoice,
        SpObjectTokenCategory, SpVoice, SPCAT_VOICES, SPF_ASYNC, SPF_IS_NOT_XML,
        SPF_PURGEBEFORESPEAK, SPRS_IS_SPEAKING, SPVOICESTATUS,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    pub const SUPPORTED: bool = true;

    enum Command {
        Voice(String, Sender<Option<String>>),
        Speak(String, String, f32, Sender<Result<String, String>>),
        Stop,
        Pause,
        Resume,
        State(Sender<i32>),
    }

    fn sender() -> &'static Mutex<Sender<Command>> {
        static TX: OnceLock<Mutex<Sender<Command>>> = OnceLock::new();
        TX.get_or_init(|| {
            let (tx, rx) = channel();
            std::thread::Builder::new()
                .name("echomind-tts".into())
                .spawn(move || worker(rx))
                .expect("tts thread");
            Mutex::new(tx)
        })
    }

    fn send(command: Command) {
        if let Ok(tx) = sender().lock() {
            let _ = tx.send(command);
        }
    }

    /// SAPI's `Language` attribute (hex LCIDs) for a language tag.
    fn lcids(lang: &str) -> &'static [&'static str] {
        match lang.split('-').next().unwrap_or("") {
            "tr" => &["41F"],
            "de" => &["407"],
            "fr" => &["40C"],
            "es" => &["C0A", "40A", "80A"],
            _ => &["409", "809"],
        }
    }

    unsafe fn voice_token(lang: &str) -> Option<ISpObjectToken> {
        let category: ISpObjectTokenCategory =
            CoCreateInstance(&SpObjectTokenCategory, None, CLSCTX_ALL).ok()?;
        category.SetId(SPCAT_VOICES, BOOL::from(false)).ok()?;
        for lcid in lcids(lang) {
            let wanted = HSTRING::from(format!("Language={lcid}"));
            let tokens: IEnumSpObjectTokens = match category.EnumTokens(&wanted, PCWSTR::null()) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let mut found: [Option<ISpObjectToken>; 1] = [None];
            let mut fetched = 0u32;
            if tokens
                .Next(1, found.as_mut_ptr(), Some(&mut fetched as *mut u32))
                .is_ok()
                && fetched == 1
            {
                if let Some(token) = found[0].take() {
                    return Some(token);
                }
            }
        }
        None
    }

    unsafe fn token_name(token: &ISpObjectToken) -> String {
        match token.GetStringValue(PCWSTR::null()) {
            Ok(raw) if !raw.is_null() => {
                let name = raw.to_string().unwrap_or_default();
                CoTaskMemFree(Some(raw.0 as *const _));
                name
            }
            _ => "Windows".into(),
        }
    }

    /// SAPI rate: -10..10, 0 = normal; roughly +3 doubles the pace.
    fn sapi_rate(rate: f32) -> i32 {
        ((rate.log2() * 3.0).round() as i32).clamp(-10, 10)
    }

    fn worker(rx: Receiver<Command>) {
        // SAFETY: COM is initialised once on this thread, which owns the voice.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let voice: Option<ISpVoice> = unsafe { CoCreateInstance(&SpVoice, None, CLSCTX_ALL).ok() };
        let mut paused = false;
        for command in rx {
            // SAFETY: every call goes through the voice owned by this thread.
            unsafe {
                match command {
                    Command::Voice(lang, reply) => {
                        let _ = reply.send(voice_token(&lang).map(|t| token_name(&t)));
                    }
                    Command::Speak(text, lang, rate, reply) => {
                        let result = match (&voice, voice_token(&lang)) {
                            (None, _) => Err("unsupported".to_string()),
                            (Some(_), None) => Err("no_voice".to_string()),
                            (Some(v), Some(token)) => {
                                if paused {
                                    let _ = v.Resume();
                                    paused = false;
                                }
                                let name = token_name(&token);
                                v.SetVoice(&token)
                                    .and_then(|_| v.SetRate(sapi_rate(rate)))
                                    .and_then(|_| {
                                        v.Speak(
                                            &HSTRING::from(text.as_str()),
                                            (SPF_ASYNC.0
                                                | SPF_PURGEBEFORESPEAK.0
                                                | SPF_IS_NOT_XML.0)
                                                as u32,
                                            None,
                                        )
                                    })
                                    .map(|_| name)
                                    .map_err(|e| e.message())
                            }
                        };
                        let _ = reply.send(result);
                    }
                    Command::Stop => {
                        if let Some(v) = &voice {
                            if paused {
                                let _ = v.Resume();
                                paused = false;
                            }
                            let _ = v.Speak(
                                PCWSTR::null(),
                                (SPF_ASYNC.0 | SPF_PURGEBEFORESPEAK.0) as u32,
                                None,
                            );
                        }
                    }
                    Command::Pause => {
                        if let Some(v) = &voice {
                            if !paused && v.Pause().is_ok() {
                                paused = true;
                            }
                        }
                    }
                    Command::Resume => {
                        if let Some(v) = &voice {
                            if paused && v.Resume().is_ok() {
                                paused = false;
                            }
                        }
                    }
                    Command::State(reply) => {
                        let code = match &voice {
                            Some(v) => {
                                let mut status = SPVOICESTATUS::default();
                                let speaking =
                                    v.GetStatus(&mut status, std::ptr::null_mut()).is_ok()
                                        && status.dwRunningState & (SPRS_IS_SPEAKING.0 as u32) != 0;
                                match (speaking, paused) {
                                    (_, true) => 2,
                                    (true, false) => 1,
                                    _ => 0,
                                }
                            }
                            None => 0,
                        };
                        let _ = reply.send(code);
                    }
                }
            }
        }
    }

    pub fn voice(lang: &str) -> Option<String> {
        let (tx, rx) = channel();
        send(Command::Voice(lang.to_string(), tx));
        rx.recv().ok().flatten()
    }

    pub fn speak(text: &str, lang: &str, rate: f32) -> Result<String, String> {
        let (tx, rx) = channel();
        send(Command::Speak(text.to_string(), lang.to_string(), rate, tx));
        rx.recv().map_err(|e| e.to_string())?
    }

    pub fn stop() {
        send(Command::Stop);
    }

    pub fn pause() {
        send(Command::Pause);
    }

    pub fn resume() {
        send(Command::Resume);
    }

    pub fn state() -> i32 {
        let (tx, rx) = channel();
        send(Command::State(tx));
        rx.recv().unwrap_or(0)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn rate_maps_to_sapi_scale() {
            assert_eq!(sapi_rate(1.0), 0);
            assert_eq!(sapi_rate(2.0), 3);
            assert_eq!(sapi_rate(1.5), 2);
            assert_eq!(sapi_rate(0.5), -3);
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod backend {
    pub const SUPPORTED: bool = false;

    pub fn voice(_lang: &str) -> Option<String> {
        None
    }
    pub fn speak(_text: &str, _lang: &str, _rate: f32) -> Result<String, String> {
        Err("unsupported".into())
    }
    pub fn stop() {}
    pub fn pause() {}
    pub fn resume() {}
    pub fn state() -> i32 {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_languages_map_to_voice_tags() {
        assert_eq!(voice_language("tr"), "tr-TR");
        assert_eq!(voice_language("de"), "de-DE");
        assert_eq!(voice_language("fr-CA"), "fr-FR");
        assert_eq!(voice_language("es_MX"), "es-ES");
        assert_eq!(voice_language("en"), "en-US");
        assert_eq!(voice_language("auto"), "en-US");
    }

    #[test]
    fn rate_is_clamped_to_a_sane_range() {
        assert_eq!(clamp_rate(1.25), 1.25);
        assert_eq!(clamp_rate(10.0), 2.0);
        assert_eq!(clamp_rate(0.0), 0.5);
        assert_eq!(clamp_rate(f32::NAN), 1.0);
    }

    #[test]
    fn engine_states_decode() {
        assert_eq!(TtsState::from_code(0), TtsState::Idle);
        assert_eq!(TtsState::from_code(1), TtsState::Speaking);
        assert_eq!(TtsState::from_code(2), TtsState::Paused);
        assert_eq!(TtsState::from_code(-1), TtsState::Idle);
    }

    #[test]
    fn stop_and_state_are_safe_without_a_reading() {
        // No main run loop in tests, so nothing is spoken; these must not hang.
        assert_eq!(tts_stop(), TtsState::Idle);
        let _ = backend::state();
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[test]
    fn other_platforms_report_unsupported() {
        let a = tts_availability("tr".into());
        assert!(!a.supported);
        assert_eq!(a.voice, None);
    }
}
