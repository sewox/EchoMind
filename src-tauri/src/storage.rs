use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use flacenc::bitsink::ByteSink;
use flacenc::component::BitRepr;
use flacenc::error::Verify;
use flacenc::source::MemSource;

use crate::transcriber::TranscriptSegment;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActionItem {
    pub task: String,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub source_citations: Vec<usize>,
    #[serde(default)]
    pub is_completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TopicBreakdown {
    pub topic_title: String,
    pub bullet_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingRecord {
    pub id: String,
    pub title: String,
    pub date_formatted: String,
    pub duration_seconds: u64,
    pub duration_formatted: String,
    pub audio_file_path: Option<String>,
    pub segments: Vec<TranscriptSegment>,
    pub summary: String,
    pub key_decisions: Vec<String>,
    #[serde(default)]
    pub meeting_goal: Option<String>,
    #[serde(default)]
    pub key_highlights: Option<Vec<String>>,
    #[serde(default)]
    pub action_items: Option<Vec<ActionItem>>,
    #[serde(default)]
    pub phase1_agreed: Option<Vec<String>>,
    #[serde(default)]
    pub phase2_deferred: Option<Vec<String>>,
    #[serde(default)]
    pub detailed_topics: Option<Vec<TopicBreakdown>>,
    #[serde(default)]
    pub participants: Option<Vec<String>>,
    #[serde(default)]
    pub engine_used: Option<String>,
    #[serde(default)]
    pub summary_provider: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

pub struct StorageEngine {
    pub file_path: PathBuf,
    pub meetings: Arc<Mutex<Vec<MeetingRecord>>>,
}

// These helpers back the release-build branch of `resolve_persistent_dir` below
// (excluded from dev/`debug_assertions` builds, since those keep the old
// CWD-relative behavior) but are directly unit-tested, hence `any(test, ...)`.
#[cfg(any(test, not(debug_assertions)))]
const APP_DIR_NAME: &str = "echomind";
#[cfg(any(test, not(debug_assertions)))]
const APP_BUNDLE_ID: &str = "com.echomind.assistant";

/// Computes the OS-standard, per-user, CWD-independent app data root for the given
/// platform id ("macos" | "windows" | "linux" | anything else), using `get_env` to
/// look up the handful of env vars each platform relies on. Pure and injectable so
/// it's unit-testable without mutating real process env vars (unsafe to do under
/// Rust's parallel test runner). Returns None if the platform's expected env var
/// isn't set (essentially never on a real desktop install) or the platform isn't
/// one of the three we ship to — callers fall back to legacy CWD-relative behavior.
#[cfg(any(test, not(debug_assertions)))]
fn os_standard_app_root_for(
    target_os: &str,
    get_env: &dyn Fn(&str) -> Option<String>,
) -> Option<PathBuf> {
    match target_os {
        "macos" => get_env("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join(APP_BUNDLE_ID)
        }),
        "windows" => get_env("APPDATA").map(|appdata| PathBuf::from(appdata).join(APP_DIR_NAME)),
        "linux" => {
            if let Some(xdg) = get_env("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
                return Some(PathBuf::from(xdg).join(APP_DIR_NAME));
            }
            get_env("HOME").map(|home| {
                PathBuf::from(home)
                    .join(".local")
                    .join("share")
                    .join(APP_DIR_NAME)
            })
        }
        _ => None,
    }
}

#[cfg(all(not(test), not(debug_assertions)))]
fn os_standard_app_root() -> Option<PathBuf> {
    let target_os = std::env::consts::OS;
    os_standard_app_root_for(target_os, &|key| std::env::var(key).ok())
}

/// The old CWD-relative resolution (kept for dev builds and as a migration/fallback
/// source): resolves `subdir` against the process's current working directory,
/// stepping out of `src-tauri/` to the project root first if that's where we are
/// (the `cargo run` / `cargo tauri dev` case).
fn legacy_cwd_relative_dir(subdir: &str) -> PathBuf {
    if let Ok(cwd) = std::env::current_dir() {
        let root = if cwd.ends_with("src-tauri") {
            cwd.parent().unwrap_or(&cwd).to_path_buf()
        } else {
            cwd
        };
        return root.join(subdir);
    }
    PathBuf::from(subdir)
}

#[cfg(any(test, not(debug_assertions)))]
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest_path = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &dest_path)?;
        } else {
            fs::copy(&path, &dest_path)?;
        }
    }
    Ok(())
}

/// Best-effort, non-destructive migration: if `new_dir` doesn't exist yet (first
/// time a release build resolves it), and one of `candidates` exists with
/// content, copy it into `new_dir`. Each candidate is only ever copied from,
/// never deleted or modified — so a bug here can never lose data, at worst it
/// leaves the user exactly where they'd be without migration (a fresh, empty
/// `new_dir`).
#[cfg(any(test, not(debug_assertions)))]
fn migrate_legacy_dir_if_present(new_dir: &std::path::Path, candidates: Vec<PathBuf>) {
    if new_dir.exists() {
        return;
    }

    for candidate in candidates {
        if candidate == *new_dir || !candidate.is_dir() {
            continue;
        }
        if let Some(parent) = new_dir.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if copy_dir_recursive(&candidate, new_dir).is_ok() {
            eprintln!(
                "ℹ️ [Migration] {:?} içeriği {:?} konumuna taşındı (eski dosyalar korunuyor, silinmedi).",
                candidate, new_dir
            );
            return;
        } else {
            // Partial/failed copy: don't leave a half-migrated directory behind to
            // be mistaken for "already migrated" on the next launch.
            let _ = fs::remove_dir_all(new_dir);
        }
    }
}

/// Resolves a persistent directory for `subdir` ("data" or "models"), given the
/// dev-build resolution (`dev_dir`, run only under `debug_assertions`, i.e.
/// `cargo run` / `cargo tauri dev`) and the candidate legacy locations to try
/// migrating from on a release build's first run. Strategy per build context:
/// - test: an isolated temp directory — tests must never touch real user/dev state.
/// - dev: `dev_dir()`, unchanged from the previous CWD-relative behavior — keeps
///   the existing developer workflow (e.g. the committed demo `data/` fixture, or
///   models already sitting in `src-tauri/models/`) working exactly as before.
/// - release (what actually ships to users): a stable, OS-standard, per-user
///   directory instead of the process's CWD, which is unpredictable for a
///   packaged app (desktop icon vs terminal vs launcher) and can be entirely
///   non-writable (e.g. a Linux .deb installs under /usr/bin). Best-effort
///   migrates the first matching legacy candidate into the new location on first
///   use so upgrading users don't appear to lose their data or models.
#[cfg_attr(any(test, debug_assertions), allow(unused_variables))]
fn resolve_persistent_dir(
    subdir: &str,
    dev_dir: impl Fn() -> PathBuf,
    legacy_candidates: impl Fn() -> Vec<PathBuf>,
) -> PathBuf {
    #[cfg(test)]
    {
        std::env::temp_dir().join(format!("echomind_test_{}", subdir))
    }

    #[cfg(all(not(test), debug_assertions))]
    {
        dev_dir()
    }

    #[cfg(all(not(test), not(debug_assertions)))]
    {
        match os_standard_app_root() {
            Some(root) => {
                let dir = root.join(subdir);
                migrate_legacy_dir_if_present(&dir, legacy_candidates());
                dir
            }
            None => dev_dir(),
        }
    }
}

/// Executable-relative fallback candidate for migration: `<exe_dir>/<subdir>`,
/// covering the (uncommon but possible) case of a previous release build having
/// been run with data/models placed next to the binary itself.
fn exe_relative_candidate(subdir: &str) -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(subdir)))
}

pub fn get_storage_dir() -> PathBuf {
    resolve_persistent_dir(
        "data",
        || legacy_cwd_relative_dir("data"),
        || {
            let mut candidates = vec![legacy_cwd_relative_dir("data")];
            candidates.extend(exe_relative_candidate("data"));
            candidates
        },
    )
}

/// Where Whisper `.bin` model files live. See `resolve_persistent_dir` for the
/// test/dev/release resolution strategy — same stability guarantee as
/// `get_storage_dir()`, kept separate since models and app data are independent
/// (a user can wipe/reinstall one without touching the other).
///
/// Unlike `data/` (which lives at the project root), models live inside
/// `src-tauri/models/` in this repo, and `tauri dev` runs `cargo` with its CWD
/// already set to `src-tauri/` — so the dev/legacy resolution here must NOT step
/// out to the project root the way `legacy_cwd_relative_dir` does for `data/`.
pub fn get_models_dir() -> PathBuf {
    resolve_persistent_dir(
        "models",
        || PathBuf::from("models"),
        || {
            vec![
                PathBuf::from("models"),
                Path::new("src-tauri").join("models"),
                legacy_cwd_relative_dir("models"),
            ]
            .into_iter()
            .chain(exe_relative_candidate("models"))
            .collect()
        },
    )
}

impl Default for StorageEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl StorageEngine {
    pub fn new() -> Self {
        let storage_dir = get_storage_dir();
        if !storage_dir.exists() {
            let _ = fs::create_dir_all(&storage_dir);
        }

        let rec_dir = storage_dir.join("recordings");
        if !rec_dir.exists() {
            let _ = fs::create_dir_all(&rec_dir);
        }

        let file_path = storage_dir.join("meetings_history.json");
        let engine = StorageEngine {
            file_path,
            meetings: Arc::new(Mutex::new(Vec::new())),
        };

        let _ = engine.load_from_disk();
        engine
    }

    pub fn load_from_disk(&self) -> Result<Vec<MeetingRecord>, String> {
        if !self.file_path.exists() {
            return Ok(Vec::new());
        }

        match crate::encrypted_storage::load_encrypted_json::<Vec<MeetingRecord>, _>(
            &self.file_path,
        ) {
            Ok(records) => {
                let mut lock = self.meetings.lock().unwrap();
                *lock = records.clone();
                Ok(records)
            }
            Err(e) => {
                eprintln!("⚠️ Şifreli veritabanı yükleme uyarısı: {}", e);
                // A decrypt/parse failure must never be treated as "no history": if the
                // caller proceeds with an empty in-memory list and later calls
                // save_to_disk(), that would silently overwrite the real (but unreadable)
                // file with nothing. Preserve the original bytes as a backup first, so a
                // corrupt or undecryptable file can never be permanently lost.
                if let Ok(meta) = fs::metadata(&self.file_path) {
                    if meta.len() > 0 {
                        let timestamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        let backup_path = self
                            .file_path
                            .with_extension(format!("json.corrupt-{}", timestamp));
                        if fs::copy(&self.file_path, &backup_path).is_ok() {
                            eprintln!(
                                "⚠️ Okunamayan veritabanı kaybolmaması için yedeklendi: {}",
                                backup_path.display()
                            );
                        }
                    }
                }
                Ok(Vec::new())
            }
        }
    }

    pub fn save_to_disk(&self) -> Result<(), String> {
        let lock = self.meetings.lock().unwrap();
        crate::encrypted_storage::save_encrypted_json(&self.file_path, &*lock)
    }

    pub fn add_meeting(&self, mut meeting: MeetingRecord) -> Result<MeetingRecord, String> {
        if meeting.summary.is_empty() {
            meeting.summary = generate_summary_from_segments(&meeting.segments);
        }

        if meeting.key_decisions.is_empty() {
            meeting.key_decisions = extract_key_decisions(&meeting.segments);
        }

        // Auto-tagging if tags are empty
        if meeting.tags.is_none() || meeting.tags.as_ref().map(|t| t.is_empty()).unwrap_or(false) {
            let seg_texts: Vec<String> = meeting.segments.iter().map(|s| s.text.clone()).collect();
            let auto_tags = crate::auto_tagger::AutoTagEngine::extract_tags(
                &meeting.title,
                &meeting.summary,
                meeting.meeting_goal.as_deref(),
                &meeting.key_decisions,
                &seg_texts,
            );
            meeting.tags = Some(auto_tags);
        }

        {
            let mut lock = self.meetings.lock().unwrap();
            // Insert newest at beginning
            lock.insert(0, meeting.clone());
        }

        self.save_to_disk()?;
        Ok(meeting)
    }

    /// Replace transcript segments on an existing meeting (background Whisper path).
    pub fn update_meeting_segments(
        &self,
        meeting_id: &str,
        segments: Vec<TranscriptSegment>,
    ) -> Result<MeetingRecord, String> {
        let mut lock = self.meetings.lock().unwrap();
        let mtg = lock
            .iter_mut()
            .find(|m| m.id == meeting_id)
            .ok_or_else(|| format!("Toplantı bulunamadı: {}", meeting_id))?;
        mtg.segments = segments;
        if mtg.summary.is_empty() {
            mtg.summary = generate_summary_from_segments(&mtg.segments);
        }
        if mtg.key_decisions.is_empty() {
            mtg.key_decisions = extract_key_decisions(&mtg.segments);
        }
        let updated = mtg.clone();
        drop(lock);
        self.save_to_disk()?;
        Ok(updated)
    }

    pub fn get_all(&self) -> Vec<MeetingRecord> {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let lock = self.meetings.lock().unwrap();
        let mut list = lock.clone();
        for mtg in &mut list {
            if let Some(ref path) = mtg.audio_file_path {
                let p = PathBuf::from(path);
                if !p.is_absolute() {
                    let abs_p = cwd.join(path);
                    if abs_p.exists() {
                        mtg.audio_file_path = Some(abs_p.to_string_lossy().to_string());
                    }
                }
            }
        }
        list
    }

    pub fn delete_meeting(&self, id: &str) -> Result<Vec<MeetingRecord>, String> {
        {
            let mut lock = self.meetings.lock().unwrap();
            if let Some(mtg) = lock.iter().find(|m| m.id == id) {
                if let Some(ref path_str) = mtg.audio_file_path {
                    let audio_path = PathBuf::from(path_str);

                    // SAFETY GUARANTEE: Only delete files located inside the app's internal recordings directory!
                    // Never delete user's original external files (e.g. ~/Downloads/..., ~/Desktop/...).
                    let rec_dir = get_storage_dir().join("recordings");
                    let is_internal = audio_path.starts_with(&rec_dir)
                        || path_str.contains("data/recordings")
                        || path_str.contains("data\\recordings");

                    if is_internal && audio_path.exists() {
                        let _ = fs::remove_file(audio_path);
                    }
                }
            }
            lock.retain(|m| m.id != id);
        }
        self.save_to_disk()?;
        Ok(self.get_all())
    }

    pub fn update_title(&self, id: &str, new_title: &str) -> Result<Vec<MeetingRecord>, String> {
        {
            let mut lock = self.meetings.lock().unwrap();
            if let Some(mtg) = lock.iter_mut().find(|m| m.id == id) {
                mtg.title = new_title.trim().to_string();
            } else {
                return Err(format!("Toplantı bulunamadı: {}", id));
            }
        }
        self.save_to_disk()?;
        Ok(self.get_all())
    }
}

pub fn get_global_storage() -> &'static StorageEngine {
    static STORAGE: OnceLock<StorageEngine> = OnceLock::new();
    STORAGE.get_or_init(StorageEngine::new)
}

/// Encodes 16kHz mono float audio PCM samples into FLAC format (100% Lossless, 0 Distortion)
pub fn compress_audio_to_flac(samples_f32: &[f32], output_path: &PathBuf) -> Result<(), String> {
    if samples_f32.is_empty() {
        return Ok(());
    }

    // Convert f32 PCM [-1.0, 1.0] to i32 PCM [-32768, 32767]
    let samples_i32: Vec<i32> = samples_f32
        .iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i32)
        .collect();

    let sample_rate = 16000;
    let channels = 1;
    let bits_per_sample = 16;

    let source = MemSource::from_samples(&samples_i32, channels, bits_per_sample, sample_rate);
    let config = flacenc::config::Encoder::default()
        .into_verified()
        .map_err(|e| format!("FLAC config hatası: {:?}", e))?;
    let flac_stream = flacenc::encode_with_fixed_block_size(&config, source, config.block_size)
        .map_err(|e| format!("FLAC kodlama hatası: {:?}", e))?;

    let mut sink = ByteSink::new();
    flac_stream
        .write(&mut sink)
        .map_err(|e| format!("FLAC yazma hatası: {:?}", e))?;

    let flac_bytes = sink.into_inner();
    let mut file =
        File::create(output_path).map_err(|e| format!("FLAC ses dosyası oluşturulamadı: {}", e))?;
    file.write_all(&flac_bytes)
        .map_err(|e| format!("FLAC ses verisi yazılamadı: {}", e))?;

    Ok(())
}

/// Helper function to generate an intelligent summary from meeting transcript segments
pub fn generate_summary_from_segments(segments: &[TranscriptSegment]) -> String {
    if segments.is_empty() {
        return "Toplantıda henüz transkript edilmiş bir konuşma bulunmamaktadır.".to_string();
    }

    let total_words: usize = segments
        .iter()
        .map(|s| s.text.split_whitespace().count())
        .sum();
    let speakers_count = segments
        .iter()
        .map(|s| &s.speaker_name)
        .collect::<std::collections::HashSet<_>>()
        .len();

    let highlights: Vec<String> = segments
        .iter()
        .take(3)
        .map(|s| format!("• {}: \"{}\"", s.speaker_name, s.text))
        .collect();

    format!(
        "Toplantı Özeti:\n- Toplam {} konuşmacı katıldı ve {} kelime konuşuldu.\n- Önemli Öne Çıkan Notlar:\n{}",
        speakers_count,
        total_words,
        highlights.join("\n")
    )
}

/// Helper function to extract key decisions from transcript text
pub fn extract_key_decisions(segments: &[TranscriptSegment]) -> Vec<String> {
    let mut decisions = Vec::new();
    for seg in segments {
        let lower = seg.text.to_lowercase();
        if lower.contains("karar")
            || lower.contains("plan")
            || lower.contains("yapacağız")
            || lower.contains("onay")
        {
            decisions.push(format!("{}: \"{}\"", seg.speaker_name, seg.text));
        }
    }

    if decisions.is_empty() && !segments.is_empty() {
        decisions.push(format!(
            "{}: \"{}\"",
            segments[0].speaker_name, segments[0].text
        ));
    }

    decisions
}

#[tauri::command]
pub fn get_all_meetings() -> Vec<MeetingRecord> {
    let storage = get_global_storage();
    storage.get_all()
}

/// Per-session cache so concurrent/duplicate `save_current_meeting` calls return
/// the same `MeetingRecord` instead of creating a second FLAC + Whisper pass.
fn last_saved_meeting_cache() -> &'static Mutex<Option<(u64, MeetingRecord)>> {
    static CACHE: OnceLock<Mutex<Option<(u64, MeetingRecord)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

/// Serializes save attempts so a racing duplicate sees the cache after the
/// winner finishes, rather than `AlreadySaved` with an empty cache.
fn save_session_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn remember_saved_meeting(session_id: u64, meeting: MeetingRecord) {
    *last_saved_meeting_cache().lock().unwrap() = Some((session_id, meeting));
}

fn cached_saved_meeting(session_id: u64) -> Option<MeetingRecord> {
    let guard = last_saved_meeting_cache().lock().unwrap();
    guard
        .as_ref()
        .filter(|(id, _)| *id == session_id)
        .map(|(_, m)| m.clone())
}

/// Persist the current in-memory recording. FLAC compression runs off the UI
/// thread via `spawn_blocking`. Fallback Whisper is **detached** so Quit during
/// save is not blocked on transcription — results arrive later via
/// `meeting-transcript-ready`.
#[tauri::command]
pub async fn save_current_meeting(
    app: tauri::AppHandle,
    title: String,
    duration_seconds: u64,
) -> Result<MeetingRecord, String> {
    let (meeting, pending_pcm) = tauri::async_runtime::spawn_blocking(move || {
        save_current_meeting_blocking(title, duration_seconds)
    })
    .await
    .map_err(|e| format!("Kayıt görevi tamamlanamadı: {}", e))??;

    if let Some(pcm) = pending_pcm {
        let meeting_id = meeting.id.clone();
        // Fire-and-forget: do not await Whisper — Quit must not wait on Metal.
        tauri::async_runtime::spawn_blocking(move || {
            run_detached_fallback_transcription(app, meeting_id, pcm);
        });
    }

    Ok(meeting)
}

fn run_detached_fallback_transcription(
    app: tauri::AppHandle,
    meeting_id: String,
    pcm: Vec<f32>,
) {
    use tauri::Emitter;

    let transcriber = crate::transcriber::get_global_transcriber();
    if transcriber.is_abort_requested() {
        println!(
            "🛑 Arka plan transkripsiyon atlandı (kapanış): {}",
            meeting_id
        );
        return;
    }

    match transcriber.transcribe_pcm(&pcm, "auto") {
        Ok(auto_segs) if !auto_segs.is_empty() => {
            let mut deduped: Vec<TranscriptSegment> = Vec::new();
            for seg in auto_segs {
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
            match get_global_storage().update_meeting_segments(&meeting_id, deduped) {
                Ok(updated) => {
                    let _ = app.emit("meeting-transcript-ready", &updated);
                    println!(
                        "✅ Arka plan transkripsiyon tamamlandı: {} ({} segment)",
                        meeting_id,
                        updated.segments.len()
                    );
                }
                Err(e) => eprintln!("Arka plan segment güncelleme hatası: {}", e),
            }
        }
        Ok(_) => {
            println!(
                "Arka plan Whisper boş sonuç döndü (sessiz kayıt?): {}",
                meeting_id
            );
        }
        Err(e) => {
            eprintln!("Arka plan Whisper hatası ({}): {}", meeting_id, e);
        }
    }
}

/// Returns `(meeting, optional_pcm_for_detached_whisper)`.
fn save_current_meeting_blocking(
    title: String,
    duration_seconds: u64,
) -> Result<(MeetingRecord, Option<Vec<f32>>), String> {
    use crate::audio::PcmClaim;

    let _save_guard = save_session_lock()
        .lock()
        .map_err(|_| "Kayıt kilidi bozuldu".to_string())?;

    let audio_engine = crate::audio::get_global_audio_engine();
    let (session_id, raw_pcm_buffer) = match audio_engine.claim_pcm_for_save() {
        PcmClaim::AlreadySaved { session_id } => {
            if let Some(existing) = cached_saved_meeting(session_id) {
                return Ok((existing, None));
            }
            return Err(
                "Bu kayıt oturumu zaten kaydedildi (yinelenen durdurma sinyali yok sayıldı)."
                    .to_string(),
            );
        }
        PcmClaim::Claimed { session_id, pcm } => (session_id, pcm),
    };

    let transcriber = crate::transcriber::get_global_transcriber();
    let segments = transcriber.get_history();

    let now = chrono::Local::now();
    // Include session id so two rapid legitimate saves never collide on the
    // second-resolution timestamp used historically.
    let id = format!("mtg_{}_{}", now.format("%Y%m%d_%H%M%S"), session_id);
    let date_formatted = now.format("%d %B %Y, %H:%M").to_string();

    let actual_duration = if duration_seconds > 0 {
        duration_seconds
    } else {
        (raw_pcm_buffer.len() as u64) / 16000
    };

    let mins = actual_duration / 60;
    let secs = actual_duration % 60;
    let duration_formatted = format!("{:02}:{:02}", mins, secs);

    // FLAC 0-Loss Audio Compression Storage
    let storage_dir = get_storage_dir();
    let rec_dir = storage_dir.join("recordings");
    if !rec_dir.exists() {
        let _ = fs::create_dir_all(&rec_dir);
    }
    let flac_file_path = rec_dir.join(format!("{}.flac", id));

    let audio_file_path = if !raw_pcm_buffer.is_empty() {
        match compress_audio_to_flac(&raw_pcm_buffer, &flac_file_path) {
            Ok(_) => Some(flac_file_path.to_string_lossy().to_string()),
            Err(e) => {
                eprintln!("FLAC kaydetme uyarısı: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Deduplicate segments (avoid any accidental duplicate timestamps/texts)
    let mut deduplicated_segments: Vec<TranscriptSegment> = Vec::new();
    for seg in segments.into_iter() {
        let is_dup = deduplicated_segments.iter().any(|existing| {
            existing.start_time_ms == seg.start_time_ms
                && existing.end_time_ms == seg.end_time_ms
                && existing.text.trim() == seg.text.trim()
        });
        if !is_dup {
            let mut s = seg;
            s.id = deduplicated_segments.len() + 1;
            deduplicated_segments.push(s);
        }
    }

    // Defer Whisper when live segments are empty — keep PCM for a detached
    // background pass so the invoke returns (and Quit can proceed) immediately.
    let pending_pcm = if deduplicated_segments.is_empty() && raw_pcm_buffer.len() >= 16000 {
        Some(raw_pcm_buffer)
    } else {
        None
    };

    let meeting = MeetingRecord {
        id,
        title: if title.trim().is_empty() {
            format!("Toplantı - {}", date_formatted)
        } else {
            title
        },
        date_formatted,
        duration_seconds: actual_duration,
        duration_formatted,
        audio_file_path,
        segments: deduplicated_segments,
        summary: String::new(),
        key_decisions: Vec::new(),
        meeting_goal: None,
        key_highlights: None,
        action_items: None,
        phase1_agreed: None,
        phase2_deferred: None,
        detailed_topics: None,
        participants: None,
        engine_used: Some("Cihazda (Whisper Small)".to_string()),
        summary_provider: Some("EchoMind Akıllı Özet".to_string()),
        tags: None,
    };

    transcriber.clear_history();

    let storage = get_global_storage();
    let saved = storage.add_meeting(meeting)?;
    remember_saved_meeting(session_id, saved.clone());
    Ok((saved, pending_pcm))
}

#[tauri::command]
pub fn delete_meeting_by_id(
    id: Option<String>,
    meeting_id: Option<String>,
) -> Result<Vec<MeetingRecord>, String> {
    let target_id = id
        .or(meeting_id)
        .ok_or_else(|| "Toplantı ID belirtilmedi".to_string())?;
    let storage = get_global_storage();
    storage.delete_meeting(&target_id)
}

#[tauri::command]
pub fn update_meeting_speaker_name(
    meeting_id: String,
    speaker_id: String,
    new_name: String,
) -> Result<MeetingRecord, String> {
    let storage = get_global_storage();
    let mut lock = storage.meetings.lock().unwrap();
    if let Some(mtg) = lock.iter_mut().find(|m| m.id == meeting_id) {
        for seg in mtg.segments.iter_mut() {
            if seg.speaker_id == speaker_id || seg.speaker_name == speaker_id {
                seg.speaker_name = new_name.clone();
            }
        }
        let updated = mtg.clone();
        drop(lock);
        storage.save_to_disk()?;
        Ok(updated)
    } else {
        Err(format!("Toplantı bulunamadı: {}", meeting_id))
    }
}

#[tauri::command]
pub fn update_meeting_title(id: String, new_title: String) -> Result<Vec<MeetingRecord>, String> {
    let storage = get_global_storage();
    storage.update_title(&id, &new_title)
}

#[tauri::command]
pub fn add_meeting_tag(meeting_id: String, tag: String) -> Result<MeetingRecord, String> {
    let clean_tag = tag.trim().to_string();
    if clean_tag.is_empty() {
        return Err("Etiket adı boş olamaz".to_string());
    }

    let storage = get_global_storage();
    let mut lock = storage.meetings.lock().unwrap();
    if let Some(mtg) = lock.iter_mut().find(|m| m.id == meeting_id) {
        let mut tags = mtg.tags.clone().unwrap_or_default();
        if !tags.iter().any(|t| t.eq_ignore_ascii_case(&clean_tag)) {
            tags.push(clean_tag);
            mtg.tags = Some(tags);
        }
        let updated = mtg.clone();
        drop(lock);
        storage.save_to_disk()?;
        Ok(updated)
    } else {
        Err(format!("Toplantı bulunamadı: {}", meeting_id))
    }
}

#[tauri::command]
pub fn remove_meeting_tag(meeting_id: String, tag: String) -> Result<MeetingRecord, String> {
    let clean_tag = tag.trim();
    let storage = get_global_storage();
    let mut lock = storage.meetings.lock().unwrap();
    if let Some(mtg) = lock.iter_mut().find(|m| m.id == meeting_id) {
        if let Some(mut tags) = mtg.tags.clone() {
            tags.retain(|t| !t.eq_ignore_ascii_case(clean_tag));
            mtg.tags = Some(tags);
        }
        let updated = mtg.clone();
        drop(lock);
        storage.save_to_disk()?;
        Ok(updated)
    } else {
        Err(format!("Toplantı bulunamadı: {}", meeting_id))
    }
}

#[tauri::command]
pub fn get_related_meetings(
    meeting_id: String,
    limit: Option<usize>,
) -> Result<Vec<crate::auto_tagger::RelatedMeetingItem>, String> {
    let storage = get_global_storage();
    let all = storage.get_all();
    if let Some(target) = all.iter().find(|m| m.id == meeting_id) {
        let related = crate::auto_tagger::AutoTagEngine::find_related_meetings(
            target,
            &all,
            limit.unwrap_or(3),
        );
        Ok(related)
    } else {
        Err(format!("Toplantı bulunamadı: {}", meeting_id))
    }
}

#[tauri::command]
pub fn toggle_action_item_status(
    meeting_id: String,
    action_index: usize,
) -> Result<MeetingRecord, String> {
    let storage = get_global_storage();
    let mut lock = storage.meetings.lock().unwrap();
    if let Some(mtg) = lock.iter_mut().find(|m| m.id == meeting_id) {
        if let Some(items) = &mut mtg.action_items {
            if let Some(item) = items.get_mut(action_index) {
                item.is_completed = !item.is_completed;
            }
        }
        let updated = mtg.clone();
        drop(lock);
        storage.save_to_disk()?;
        Ok(updated)
    } else {
        Err(format!("Toplantı bulunamadı: {}", meeting_id))
    }
}

#[tauri::command]
pub fn get_all_tags() -> Vec<String> {
    let storage = get_global_storage();
    let all = storage.get_all();
    let mut tags_set = std::collections::HashSet::new();
    for m in all {
        if let Some(tags) = m.tags {
            for t in tags {
                if !t.trim().is_empty() {
                    tags_set.insert(t);
                }
            }
        }
    }
    let mut list: Vec<String> = tags_set.into_iter().collect();
    list.sort();
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_map(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let pairs: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |key: &str| pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    }

    #[test]
    fn test_os_standard_root_macos_uses_application_support() {
        let get_env = env_map(&[("HOME", "/Users/alice")]);
        let root = os_standard_app_root_for("macos", &get_env).unwrap();
        assert_eq!(
            root,
            PathBuf::from("/Users/alice/Library/Application Support/com.echomind.assistant")
        );
    }

    #[test]
    fn test_os_standard_root_windows_uses_appdata() {
        let get_env = env_map(&[("APPDATA", r"C:\Users\alice\AppData\Roaming")]);
        let root = os_standard_app_root_for("windows", &get_env).unwrap();
        assert_eq!(
            root,
            PathBuf::from(r"C:\Users\alice\AppData\Roaming").join("echomind")
        );
    }

    #[test]
    fn test_os_standard_root_linux_prefers_xdg_data_home() {
        let get_env = env_map(&[
            ("XDG_DATA_HOME", "/home/alice/.data"),
            ("HOME", "/home/alice"),
        ]);
        let root = os_standard_app_root_for("linux", &get_env).unwrap();
        assert_eq!(root, PathBuf::from("/home/alice/.data/echomind"));
    }

    #[test]
    fn test_os_standard_root_linux_falls_back_to_home_when_xdg_unset() {
        let get_env = env_map(&[("HOME", "/home/alice")]);
        let root = os_standard_app_root_for("linux", &get_env).unwrap();
        assert_eq!(root, PathBuf::from("/home/alice/.local/share/echomind"));
    }

    #[test]
    fn test_os_standard_root_linux_ignores_empty_xdg_data_home() {
        let get_env = env_map(&[("XDG_DATA_HOME", ""), ("HOME", "/home/alice")]);
        let root = os_standard_app_root_for("linux", &get_env).unwrap();
        assert_eq!(root, PathBuf::from("/home/alice/.local/share/echomind"));
    }

    #[test]
    fn test_os_standard_root_none_when_env_missing() {
        let get_env = env_map(&[]);
        assert!(os_standard_app_root_for("macos", &get_env).is_none());
        assert!(os_standard_app_root_for("windows", &get_env).is_none());
        assert!(os_standard_app_root_for("linux", &get_env).is_none());
    }

    #[test]
    fn test_os_standard_root_none_for_unknown_platform() {
        let get_env = env_map(&[("HOME", "/home/alice")]);
        assert!(os_standard_app_root_for("freebsd", &get_env).is_none());
    }

    #[test]
    fn test_migrate_copies_legacy_dir_without_deleting_source() {
        let base = std::env::temp_dir().join(format!(
            "echomind_migrate_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let legacy = base.join("legacy");
        let new_dir = base.join("new");
        fs::create_dir_all(legacy.join("recordings")).unwrap();
        fs::write(legacy.join("meetings_history.json"), b"hello").unwrap();
        fs::write(legacy.join("recordings").join("a.flac"), b"audio").unwrap();

        copy_dir_recursive(&legacy, &new_dir).unwrap();

        assert!(
            legacy.join("meetings_history.json").exists(),
            "source must survive a copy-based migration"
        );
        assert_eq!(
            fs::read(new_dir.join("meetings_history.json")).unwrap(),
            b"hello"
        );
        assert_eq!(
            fs::read(new_dir.join("recordings").join("a.flac")).unwrap(),
            b"audio"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_migrate_is_noop_when_new_dir_already_exists() {
        let base = std::env::temp_dir().join(format!(
            "echomind_migrate_noop_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let new_dir = base.join("new");
        fs::create_dir_all(&new_dir).unwrap();
        fs::write(new_dir.join("marker.txt"), b"already here").unwrap();

        // A nonexistent legacy candidate must never be treated as a signal to wipe
        // an already-initialized new_dir.
        migrate_legacy_dir_if_present(&new_dir, vec![base.join("nonexistent-legacy")]);
        assert_eq!(
            fs::read(new_dir.join("marker.txt")).unwrap(),
            b"already here"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_storage_add_and_delete() {
        let storage = StorageEngine::new();
        let sample_meeting = MeetingRecord {
            id: "test_123".to_string(),
            title: "Test Toplantısı".to_string(),
            date_formatted: "21 Ağustos 2026".to_string(),
            duration_seconds: 120,
            duration_formatted: "02:00".to_string(),
            audio_file_path: None,
            segments: Vec::new(),
            summary: "Test Özet".to_string(),
            key_decisions: vec!["Karar 1".to_string()],
            meeting_goal: Some("Test Amacı".to_string()),
            key_highlights: Some(vec!["Ders 1".to_string()]),
            action_items: Some(vec![ActionItem {
                task: "Görev 1".to_string(),
                assignee: Some("Sercan".to_string()),
                source_citations: vec![1],
                is_completed: false,
            }]),
            phase1_agreed: Some(vec!["Faz 1".to_string()]),
            phase2_deferred: Some(vec!["Faz 2".to_string()]),
            detailed_topics: Some(vec![TopicBreakdown {
                topic_title: "Konu 1".to_string(),
                bullet_points: vec!["Madde 1".to_string()],
            }]),
            participants: Some(vec!["Sercan".to_string()]),
            engine_used: Some("Cihazda (Whisper Small)".to_string()),
            summary_provider: Some("EchoMind".to_string()),
            tags: Some(vec!["Finans & Bütçe".to_string()]),
        };

        let added = storage.add_meeting(sample_meeting).unwrap();
        assert_eq!(added.id, "test_123");

        let remaining = storage.delete_meeting("test_123").unwrap();
        assert!(!remaining.iter().any(|m| m.id == "test_123"));
    }

    #[test]
    fn test_flac_lossless_compression() {
        let sample_dir = std::env::temp_dir().join("echomind_test_rec");
        let _ = fs::create_dir_all(&sample_dir);
        let test_flac_path = sample_dir.join("test_audio.flac");

        // Generate 1 second of 440Hz sine wave PCM samples
        let mut samples = Vec::new();
        for i in 0..16000 {
            let t = i as f32 / 16000.0;
            let sample = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.5;
            samples.push(sample);
        }

        let res = compress_audio_to_flac(&samples, &test_flac_path);
        assert!(res.is_ok());
        assert!(test_flac_path.exists());

        let metadata = fs::metadata(&test_flac_path).unwrap();
        assert!(metadata.len() > 0);
        let _ = fs::remove_dir_all(&sample_dir);
    }

    #[test]
    fn test_load_from_disk_backs_up_undecryptable_file_instead_of_losing_it() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!("echomind_test_corrupt_{}.json", std::process::id()));

        // Bytes that look like the current AEAD format but are not valid ciphertext
        // for this installation's key — e.g. a file from a different machine/user.
        let mut fake_ciphertext = b"ECHOMIND_ENC_V2\0".to_vec();
        fake_ciphertext.extend_from_slice(&[0u8; 12]); // nonce
        fake_ciphertext.extend_from_slice(b"not a real ciphertext, will fail auth");
        fs::write(&file_path, &fake_ciphertext).unwrap();

        let engine = StorageEngine {
            file_path: file_path.clone(),
            meetings: Arc::new(Mutex::new(Vec::new())),
        };

        let result = engine.load_from_disk().unwrap();
        assert!(result.is_empty());

        // The original undecryptable bytes must still exist somewhere on disk.
        let parent = file_path.parent().unwrap();
        let stem = file_path.file_stem().unwrap().to_string_lossy();
        let backup_found = fs::read_dir(parent)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.starts_with(&format!("{}.json.corrupt-", stem))
                    && fs::read(e.path())
                        .map(|b| b == fake_ciphertext)
                        .unwrap_or(false)
            });
        assert!(
            backup_found,
            "undecryptable file must be backed up, never silently discarded"
        );

        // Cleanup
        let _ = fs::remove_file(&file_path);
        if let Ok(entries) = fs::read_dir(parent) {
            for e in entries.filter_map(|e| e.ok()) {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with(&format!("{}.json.corrupt-", stem)) {
                    let _ = fs::remove_file(e.path());
                }
            }
        }
    }

    #[test]
    fn test_storage_update_title_and_extraction() {
        let storage = StorageEngine::new();
        let sample_meeting = MeetingRecord {
            id: "mtg_edit_test".to_string(),
            title: "Eski Başlık".to_string(),
            date_formatted: "01.09.2026".to_string(),
            duration_seconds: 60,
            duration_formatted: "01:00".to_string(),
            audio_file_path: None,
            segments: vec![TranscriptSegment {
                id: 1,
                speaker_id: "spk1".to_string(),
                speaker_name: "Konuşmacı 1".to_string(),
                start_time_ms: 0,
                end_time_ms: 2000,
                timestamp_formatted: "00:00 -> 00:02".to_string(),
                text: "Depo yatırımı için karar aldık ve onay verdik.".to_string(),
                language: "tr".to_string(),
                confidence: 0.99,
            }],
            summary: "Özet".to_string(),
            key_decisions: vec!["Karar A".to_string()],
            meeting_goal: Some("Hedef".to_string()),
            key_highlights: None,
            action_items: Some(vec![ActionItem {
                task: "Görev A".to_string(),
                assignee: Some("Ahmet".to_string()),
                source_citations: vec![1],
                is_completed: false,
            }]),
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: Some(vec!["Konuşmacı 1".to_string()]),
            engine_used: Some("Whisper".to_string()),
            summary_provider: Some("AI".to_string()),
            tags: None,
        };

        // 1. Add meeting & get by id
        storage.add_meeting(sample_meeting.clone()).unwrap();
        let all = storage.get_all();
        let fetched = all.iter().find(|m| m.id == "mtg_edit_test").unwrap();
        assert_eq!(fetched.title, "Eski Başlık");

        // 2. Update Title
        let updated_list = storage
            .update_title("mtg_edit_test", "Yeni İcra Başlığı")
            .unwrap();
        let found = updated_list
            .iter()
            .find(|m| m.id == "mtg_edit_test")
            .unwrap();
        assert_eq!(found.title, "Yeni İcra Başlığı");

        // 3. Summary & Decision Extraction Helpers
        let summary_text = generate_summary_from_segments(&sample_meeting.segments);
        assert!(summary_text.contains("1 konuşmacı"));

        let decisions = extract_key_decisions(&sample_meeting.segments);
        assert!(!decisions.is_empty());
        assert!(decisions[0].contains("karar"));

        // 4. Empty segments edge case
        let empty_summary = generate_summary_from_segments(&[]);
        assert!(empty_summary.contains("bulunmamaktadır"));

        let empty_decisions = extract_key_decisions(&[]);
        assert!(empty_decisions.is_empty());

        // 5. Clean up
        let _ = storage.delete_meeting("mtg_edit_test");
    }

    /// Global audio/storage singletons are shared across tests — serialize the
    /// save-path cases so inject/claim sequences cannot interleave.
    fn global_save_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn test_save_current_meeting_is_idempotent_per_session() {
        let _guard = global_save_test_lock().lock().unwrap();

        // Short PCM (< 1s) so the fallback Whisper path is skipped.
        let samples: Vec<f32> = (0..4000).map(|i| ((i % 40) as f32) * 0.002).collect();
        let engine = crate::audio::get_global_audio_engine();
        let session_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;
        engine.inject_pcm_for_test(samples, session_id);

        let (first, pending) = save_current_meeting_blocking("Idempotent Test".into(), 3)
            .expect("first save must succeed");
        assert_eq!(first.title, "Idempotent Test");
        assert!(
            first.audio_file_path.is_some(),
            "first save must write a FLAC"
        );
        // Short PCM (< 1s) → no detached Whisper pending
        assert!(pending.is_none(), "sub-second PCM must not queue Whisper");
        let flac_path = first.audio_file_path.clone().unwrap();
        assert!(
            PathBuf::from(&flac_path).exists(),
            "FLAC file missing: {}",
            flac_path
        );

        let (second, pending2) = save_current_meeting_blocking("Should Be Ignored".into(), 99)
            .expect("duplicate save must return cached meeting");
        assert!(pending2.is_none());
        assert_eq!(
            second.id, first.id,
            "duplicate save must not create a new meeting id"
        );
        assert_eq!(second.title, first.title);
        assert_eq!(
            second.audio_file_path, first.audio_file_path,
            "duplicate save must not write another FLAC path"
        );
        assert!(
            engine.get_pcm_buffer().is_empty(),
            "PCM buffer must stay empty after claim"
        );

        // Stale PCM left in the buffer after a save must not create another
        // meeting while session_saved remains true.
        {
            let mut state = engine.state.lock().unwrap();
            state.pcm_16k_buffer = vec![0.9; 500];
        }
        let (third, _) = save_current_meeting_blocking("Twice".into(), 1).unwrap();
        assert_eq!(third.id, first.id);
        assert_eq!(third.title, first.title);

        let _ = get_global_storage().delete_meeting(&first.id);
        let _ = fs::remove_file(&flac_path);
    }

    #[test]
    fn test_save_defers_whisper_pcm_when_segments_empty() {
        let _guard = global_save_test_lock().lock().unwrap();
        // >= 1s of audio so the detached Whisper path would be scheduled.
        let samples: Vec<f32> = (0..16000).map(|i| ((i % 40) as f32) * 0.002).collect();
        let engine = crate::audio::get_global_audio_engine();
        let session_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;
        engine.inject_pcm_for_test(samples.clone(), session_id);

        let (saved, pending) = save_current_meeting_blocking("Defer Whisper".into(), 1).unwrap();
        assert!(saved.segments.is_empty());
        let pending = pending.expect("PCM must be returned for detached Whisper");
        assert_eq!(pending.len(), samples.len());
        // Invoke path returns immediately; Whisper is not run inside blocking save.
        assert!(saved.audio_file_path.is_some());

        let _ = get_global_storage().delete_meeting(&saved.id);
        if let Some(path) = saved.audio_file_path {
            let _ = fs::remove_file(path);
        }
    }
}
