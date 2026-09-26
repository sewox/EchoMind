//! Durable FLAC-first background transcription job queue.
//!
//! Jobs are keyed by meeting id, persisted under `data/transcription_jobs.json`,
//! and processed one-at-a-time on a dedicated OS worker thread. Live capture
//! always takes priority: a running batch job is aborted and returned to
//! `queued` (never cancelled/lost) so Whisper is free for the live session.
//! Quit mirrors #59: abort Whisper, bounded wait, running job → `queued`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::storage::{get_global_storage, get_storage_dir, MeetingRecord};
use crate::transcriber::TranscriptSegment;

/// Default retry budget for transient Whisper / decode failures.
pub const DEFAULT_MAX_ATTEMPTS: u32 = 3;

/// Clear English/Turkish-facing message when the FLAC is gone.
pub const MISSING_FLAC_ERROR: &str =
    "Ses dosyası (FLAC) bulunamadı; yazıya dökülemez. / Audio file (FLAC) not found.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionJobState {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
}

impl TranscriptionJobState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TranscriptionJob {
    pub meeting_id: String,
    pub audio_path: String,
    pub state: TranscriptionJobState,
    pub attempts: u32,
    pub max_attempts: u32,
    #[serde(default)]
    pub last_error: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct JobQueueFile {
    jobs: Vec<TranscriptionJob>,
}

/// Pure state machine for the in-memory queue (unit-tested without Whisper).
#[derive(Debug, Default)]
pub struct JobQueueState {
    jobs: Vec<TranscriptionJob>,
}

impl JobQueueState {
    pub fn jobs(&self) -> &[TranscriptionJob] {
        &self.jobs
    }

    pub fn get(&self, meeting_id: &str) -> Option<&TranscriptionJob> {
        self.jobs.iter().find(|j| j.meeting_id == meeting_id)
    }

    pub fn get_mut(&mut self, meeting_id: &str) -> Option<&mut TranscriptionJob> {
        self.jobs.iter_mut().find(|j| j.meeting_id == meeting_id)
    }

    /// Enqueue or re-activate a job for `meeting_id`. Idempotent for queued/running.
    /// Failed/cancelled/done jobs are reset to queued so the user can retry.
    pub fn enqueue(&mut self, meeting_id: &str, audio_path: &str, now_ms: u64) -> TranscriptionJob {
        if let Some(existing) = self.get_mut(meeting_id) {
            match existing.state {
                TranscriptionJobState::Queued | TranscriptionJobState::Running => {
                    // Keep place in line; refresh path in case it was rewritten.
                    existing.audio_path = audio_path.to_string();
                    existing.updated_at_ms = now_ms;
                    return existing.clone();
                }
                TranscriptionJobState::Done
                | TranscriptionJobState::Failed
                | TranscriptionJobState::Cancelled => {
                    existing.audio_path = audio_path.to_string();
                    existing.state = TranscriptionJobState::Queued;
                    existing.attempts = 0;
                    existing.last_error = None;
                    existing.updated_at_ms = now_ms;
                    return existing.clone();
                }
            }
        }

        let job = TranscriptionJob {
            meeting_id: meeting_id.to_string(),
            audio_path: audio_path.to_string(),
            state: TranscriptionJobState::Queued,
            attempts: 0,
            max_attempts: DEFAULT_MAX_ATTEMPTS,
            last_error: None,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
        };
        self.jobs.push(job.clone());
        job
    }

    /// Next FIFO queued job, or `None`.
    pub fn next_queued(&self) -> Option<&TranscriptionJob> {
        self.jobs
            .iter()
            .find(|j| j.state == TranscriptionJobState::Queued)
    }

    /// Claim the next queued job as running. Returns the meeting id.
    pub fn claim_next(&mut self, now_ms: u64) -> Option<TranscriptionJob> {
        let idx = self
            .jobs
            .iter()
            .position(|j| j.state == TranscriptionJobState::Queued)?;
        let job = &mut self.jobs[idx];
        job.state = TranscriptionJobState::Running;
        job.updated_at_ms = now_ms;
        Some(job.clone())
    }

    /// After a crash/quit mid-run: any `running` job becomes `queued` again.
    pub fn recover_running_to_queued(&mut self, now_ms: u64) -> usize {
        let mut n = 0;
        for job in &mut self.jobs {
            if job.state == TranscriptionJobState::Running {
                job.state = TranscriptionJobState::Queued;
                job.updated_at_ms = now_ms;
                n += 1;
            }
        }
        n
    }

    /// Quit / live-yield: return a specific running job to queued (no attempt burn).
    pub fn return_running_to_queued(&mut self, meeting_id: &str, now_ms: u64) -> bool {
        if let Some(job) = self.get_mut(meeting_id) {
            if job.state == TranscriptionJobState::Running {
                job.state = TranscriptionJobState::Queued;
                job.updated_at_ms = now_ms;
                // Do not clear last_error — useful diagnostics if it failed before.
                return true;
            }
        }
        false
    }

    pub fn mark_done(&mut self, meeting_id: &str, now_ms: u64) -> bool {
        if let Some(job) = self.get_mut(meeting_id) {
            job.state = TranscriptionJobState::Done;
            job.last_error = None;
            job.updated_at_ms = now_ms;
            return true;
        }
        false
    }

    /// Permanent failure (missing FLAC, exhausted retries).
    pub fn mark_failed(&mut self, meeting_id: &str, error: &str, now_ms: u64) -> bool {
        if let Some(job) = self.get_mut(meeting_id) {
            job.state = TranscriptionJobState::Failed;
            job.last_error = Some(error.to_string());
            job.updated_at_ms = now_ms;
            return true;
        }
        false
    }

    /// Transient failure: bump attempts; requeue or fail if budget exhausted.
    pub fn record_attempt_failure(
        &mut self,
        meeting_id: &str,
        error: &str,
        now_ms: u64,
    ) -> TranscriptionJobState {
        let Some(job) = self.get_mut(meeting_id) else {
            return TranscriptionJobState::Failed;
        };
        job.attempts = job.attempts.saturating_add(1);
        job.last_error = Some(error.to_string());
        job.updated_at_ms = now_ms;
        if job.attempts >= job.max_attempts {
            job.state = TranscriptionJobState::Failed;
        } else {
            job.state = TranscriptionJobState::Queued;
        }
        job.state
    }

    /// Auto-enqueue `transcript_pending` meetings that have a FLAC path.
    /// Skips meetings already queued/running. Missing files are enqueued then
    /// immediately marked failed by the worker (or here if `validate_paths`).
    pub fn sync_pending_meetings(
        &mut self,
        meetings: &[MeetingRecord],
        now_ms: u64,
        validate_paths: bool,
    ) -> Vec<TranscriptionJob> {
        let mut touched = Vec::new();
        for mtg in meetings {
            if !mtg.transcript_pending {
                continue;
            }
            let Some(ref path) = mtg.audio_file_path else {
                // No audio at all — surface as a failed job so the UI can show why.
                let job = self.enqueue(&mtg.id, "", now_ms);
                self.mark_failed(&mtg.id, MISSING_FLAC_ERROR, now_ms);
                if let Some(j) = self.get(&mtg.id) {
                    touched.push(j.clone());
                } else {
                    touched.push(job);
                }
                continue;
            };
            if validate_paths && !Path::new(path).exists() {
                let _ = self.enqueue(&mtg.id, path, now_ms);
                self.mark_failed(&mtg.id, MISSING_FLAC_ERROR, now_ms);
                if let Some(j) = self.get(&mtg.id) {
                    touched.push(j.clone());
                }
                continue;
            }
            // Already actively queued/running — leave alone.
            if let Some(existing) = self.get(&mtg.id) {
                if matches!(
                    existing.state,
                    TranscriptionJobState::Queued | TranscriptionJobState::Running
                ) {
                    continue;
                }
            }
            touched.push(self.enqueue(&mtg.id, path, now_ms));
        }
        touched
    }

    fn from_file(file: JobQueueFile) -> Self {
        Self { jobs: file.jobs }
    }

    fn to_file(&self) -> JobQueueFile {
        JobQueueFile {
            jobs: self.jobs.clone(),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn queue_file_path() -> PathBuf {
    get_storage_dir().join("transcription_jobs.json")
}

fn load_queue_from_disk(path: &Path) -> JobQueueState {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<JobQueueFile>(&raw) {
            Ok(file) => JobQueueState::from_file(file),
            Err(e) => {
                eprintln!("⚠️ transcription_jobs.json parse error: {}", e);
                JobQueueState::default()
            }
        },
        Err(_) => JobQueueState::default(),
    }
}

fn save_queue_to_disk(path: &Path, state: &JobQueueState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&state.to_file()).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

struct QueueInner {
    state: JobQueueState,
    path: PathBuf,
}

impl QueueInner {
    fn persist(&self) {
        if let Err(e) = save_queue_to_disk(&self.path, &self.state) {
            eprintln!("⚠️ transcription queue persist failed: {}", e);
        }
    }
}

struct QueueRuntime {
    inner: Mutex<QueueInner>,
    wake: Condvar,
    worker_started: AtomicBool,
    /// Live capture wants Whisper — batch must yield.
    yield_for_live: AtomicBool,
    /// App is quitting — worker should exit after requeue.
    shutting_down: AtomicBool,
}

fn global_queue() -> &'static QueueRuntime {
    static Q: OnceLock<QueueRuntime> = OnceLock::new();
    Q.get_or_init(|| QueueRuntime {
        inner: Mutex::new(QueueInner {
            state: JobQueueState::default(),
            path: queue_file_path(),
        }),
        wake: Condvar::new(),
        worker_started: AtomicBool::new(false),
        yield_for_live: AtomicBool::new(false),
        shutting_down: AtomicBool::new(false),
    })
}

/// Load persisted jobs + recover running→queued. Call after secure storage unlock.
pub fn recover_from_disk() {
    let q = global_queue();
    let mut guard = q.inner.lock().unwrap();
    guard.path = queue_file_path();
    guard.state = load_queue_from_disk(&guard.path);
    let n = guard.state.recover_running_to_queued(now_ms());
    if n > 0 {
        println!(
            "🔁 Transcription queue: {} running job(s) restored to queued after restart",
            n
        );
    }
    guard.persist();
}

/// Auto-enqueue `transcript_pending` meetings (default recovery strategy).
pub fn sync_pending_from_history() {
    let q = global_queue();
    let meetings = get_global_storage().get_all();
    let mut guard = q.inner.lock().unwrap();
    let touched = guard.state.sync_pending_meetings(&meetings, now_ms(), true);
    if !touched.is_empty() {
        println!(
            "📋 Transcription queue: synced {} pending meeting(s)",
            touched.len()
        );
        guard.persist();
    }
    drop(guard);
    q.wake.notify_all();
}

/// Start the background worker once. Safe to call repeatedly.
pub fn ensure_worker_started(app: tauri::AppHandle) {
    let q = global_queue();
    if q.worker_started
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        q.wake.notify_all();
        return;
    }
    q.shutting_down.store(false, Ordering::SeqCst);
    std::thread::Builder::new()
        .name("echomind-tx-queue".into())
        .spawn(move || worker_loop(app))
        .ok();
}

/// After Keychain unlock: recover queue, auto-enqueue pending, start worker.
pub fn bootstrap_after_storage_unlock(app: tauri::AppHandle) {
    recover_from_disk();
    sync_pending_from_history();
    ensure_worker_started(app);
}

/// Enqueue (or re-enqueue) a meeting for FLAC-based transcription.
pub fn enqueue_meeting(meeting_id: &str, audio_path: &str) -> Result<TranscriptionJob, String> {
    if audio_path.is_empty() || !Path::new(audio_path).exists() {
        let q = global_queue();
        let mut guard = q.inner.lock().unwrap();
        let job = guard.state.enqueue(meeting_id, audio_path, now_ms());
        guard
            .state
            .mark_failed(meeting_id, MISSING_FLAC_ERROR, now_ms());
        guard.persist();
        let failed = guard.state.get(meeting_id).cloned().unwrap_or(job);
        return Ok(failed);
    }

    let q = global_queue();
    let mut guard = q.inner.lock().unwrap();
    let job = guard.state.enqueue(meeting_id, audio_path, now_ms());
    guard.persist();
    drop(guard);
    q.wake.notify_all();
    Ok(job)
}

/// Look up job status for a meeting (if any).
pub fn get_job(meeting_id: &str) -> Option<TranscriptionJob> {
    let q = global_queue();
    let guard = q.inner.lock().unwrap();
    guard.state.get(meeting_id).cloned()
}

pub fn list_jobs() -> Vec<TranscriptionJob> {
    let q = global_queue();
    let guard = q.inner.lock().unwrap();
    guard.state.jobs().to_vec()
}

/// Live capture is starting — abort any batch Whisper and free the model.
pub fn pause_for_live_capture() {
    let q = global_queue();
    q.yield_for_live.store(true, Ordering::SeqCst);
    let transcriber = crate::transcriber::get_global_transcriber();
    if transcriber.is_inference_active() {
        // Cooperative abort only — not sticky shutdown — so live can clear it.
        transcriber.request_abort();
    }
    q.wake.notify_all();
}

/// Live capture stopped — allow batch jobs to resume.
pub fn resume_after_live_capture() {
    let q = global_queue();
    q.yield_for_live.store(false, Ordering::SeqCst);
    crate::transcriber::get_global_transcriber().clear_abort();
    q.wake.notify_all();
}

/// Quit path: sticky shutdown already set on transcriber; requeue running jobs
/// and stop the worker. Does not wait on Whisper (caller does bounded wait).
pub fn prepare_queue_for_quit() {
    let q = global_queue();
    q.shutting_down.store(true, Ordering::SeqCst);
    q.yield_for_live.store(false, Ordering::SeqCst);
    let mut guard = q.inner.lock().unwrap();
    let n = guard.state.recover_running_to_queued(now_ms());
    if n > 0 {
        println!(
            "🛑 Transcription queue: {} running job(s) returned to queued on quit",
            n
        );
    }
    guard.persist();
    drop(guard);
    q.wake.notify_all();
    // Allow a fresh worker on next launch.
    q.worker_started.store(false, Ordering::SeqCst);
}

fn emit_job_update(app: &tauri::AppHandle, job: &TranscriptionJob) {
    use tauri::Emitter;
    let _ = app.emit("transcription-job-updated", job);
}

fn resolve_audio_path(path_str: &str) -> Option<PathBuf> {
    let path = PathBuf::from(path_str);
    if path.exists() {
        return Some(path);
    }
    if let Ok(cwd) = std::env::current_dir() {
        let alt1 = cwd.join(path_str);
        if alt1.exists() {
            return Some(alt1);
        }
        let alt2 = cwd.join("src-tauri").join(path_str);
        if alt2.exists() {
            return Some(alt2);
        }
    }
    None
}

fn apply_segments_to_meeting(
    meeting_id: &str,
    segments: Vec<TranscriptSegment>,
) -> Result<MeetingRecord, String> {
    get_global_storage().update_meeting_segments(meeting_id, segments)
}

fn worker_loop(app: tauri::AppHandle) {
    use tauri::Emitter;

    let q = global_queue();
    loop {
        if q.shutting_down.load(Ordering::SeqCst) {
            break;
        }

        // Yield while live capture holds the mic / Whisper.
        let should_wait = {
            let recording = crate::audio::get_global_audio_engine()
                .get_status()
                .is_recording;
            recording || q.yield_for_live.load(Ordering::SeqCst)
        };
        if should_wait {
            let guard = q.inner.lock().unwrap();
            let (_g, _) = q
                .wake
                .wait_timeout(guard, Duration::from_millis(250))
                .unwrap();
            continue;
        }

        let job = {
            let mut guard = q.inner.lock().unwrap();
            if q.shutting_down.load(Ordering::SeqCst) {
                break;
            }
            match guard.state.claim_next(now_ms()) {
                Some(j) => {
                    guard.persist();
                    j
                }
                None => {
                    let (_g, _) = q.wake.wait_timeout(guard, Duration::from_secs(2)).unwrap();
                    continue;
                }
            }
        };

        emit_job_update(&app, &job);

        // Missing FLAC → permanent fail, never crash.
        let Some(path) = resolve_audio_path(&job.audio_path) else {
            let mut guard = q.inner.lock().unwrap();
            guard
                .state
                .mark_failed(&job.meeting_id, MISSING_FLAC_ERROR, now_ms());
            guard.persist();
            if let Some(failed) = guard.state.get(&job.meeting_id).cloned() {
                drop(guard);
                emit_job_update(&app, &failed);
            }
            continue;
        };

        // Decode FLAC → PCM on this worker thread (never UI/main).
        let pcm_result = crate::importer::decode_audio_file_to_pcm16k(&path);
        let mut pcm = match pcm_result {
            Ok((samples, _)) => samples,
            Err(e) => {
                let msg = format!("FLAC decode failed: {}", e);
                let mut guard = q.inner.lock().unwrap();
                let state = guard
                    .state
                    .record_attempt_failure(&job.meeting_id, &msg, now_ms());
                guard.persist();
                if let Some(updated) = guard.state.get(&job.meeting_id).cloned() {
                    drop(guard);
                    emit_job_update(&app, &updated);
                }
                let _ = state;
                continue;
            }
        };
        crate::audio::normalize_audio_samples(&mut pcm);

        if q.shutting_down.load(Ordering::SeqCst)
            || q.yield_for_live.load(Ordering::SeqCst)
            || crate::audio::get_global_audio_engine()
                .get_status()
                .is_recording
        {
            let mut guard = q.inner.lock().unwrap();
            guard
                .state
                .return_running_to_queued(&job.meeting_id, now_ms());
            guard.persist();
            if let Some(updated) = guard.state.get(&job.meeting_id).cloned() {
                drop(guard);
                emit_job_update(&app, &updated);
            }
            continue;
        }

        let transcriber = crate::transcriber::get_global_transcriber();
        // Clear a previous live-yield abort so batch can run (no-op if quitting).
        transcriber.clear_abort();

        let result = transcriber.transcribe_pcm(&pcm, "auto");
        drop(pcm);

        match result {
            Ok(segs) if !segs.is_empty() => {
                let mut deduped: Vec<TranscriptSegment> = Vec::new();
                for seg in segs {
                    let is_dup = deduped.iter().any(|existing| {
                        existing.start_time_ms == seg.start_time_ms
                            && existing.end_time_ms == seg.end_time_ms
                            && existing.text.trim() == seg.text.trim()
                    });
                    if !is_dup {
                        let mut s = seg;
                        s.id = deduped.len() + 1;
                        deduped.push(s);
                    }
                }
                match apply_segments_to_meeting(&job.meeting_id, deduped) {
                    Ok(updated_meeting) => {
                        let mut guard = q.inner.lock().unwrap();
                        guard.state.mark_done(&job.meeting_id, now_ms());
                        guard.persist();
                        if let Some(done_job) = guard.state.get(&job.meeting_id).cloned() {
                            drop(guard);
                            emit_job_update(&app, &done_job);
                        } else {
                            drop(guard);
                        }
                        let _ = app.emit("meeting-transcript-ready", &updated_meeting);
                        println!(
                            "✅ Queue transcription done: {} ({} segments)",
                            job.meeting_id,
                            updated_meeting.segments.len()
                        );
                    }
                    Err(e) => {
                        let mut guard = q.inner.lock().unwrap();
                        let _ = guard
                            .state
                            .record_attempt_failure(&job.meeting_id, &e, now_ms());
                        guard.persist();
                        if let Some(updated) = guard.state.get(&job.meeting_id).cloned() {
                            drop(guard);
                            emit_job_update(&app, &updated);
                        }
                    }
                }
            }
            Ok(_) => {
                // Empty transcript (silent audio) — still resolve pending.
                match apply_segments_to_meeting(&job.meeting_id, Vec::new()) {
                    Ok(updated_meeting) => {
                        let mut guard = q.inner.lock().unwrap();
                        guard.state.mark_done(&job.meeting_id, now_ms());
                        guard.persist();
                        if let Some(done_job) = guard.state.get(&job.meeting_id).cloned() {
                            drop(guard);
                            emit_job_update(&app, &done_job);
                        } else {
                            drop(guard);
                        }
                        let _ = app.emit("meeting-transcript-ready", &updated_meeting);
                    }
                    Err(e) => {
                        let mut guard = q.inner.lock().unwrap();
                        let _ = guard
                            .state
                            .record_attempt_failure(&job.meeting_id, &e, now_ms());
                        guard.persist();
                        if let Some(updated) = guard.state.get(&job.meeting_id).cloned() {
                            drop(guard);
                            emit_job_update(&app, &updated);
                        }
                    }
                }
            }
            Err(e) => {
                let is_abort = e.contains("iptal")
                    || e.contains("abort")
                    || e.contains("kapanıyor")
                    || transcriber.is_abort_requested()
                    || q.shutting_down.load(Ordering::SeqCst)
                    || q.yield_for_live.load(Ordering::SeqCst);

                let mut guard = q.inner.lock().unwrap();
                if is_abort {
                    // Quit or live yield — do not burn retry budget.
                    guard
                        .state
                        .return_running_to_queued(&job.meeting_id, now_ms());
                    guard.persist();
                    if let Some(updated) = guard.state.get(&job.meeting_id).cloned() {
                        drop(guard);
                        emit_job_update(&app, &updated);
                    }
                    if q.shutting_down.load(Ordering::SeqCst) {
                        break;
                    }
                } else {
                    let _ = guard
                        .state
                        .record_attempt_failure(&job.meeting_id, &e, now_ms());
                    guard.persist();
                    if let Some(updated) = guard.state.get(&job.meeting_id).cloned() {
                        drop(guard);
                        emit_job_update(&app, &updated);
                    }
                }
            }
        }
    }

    println!("🛑 Transcription queue worker exited");
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn enqueue_meeting_transcription(meeting_id: String) -> Result<TranscriptionJob, String> {
    crate::storage::require_storage_ready()?;
    let storage = get_global_storage();
    let meetings = storage.get_all();
    let mtg = meetings
        .iter()
        .find(|m| m.id == meeting_id)
        .ok_or_else(|| format!("Toplantı bulunamadı: {}", meeting_id))?;

    let path = mtg.audio_file_path.clone().unwrap_or_default();

    // Ensure worker is alive (AppHandle may already have started it at unlock).
    // We cannot start without AppHandle here — bootstrap already did; just wake.
    let job = enqueue_meeting(&meeting_id, &path)?;
    global_queue().wake.notify_all();
    Ok(job)
}

#[tauri::command]
pub fn get_transcription_job(meeting_id: String) -> Result<Option<TranscriptionJob>, String> {
    crate::storage::require_storage_ready()?;
    Ok(get_job(&meeting_id))
}

#[tauri::command]
pub fn list_transcription_jobs() -> Result<Vec<TranscriptionJob>, String> {
    crate::storage::require_storage_ready()?;
    Ok(list_jobs())
}

/// Test-only: replace in-memory queue with a fresh empty state at a temp path.
#[cfg(test)]
pub fn reset_queue_for_test(path: PathBuf) {
    let q = global_queue();
    let mut guard = q.inner.lock().unwrap();
    guard.path = path;
    guard.state = JobQueueState::default();
    guard.persist();
    q.yield_for_live.store(false, Ordering::SeqCst);
    q.shutting_down.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    fn test_lock() -> &'static StdMutex<()> {
        static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| StdMutex::new(()))
    }

    fn sample_meeting(id: &str, pending: bool, flac: Option<&str>) -> MeetingRecord {
        MeetingRecord {
            id: id.to_string(),
            title: "Test".into(),
            date_formatted: "1".into(),
            duration_seconds: 10,
            duration_formatted: "00:10".into(),
            audio_file_path: flac.map(|s| s.to_string()),
            segments: Vec::new(),
            summary: String::new(),
            key_decisions: Vec::new(),
            meeting_goal: None,
            key_highlights: None,
            action_items: None,
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: None,
            engine_used: None,
            summary_provider: None,
            tags: None,
            transcript_pending: pending,
        }
    }

    #[test]
    fn test_enqueue_and_claim_transitions() {
        let mut q = JobQueueState::default();
        let job = q.enqueue("mtg_1", "/tmp/a.flac", 1000);
        assert_eq!(job.state, TranscriptionJobState::Queued);
        assert_eq!(job.attempts, 0);

        let claimed = q.claim_next(1001).unwrap();
        assert_eq!(claimed.meeting_id, "mtg_1");
        assert_eq!(claimed.state, TranscriptionJobState::Running);
        assert!(q.next_queued().is_none());

        assert!(q.mark_done("mtg_1", 1002));
        assert_eq!(q.get("mtg_1").unwrap().state, TranscriptionJobState::Done);
    }

    #[test]
    fn test_enqueue_idempotent_while_queued() {
        let mut q = JobQueueState::default();
        q.enqueue("mtg_1", "/tmp/a.flac", 1);
        q.enqueue("mtg_1", "/tmp/b.flac", 2);
        assert_eq!(q.jobs().len(), 1);
        assert_eq!(q.get("mtg_1").unwrap().audio_path, "/tmp/b.flac");
        assert_eq!(q.get("mtg_1").unwrap().state, TranscriptionJobState::Queued);
    }

    #[test]
    fn test_failed_job_can_be_reenqueued() {
        let mut q = JobQueueState::default();
        q.enqueue("mtg_1", "/tmp/a.flac", 1);
        q.mark_failed("mtg_1", "boom", 2);
        let again = q.enqueue("mtg_1", "/tmp/a.flac", 3);
        assert_eq!(again.state, TranscriptionJobState::Queued);
        assert_eq!(again.attempts, 0);
        assert!(again.last_error.is_none());
    }

    #[test]
    fn test_quit_while_running_returns_to_queued() {
        let mut q = JobQueueState::default();
        q.enqueue("mtg_1", "/tmp/a.flac", 1);
        let _ = q.claim_next(2).unwrap();
        assert_eq!(
            q.get("mtg_1").unwrap().state,
            TranscriptionJobState::Running
        );

        let n = q.recover_running_to_queued(3);
        assert_eq!(n, 1);
        assert_eq!(q.get("mtg_1").unwrap().state, TranscriptionJobState::Queued);
        // Attempts not burned on quit recovery.
        assert_eq!(q.get("mtg_1").unwrap().attempts, 0);
    }

    #[test]
    fn test_return_running_to_queued_specific() {
        let mut q = JobQueueState::default();
        q.enqueue("mtg_a", "/a.flac", 1);
        q.enqueue("mtg_b", "/b.flac", 1);
        let _ = q.claim_next(2).unwrap(); // mtg_a running
        assert!(q.return_running_to_queued("mtg_a", 3));
        assert_eq!(q.get("mtg_a").unwrap().state, TranscriptionJobState::Queued);
        assert_eq!(q.get("mtg_b").unwrap().state, TranscriptionJobState::Queued);
    }

    #[test]
    fn test_retry_policy_then_fail() {
        let mut q = JobQueueState::default();
        q.enqueue("mtg_1", "/tmp/a.flac", 1);
        let _ = q.claim_next(2).unwrap();

        let s1 = q.record_attempt_failure("mtg_1", "err1", 3);
        assert_eq!(s1, TranscriptionJobState::Queued);
        assert_eq!(q.get("mtg_1").unwrap().attempts, 1);

        let _ = q.claim_next(4).unwrap();
        let s2 = q.record_attempt_failure("mtg_1", "err2", 5);
        assert_eq!(s2, TranscriptionJobState::Queued);

        let _ = q.claim_next(6).unwrap();
        let s3 = q.record_attempt_failure("mtg_1", "err3", 7);
        assert_eq!(s3, TranscriptionJobState::Failed);
        assert_eq!(q.get("mtg_1").unwrap().attempts, 3);
        assert_eq!(q.get("mtg_1").unwrap().last_error.as_deref(), Some("err3"));
    }

    #[test]
    fn test_missing_flac_marks_failed() {
        let mut q = JobQueueState::default();
        // Create a real empty file for a positive path case.
        let dir = std::env::temp_dir().join(format!("echomind_q_test_{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let good = dir.join("good.flac");
        fs::write(&good, b"fLaC").unwrap();
        let meetings = [
            sample_meeting("mtg_no_path", true, None),
            sample_meeting("mtg_missing", true, Some("/nonexistent/xyz.flac")),
            sample_meeting("mtg_good", true, Some(good.to_str().unwrap())),
        ];

        let touched = q.sync_pending_meetings(&meetings, 10, true);
        assert_eq!(touched.len(), 3);
        assert_eq!(
            q.get("mtg_no_path").unwrap().state,
            TranscriptionJobState::Failed
        );
        assert!(q
            .get("mtg_no_path")
            .unwrap()
            .last_error
            .as_ref()
            .unwrap()
            .contains("FLAC"));
        assert_eq!(
            q.get("mtg_missing").unwrap().state,
            TranscriptionJobState::Failed
        );
        assert_eq!(
            q.get("mtg_good").unwrap().state,
            TranscriptionJobState::Queued
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_queue_persistence_roundtrip() {
        let _guard = test_lock().lock().unwrap();
        let dir = std::env::temp_dir().join(format!("echomind_q_persist_{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("transcription_jobs.json");

        let mut q = JobQueueState::default();
        q.enqueue("mtg_persist", "/data/recordings/a.flac", 42);
        save_queue_to_disk(&path, &q).unwrap();

        let loaded = load_queue_from_disk(&path);
        assert_eq!(loaded.jobs().len(), 1);
        assert_eq!(loaded.get("mtg_persist").unwrap().meeting_id, "mtg_persist");
        assert_eq!(
            loaded.get("mtg_persist").unwrap().state,
            TranscriptionJobState::Queued
        );

        // Simulate quit-while-running then restart recovery.
        let mut q2 = loaded;
        let _ = q2.claim_next(50).unwrap();
        save_queue_to_disk(&path, &q2).unwrap();
        let mut q3 = load_queue_from_disk(&path);
        assert_eq!(
            q3.get("mtg_persist").unwrap().state,
            TranscriptionJobState::Running
        );
        q3.recover_running_to_queued(60);
        assert_eq!(
            q3.get("mtg_persist").unwrap().state,
            TranscriptionJobState::Queued
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_fifo_order_across_meetings() {
        let mut q = JobQueueState::default();
        q.enqueue("mtg_first", "/a.flac", 1);
        q.enqueue("mtg_second", "/b.flac", 2);
        q.enqueue("mtg_third", "/c.flac", 3);

        assert_eq!(q.claim_next(10).unwrap().meeting_id, "mtg_first");
        assert_eq!(q.claim_next(11).unwrap().meeting_id, "mtg_second");
        assert_eq!(q.claim_next(12).unwrap().meeting_id, "mtg_third");
        assert!(q.claim_next(13).is_none());
    }

    #[test]
    fn test_state_as_str_stable_for_frontend() {
        assert_eq!(TranscriptionJobState::Queued.as_str(), "queued");
        assert_eq!(TranscriptionJobState::Running.as_str(), "running");
        assert_eq!(TranscriptionJobState::Done.as_str(), "done");
        assert_eq!(TranscriptionJobState::Failed.as_str(), "failed");
        assert_eq!(TranscriptionJobState::Cancelled.as_str(), "cancelled");
    }
}
