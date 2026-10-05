//! Progress of an audio import / re-transcription, streamed to the UI as
//! `import-progress` events, and the one-import-at-a-time guard.
//!
//! Reports are tied to the thread running the import: the transcriber is
//! shared with the background queue, and only the import's own work may move
//! the import's progress bar.

use serde::Serialize;
use std::cell::Cell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;

pub const EVENT: &str = "import-progress";

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static BUSY: AtomicBool = AtomicBool::new(false);

thread_local! {
    static ON_IMPORT_THREAD: Cell<bool> = const { Cell::new(false) };
}

pub fn init(app: tauri::AppHandle) {
    let _ = APP.set(app);
}

/// `percent` is the overall progress (0–100); `None` while the engine gives
/// no measure of its own (cloud APIs) — the UI then shows an indeterminate bar.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ImportProgress {
    pub stage: &'static str,
    pub percent: Option<f32>,
}

// Overall share of each stage. The report from the on-device model takes
// about as long as transcription, so the two split most of the bar.
const DECODE_PCT: f32 = 2.0;
const TRANSCRIBE_START: f32 = 5.0;
const TRANSCRIBE_END: f32 = 65.0;
const DIARIZE_PCT: f32 = 67.0;
const SUMMARIZE_START: f32 = 70.0;
const SUMMARIZE_END: f32 = 97.0;
const SAVE_PCT: f32 = 98.0;

fn emit(progress: ImportProgress) {
    if let Some(app) = APP.get() {
        let _ = app.emit(EVENT, progress);
    }
}

fn report(stage: &'static str, percent: Option<f32>) {
    if ON_IMPORT_THREAD.with(Cell::get) {
        emit(ImportProgress { stage, percent });
    }
}

pub fn decoding() {
    report("decoding", Some(DECODE_PCT));
}

/// Transcription with a measurable fraction done (0.0–1.0).
pub fn transcribing(fraction: f32) {
    report("transcribing", Some(transcribe_percent(fraction)));
}

/// Transcription by an engine that reports no progress.
pub fn transcribing_unmeasured() {
    report("transcribing", None);
}

pub fn diarizing() {
    report("diarizing", Some(DIARIZE_PCT));
}

/// Report generation with `fraction` (0.0–1.0) done.
pub fn summarizing(fraction: f32) {
    report(
        "summarizing",
        Some(SUMMARIZE_START + (SUMMARIZE_END - SUMMARIZE_START) * fraction.clamp(0.0, 1.0)),
    );
}

pub fn saving() {
    report("saving", Some(SAVE_PCT));
}

fn transcribe_percent(fraction: f32) -> f32 {
    TRANSCRIBE_START + (TRANSCRIBE_END - TRANSCRIBE_START) * fraction.clamp(0.0, 1.0)
}

/// Held for the whole import. A second import is refused while one runs:
/// after a UI reload the first one keeps going in the background, and
/// starting the same file again would transcribe it twice in parallel.
pub struct ImportGuard(());

impl ImportGuard {
    pub fn acquire() -> Result<Self, String> {
        BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| {
                "Başka bir ses dosyası şu anda yazıya dökülüyor. Lütfen bitmesini bekleyin."
                    .to_string()
            })?;
        ON_IMPORT_THREAD.with(|c| c.set(true));
        Ok(Self(()))
    }
}

impl Drop for ImportGuard {
    fn drop(&mut self) {
        ON_IMPORT_THREAD.with(|c| c.set(false));
        BUSY.store(false, Ordering::SeqCst);
        // Lets a reloaded UI, which lost the original request, clear its bar.
        emit(ImportProgress {
            stage: "finished",
            percent: Some(100.0),
        });
    }
}

#[tauri::command]
pub fn is_import_running() -> bool {
    BUSY.load(Ordering::SeqCst)
}

/// Estimated progress for engines that report nothing while they run (Apple
/// dictation): ticks once a second from the expected duration, never past
/// 95% of transcription until the engine really returns. Stops on drop.
pub struct EstimatedTicker {
    stop: Arc<AtomicBool>,
}

impl EstimatedTicker {
    pub fn start(expected: Duration) -> Option<Self> {
        if !ON_IMPORT_THREAD.with(Cell::get) {
            return None;
        }
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let started = Instant::now();
        std::thread::spawn(move || {
            while !flag.load(Ordering::SeqCst) {
                emit(ImportProgress {
                    stage: "transcribing",
                    percent: Some(transcribe_percent(estimated_fraction(
                        started.elapsed(),
                        expected,
                    ))),
                });
                std::thread::sleep(Duration::from_secs(1));
            }
        });
        Some(Self { stop })
    }
}

impl Drop for EstimatedTicker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

fn estimated_fraction(elapsed: Duration, expected: Duration) -> f32 {
    if expected.is_zero() {
        return 0.95;
    }
    (elapsed.as_secs_f32() / expected.as_secs_f32()).min(0.95)
}

/// Apple dictation's run time for `audio_seconds` of audio: ~3% of the audio
/// length on Apple silicon (48 min → ~80 s), plus model start-up.
pub fn apple_expected_duration(audio_seconds: f32) -> Duration {
    Duration::from_secs_f32(audio_seconds * 0.03 + 5.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcription_maps_into_its_share_of_the_bar() {
        assert_eq!(transcribe_percent(0.0), TRANSCRIBE_START);
        assert_eq!(transcribe_percent(1.0), TRANSCRIBE_END);
        assert_eq!(transcribe_percent(7.0), TRANSCRIBE_END);
        let mid = transcribe_percent(0.5);
        assert!(mid > TRANSCRIBE_START && mid < TRANSCRIBE_END);
    }

    #[test]
    fn estimate_never_claims_completion() {
        let expected = Duration::from_secs(10);
        assert_eq!(estimated_fraction(Duration::ZERO, expected), 0.0);
        assert!((estimated_fraction(Duration::from_secs(5), expected) - 0.5).abs() < 1e-6);
        assert_eq!(estimated_fraction(Duration::from_secs(60), expected), 0.95);
        assert_eq!(
            estimated_fraction(Duration::from_secs(1), Duration::ZERO),
            0.95
        );
    }

    #[test]
    fn apple_estimate_scales_with_audio_length() {
        let short = apple_expected_duration(60.0);
        let long = apple_expected_duration(2880.0);
        assert!(long > short);
        assert!((long.as_secs_f32() - 91.4).abs() < 1.0);
    }

    #[test]
    fn only_one_import_at_a_time() {
        let first = ImportGuard::acquire().expect("first import");
        assert!(is_import_running());
        assert!(ImportGuard::acquire().is_err());
        // Other threads (the background queue) never move the import's bar.
        std::thread::spawn(|| assert!(!ON_IMPORT_THREAD.with(Cell::get)))
            .join()
            .unwrap();
        assert!(ON_IMPORT_THREAD.with(Cell::get));
        drop(first);
        assert!(!is_import_running());
        assert!(!ON_IMPORT_THREAD.with(Cell::get));
        drop(ImportGuard::acquire().expect("next import after the first ended"));
    }
}
