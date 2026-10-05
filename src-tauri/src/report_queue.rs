//! Background meeting reports with the on-device model.
//!
//! When a meeting gets its final transcript (a live recording saved, or the
//! transcription queue finished a file), its report is generated here, one
//! meeting at a time. Live capture always wins: the worker waits while
//! recording or transcribing, and a report in progress is cancelled and
//! retried later when recording starts. Not persisted: a report lost on quit
//! can be generated again from the report view.

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Duration;
use tauri::Emitter;

pub const PROGRESS_EVENT: &str = "report-progress";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ReportProgress {
    pub meeting_id: String,
    /// 0–100; `None` once finished (done, skipped or failed).
    pub percent: Option<f32>,
}

struct Queue {
    pending: Mutex<VecDeque<String>>,
    wake: Condvar,
    started: AtomicBool,
}

fn queue() -> &'static Queue {
    static Q: OnceLock<Queue> = OnceLock::new();
    Q.get_or_init(|| Queue {
        pending: Mutex::new(VecDeque::new()),
        wake: Condvar::new(),
        started: AtomicBool::new(false),
    })
}

/// Adds `id` once (a repeated request keeps its place).
fn push_unique(pending: &mut VecDeque<String>, id: &str, front: bool) {
    if pending.iter().any(|p| p == id) {
        return;
    }
    if front {
        pending.push_front(id.to_string());
    } else {
        pending.push_back(id.to_string());
    }
}

/// Queues a background report for `meeting_id` if an on-device model is
/// installed (otherwise the save-time summary stays, as before).
pub fn request_report(app: &tauri::AppHandle, meeting_id: &str) {
    if crate::local_llm::catalog::installed().is_none() {
        return;
    }
    let q = queue();
    push_unique(&mut q.pending.lock().unwrap(), meeting_id, false);
    q.wake.notify_all();
    if q.started
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        let app = app.clone();
        std::thread::Builder::new()
            .name("echomind-report-queue".into())
            .spawn(move || worker(app))
            .ok();
    }
}

fn busy_with_live_or_transcription() -> bool {
    crate::audio::get_global_audio_engine()
        .get_status()
        .is_recording
        || crate::transcription_queue::has_active_work()
}

fn emit(app: &tauri::AppHandle, meeting_id: &str, percent: Option<f32>) {
    let _ = app.emit(
        PROGRESS_EVENT,
        ReportProgress {
            meeting_id: meeting_id.to_string(),
            percent,
        },
    );
}

fn worker(app: tauri::AppHandle) {
    let q = queue();
    loop {
        let id = {
            let mut pending = q.pending.lock().unwrap();
            while pending.is_empty() {
                pending = q.wake.wait(pending).unwrap();
            }
            pending.pop_front().expect("non-empty")
        };
        if busy_with_live_or_transcription() {
            // Put it back and look again shortly.
            push_unique(&mut q.pending.lock().unwrap(), &id, true);
            std::thread::sleep(Duration::from_secs(2));
            continue;
        }
        match run_one(&app, &id) {
            Outcome::Retry => {
                push_unique(&mut q.pending.lock().unwrap(), &id, true);
                std::thread::sleep(Duration::from_secs(2));
            }
            Outcome::Finished => {}
        }
    }
}

enum Outcome {
    Finished,
    Retry,
}

fn run_one(app: &tauri::AppHandle, meeting_id: &str) -> Outcome {
    let storage = crate::storage::get_global_storage();
    let (mut segments, checked) = {
        let meetings = storage.meetings.lock().unwrap();
        match meetings.iter().find(|m| m.id == meeting_id) {
            Some(m)
                if !m.transcript_pending
                    && !m.segments.is_empty()
                    && crate::storage::is_auto_summary(m.summary_provider.as_deref()) =>
            {
                (m.segments.clone(), m.asr_corrections.is_some())
            }
            // Deleted, still transcribing (the queue asks again when done),
            // or already has a report the user chose.
            _ => return Outcome::Finished,
        }
    };
    let Some(model) = crate::local_llm::catalog::installed() else {
        return Outcome::Finished;
    };

    let cancel = AtomicBool::new(false);
    emit(app, meeting_id, Some(0.0));
    let on_progress = |f: f32| {
        // Live capture started: give the machine back to it.
        if crate::audio::get_global_audio_engine()
            .get_status()
            .is_recording
        {
            cancel.store(true, Ordering::SeqCst);
        }
        emit(app, meeting_id, Some((f * 100.0).clamp(0.0, 100.0)));
    };
    // 1) Recognition fixes (once per transcript), 2) the report on the
    //    corrected text. Correction takes about a third of the time.
    const FIX_SHARE: f32 = 0.3;
    if !checked {
        match crate::local_llm::correction::correct(&segments, model, Some(&cancel), &|f| {
            on_progress(FIX_SHARE * f)
        }) {
            Ok((fixed, corrections)) => {
                match storage.apply_corrections(meeting_id, fixed.clone(), corrections) {
                    Ok(Some(updated)) => {
                        segments = fixed;
                        let _ = app.emit("meeting-transcript-ready", &updated);
                    }
                    Ok(None) => {}
                    Err(e) => eprintln!("⚠️ Düzeltmeler kaydedilemedi ({meeting_id}): {e}"),
                }
            }
            Err(e) if e == crate::local_llm::engine::CANCELLED => {
                emit(app, meeting_id, None);
                return Outcome::Retry;
            }
            // A failed check must not block the report.
            Err(e) => eprintln!("⚠️ Transkript düzeltmesi yapılamadı ({meeting_id}): {e}"),
        }
    }
    let report_share = if checked { 1.0 } else { 1.0 - FIX_SHARE };
    let report_start = 1.0 - report_share;
    let result =
        crate::local_llm::report::generate(&segments, model, None, None, Some(&cancel), &|f| {
            on_progress(report_start + report_share * f)
        });
    match result {
        Ok(report) => {
            match storage.apply_background_report(meeting_id, &report) {
                Ok(Some(updated)) => {
                    let _ = app.emit("meeting-transcript-ready", &updated);
                }
                Ok(None) => {}
                Err(e) => eprintln!("⚠️ Arka plan raporu kaydedilemedi ({meeting_id}): {e}"),
            }
            emit(app, meeting_id, None);
            Outcome::Finished
        }
        Err(e) if e == crate::local_llm::engine::CANCELLED => {
            emit(app, meeting_id, None);
            Outcome::Retry
        }
        Err(e) => {
            eprintln!("⚠️ Arka plan raporu üretilemedi ({meeting_id}): {e}");
            emit(app, meeting_id, None);
            Outcome::Finished
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_are_deduplicated_and_retries_go_first() {
        let mut q = VecDeque::new();
        push_unique(&mut q, "a", false);
        push_unique(&mut q, "b", false);
        push_unique(&mut q, "a", false);
        assert_eq!(q, ["a", "b"]);
        push_unique(&mut q, "c", true);
        assert_eq!(q, ["c", "a", "b"]);
        push_unique(&mut q, "b", true);
        assert_eq!(q, ["c", "a", "b"]);
    }
}
