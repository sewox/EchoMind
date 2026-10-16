//! Diagnostics log and report.
//!
//! Everything the app prints (`println!`, `eprintln!`, panics, whisper.cpp and
//! ggml) goes to `<app dir>/logs/echomind.log`, one timestamped line each. A
//! Windows release build has no console, so without this every line was lost.
//! The report (Settings > System) bundles the system, the GPUs, the settings
//! that matter and the log into one text file a tester can send. It holds no
//! recording, transcript text or API key.

use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

const LOG_FILE: &str = "echomind.log";
const OLD_LOG_FILE: &str = "echomind.1.log";
/// The current log moves to `echomind.1.log` past this size.
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
/// How much log the report carries (the newest part).
const REPORT_LOG_BYTES: u64 = 3 * 1024 * 1024;
/// Main-thread stalls at least this long are logged.
const UI_STALL: Duration = Duration::from_secs(2);

struct Sink {
    file: File,
    written: u64,
}

static SINK: Mutex<Option<Sink>> = Mutex::new(None);

pub fn log_dir() -> PathBuf {
    crate::storage::get_storage_dir().with_file_name("logs")
}

/// Version, plus the test tag and commit on CI builds.
pub fn build_label() -> String {
    let mut label = env!("CARGO_PKG_VERSION").to_string();
    if let Some(tag) = option_env!("ECHOMIND_BUILD_LABEL").filter(|t| !t.is_empty()) {
        label.push_str(&format!(" / {tag}"));
    }
    if let Some(sha) = option_env!("GITHUB_SHA") {
        label.push_str(&format!(" ({})", &sha[..sha.len().min(7)]));
    }
    label
}

/// Starts the log. Call once, first thing in `run()`.
pub fn init() {
    let dir = log_dir();
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(LOG_FILE);
    if fs::metadata(&path).is_ok_and(|m| m.len() > MAX_LOG_BYTES) {
        let _ = fs::rename(&path, dir.join(OLD_LOG_FILE));
    }
    let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) else {
        return;
    };
    let written = file.metadata().map_or(0, |m| m.len());
    *SINK.lock().unwrap_or_else(|e| e.into_inner()) = Some(Sink { file, written });

    write_line("");
    write_line(&format!(
        "===== EchoMind {} başladı ({} {}) =====",
        build_label(),
        std::env::consts::OS,
        std::env::consts::ARCH
    ));

    match redirect_stdio() {
        Ok(Some((pipe, tee))) => {
            let _ = std::thread::Builder::new()
                .name("diag-log".into())
                .spawn(move || pump(pipe, tee));
        }
        Ok(None) => {}
        Err(e) => write_line(&format!("⚠️ Uygulama çıktısı loga yönlendirilemedi: {e}")),
    }
    install_ggml_log();
}

fn write_line(line: &str) {
    let mut guard = SINK.lock().unwrap_or_else(|e| e.into_inner());
    let Some(sink) = guard.as_mut() else {
        return;
    };
    let stamped = format!(
        "[{}] {line}\n",
        chrono::Local::now().format("%m-%d %H:%M:%S%.3f")
    );
    if sink.file.write_all(stamped.as_bytes()).is_err() {
        return;
    }
    sink.written += stamped.len() as u64;
    if sink.written > MAX_LOG_BYTES {
        let dir = log_dir();
        let _ = fs::rename(dir.join(LOG_FILE), dir.join(OLD_LOG_FILE));
        if let Ok(file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(LOG_FILE))
        {
            *sink = Sink { file, written: 0 };
        }
    }
}

/// Copies what the app prints into the log, line by line, and on to the
/// terminal it would have gone to.
fn pump(pipe: File, mut tee: Option<File>) {
    let mut reader = BufReader::new(pipe);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if let Some(t) = tee.as_mut() {
            let _ = t.write_all(&buf);
        }
        let line = String::from_utf8_lossy(&buf);
        write_line(line.trim_end_matches(['\r', '\n']));
    }
}

/// Points stdout and stderr (fds 1 and 2, so C libraries too) at a pipe.
/// Returns the pipe's read end and the original stderr to copy lines to.
#[cfg(unix)]
fn redirect_stdio() -> std::io::Result<Option<(File, Option<File>)>> {
    use std::os::fd::FromRawFd;
    let mut fds = [0 as libc::c_int; 2];
    // SAFETY: plain fd calls on fds this function owns.
    unsafe {
        if libc::pipe(fds.as_mut_ptr()) != 0 {
            return Err(std::io::Error::last_os_error());
        }
        let tee = libc::dup(2);
        libc::fcntl(fds[0], libc::F_SETFD, libc::FD_CLOEXEC);
        if tee >= 0 {
            libc::fcntl(tee, libc::F_SETFD, libc::FD_CLOEXEC);
        }
        libc::dup2(fds[1], 1);
        libc::dup2(fds[1], 2);
        libc::close(fds[1]);
        let tee = (tee >= 0).then(|| File::from_raw_fd(tee));
        Ok(Some((File::from_raw_fd(fds[0]), tee)))
    }
}

/// Windows: unless the output goes to a console (a terminal run keeps its
/// output). Rust's stdout/stderr look the handles up on every write; C code
/// logs through `install_ggml_log` instead of the CRT's stderr.
#[cfg(windows)]
fn redirect_stdio() -> std::io::Result<Option<(File, Option<File>)>> {
    use std::os::windows::io::FromRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Console::{
        GetConsoleMode, GetStdHandle, SetStdHandle, CONSOLE_MODE, STD_ERROR_HANDLE,
        STD_OUTPUT_HANDLE,
    };
    use windows::Win32::System::Pipes::CreatePipe;

    // SAFETY: Win32 calls on handles this function creates or only queries.
    unsafe {
        let mut mode = CONSOLE_MODE::default();
        let console = GetStdHandle(STD_ERROR_HANDLE).is_ok_and(|h| {
            !h.is_invalid() && !h.0.is_null() && GetConsoleMode(h, &mut mode).is_ok()
        });
        if console {
            return Ok(None);
        }
        let (mut read, mut write) = (HANDLE::default(), HANDLE::default());
        CreatePipe(&mut read, &mut write, None, 0)?;
        SetStdHandle(STD_OUTPUT_HANDLE, write)?;
        SetStdHandle(STD_ERROR_HANDLE, write)?;
        Ok(Some((File::from_raw_handle(read.0), None)))
    }
}

#[cfg(not(any(unix, windows)))]
fn redirect_stdio() -> std::io::Result<Option<(File, Option<File>)>> {
    Ok(None)
}

/// whisper.cpp and ggml (shared with llama.cpp) log through this, so their
/// lines (model load, which GPU backend, out of memory) reach the log.
fn install_ggml_log() {
    // SAFETY: the callback never unwinds and ignores its user data.
    unsafe {
        whisper_rs::set_log_callback(Some(ggml_log), std::ptr::null_mut());
    }
}

const GGML_DEBUG: u32 = 1;
const GGML_INFO: u32 = 2;
const GGML_CONT: u32 = 5;
/// Level of the last message, for its continuation pieces.
static GGML_LAST_LEVEL: AtomicU32 = AtomicU32::new(GGML_INFO);
/// Info lines already written. Whisper repeats the same buffer sizes for every
/// live slice; once is enough.
static GGML_SEEN: Mutex<Option<HashSet<String>>> = Mutex::new(None);

unsafe extern "C" fn ggml_log(
    level: whisper_rs::whisper_rs_sys::ggml_log_level,
    text: *const std::ffi::c_char,
    _user_data: *mut std::ffi::c_void,
) {
    if text.is_null() {
        return;
    }
    // SAFETY: ggml passes a NUL-terminated string.
    let bytes = unsafe { std::ffi::CStr::from_ptr(text) }.to_bytes();
    // c_uint here, c_int on MSVC.
    #[allow(clippy::unnecessary_cast)]
    let level = level as u32;
    let level = if level == GGML_CONT {
        GGML_LAST_LEVEL.load(Ordering::Relaxed)
    } else {
        let level = if level == GGML_INFO && !first_time(bytes) {
            0
        } else {
            level
        };
        GGML_LAST_LEVEL.store(level, Ordering::Relaxed);
        level
    };
    if level <= GGML_DEBUG {
        return;
    }
    let _ = std::io::stderr().write_all(bytes);
}

fn first_time(message: &[u8]) -> bool {
    let mut seen = GGML_SEEN.lock().unwrap_or_else(|e| e.into_inner());
    let seen = seen.get_or_insert_with(HashSet::new);
    if seen.len() > 5000 {
        seen.clear();
    }
    seen.insert(String::from_utf8_lossy(message).into_owned())
}

/// Logs every time the window's thread stops answering for `UI_STALL` or
/// more: that is a "not responding" window.
pub fn watch_main_thread(app: tauri::AppHandle) {
    let _ = std::thread::Builder::new()
        .name("ui-watchdog".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(2));
            let (tx, rx) = mpsc::channel();
            let sent = Instant::now();
            if app
                .run_on_main_thread(move || {
                    let _ = tx.send(());
                })
                .is_err()
            {
                return;
            }
            if rx.recv_timeout(UI_STALL).is_ok() {
                continue;
            }
            let busy = crate::transcriber::get_global_transcriber().is_inference_active();
            let answered = rx.recv_timeout(Duration::from_secs(300)).is_ok();
            eprintln!(
                "⚠️ Arayüz {:.1} sn yanıt vermedi{} (Whisper {})",
                sent.elapsed().as_secs_f32(),
                if answered { "" } else { ", hâlâ yanıt yok" },
                if busy {
                    "çalışıyordu"
                } else {
                    "boştaydı"
                }
            );
        });
}

/// Logs the system and the GPUs once at startup.
pub fn log_system_once() {
    let _ = std::thread::Builder::new()
        .name("diag-system".into())
        .spawn(|| {
            // On macOS, listing ggml's devices compiles the Metal library;
            // leave that to the first transcription (the report lists them).
            for line in system_lines(!cfg!(target_os = "macos")) {
                eprintln!("ℹ️ {line}");
            }
        });
}

fn system_lines(with_ggml_devices: bool) -> Vec<String> {
    let hw = crate::hardware::HardwareInfo::detect();
    let mut lines = vec![
        format!(
            "Sistem: {} {} ({}), {}",
            hw.os_type,
            hw.os_version,
            sysinfo::System::kernel_version().unwrap_or_default(),
            hw.cpu_arch
        ),
        format!(
            "İşlemci: {}, {} fiziksel / {} mantıksal çekirdek, AVX2: {}",
            hw.cpu_brand,
            hw.physical_cores,
            hw.logical_cores,
            if hw.has_avx2 { "var" } else { "yok" }
        ),
        format!("Bellek: {:.1} GB", hw.total_ram_gb),
    ];
    for adapter in crate::hardware::display_adapters() {
        lines.push(format!("Ekran kartı: {adapter}"));
    }
    if let Some(smi) = crate::hardware::nvidia_smi() {
        for row in smi.lines().filter(|l| !l.trim().is_empty()) {
            lines.push(format!("nvidia-smi: {}", row.trim()));
        }
    }
    let devices = if with_ggml_devices {
        llama_cpp_2::list_llama_ggml_backend_devices()
    } else {
        Vec::new()
    };
    for d in devices {
        lines.push(format!(
            "ggml cihazı {}: {} | {} | {:?} | {} MB ({} MB boş)",
            d.index,
            d.backend,
            d.description,
            d.device_type,
            d.memory_total / (1024 * 1024),
            d.memory_free / (1024 * 1024)
        ));
    }
    if with_ggml_devices {
        lines.push(format!(
            "Whisper cihazı: {}",
            crate::transcriber::whisper_device_label()
        ));
    }
    lines.push(format!(
        "Whisper iş parçacığı: {}",
        crate::transcriber::whisper_thread_count(
            std::thread::available_parallelism().map_or(8, |n| n.get())
        )
    ));
    lines
}

/// Writes a JS error from the window into the log.
#[tauri::command]
pub fn log_frontend_error(message: String) {
    let message: String = message.chars().take(1000).collect();
    eprintln!("🌐 Arayüz hatası: {message}");
}

/// Writes the report into Downloads, shows it in the file manager and
/// returns its path.
#[tauri::command]
pub async fn create_diagnostic_report(
    app: tauri::AppHandle,
    live_transcription: Option<bool>,
) -> Result<String, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .download_dir()
        .ok()
        .filter(|d| d.is_dir())
        .unwrap_or_else(log_dir);
    tauri::async_runtime::spawn_blocking(move || {
        let text = report_text(live_transcription);
        let name = format!(
            "EchoMind-tani-raporu-{}.txt",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        );
        let path = dir.join(name);
        fs::write(&path, text).map_err(|e| format!("Rapor yazılamadı: {e}"))?;
        eprintln!("📝 Tanılama raporu oluşturuldu: {}", path.display());
        reveal(&path);
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("Rapor oluşturulamadı: {e}"))?
}

fn report_text(live_transcription: Option<bool>) -> String {
    let mut out = String::new();
    let mut section = |title: &str, lines: Vec<String>| {
        out.push_str(&format!("\n== {title} ==\n"));
        for line in lines {
            out.push_str(&line);
            out.push('\n');
        }
    };
    section(
        "EchoMind tanılama raporu",
        vec![
            format!(
                "Oluşturulma: {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S %:z")
            ),
            format!("Sürüm: {}", build_label()),
            "Bu rapor ses kaydı, döküm metni veya API anahtarı içermez.".to_string(),
        ],
    );
    section("Sistem ve ekran kartları", system_lines(true));

    let model = crate::transcriber::get_model_status();
    let downloaded: Vec<String> = crate::transcriber::get_available_models()
        .into_iter()
        .filter(|m| m.is_downloaded)
        .map(|m| m.key)
        .collect();
    let cloud = crate::cloud_recording::get_cloud_recording();
    section(
        "Konuşma tanıma",
        vec![
            format!(
                "Model: {} (yüklü: {}, yedek model: {})",
                model.model_name, model.is_loaded, model.used_fallback_model
            ),
            format!("İndirilmiş modeller: {}", downloaded.join(", ")),
            format!("Motor: {}", crate::asr_engine::get_asr_engine().engine),
            format!(
                "Canlı yazıya dökme: {}",
                match live_transcription {
                    Some(true) => "açık",
                    Some(false) => "kapalı",
                    None => "bilinmiyor",
                }
            ),
            format!(
                "Bulutta yazıya dökme: {} (sağlayıcı: {}, anahtar: {}, izinli: {})",
                cloud.enabled,
                cloud.provider.as_deref().unwrap_or("-"),
                if cloud.has_key { "var" } else { "yok" },
                cloud.allowed
            ),
            format!(
                "Sistem sesi: {} (destek: {})",
                crate::audio::get_system_audio_enabled(),
                crate::audio::get_system_audio_support()
            ),
        ],
    );

    let detector = crate::detector::get_detector_status();
    section(
        "Toplantı algılama",
        vec![
            format!(
                "Açık: {}, son kontrol: {}, şu an algılanan: {}",
                detector.is_active,
                detector.last_check_timestamp,
                detector
                    .detected_apps
                    .iter()
                    .map(|a| format!("{} ({})", a.display_name, a.process_name))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            format!(
                "Ayarlar: {}",
                serde_json::to_string(&detector.settings).unwrap_or_default()
            ),
        ],
    );

    let jobs = crate::transcription_queue::list_jobs();
    let mut job_lines = vec![format!("{} iş", jobs.len())];
    for job in jobs.iter().rev().take(15) {
        job_lines.push(format!(
            "{:?}, deneme {}/{}, {}{}",
            job.state,
            job.attempts,
            job.max_attempts,
            chrono::DateTime::from_timestamp_millis(job.updated_at_ms as i64)
                .map(|t| t
                    .with_timezone(&chrono::Local)
                    .format("%m-%d %H:%M")
                    .to_string())
                .unwrap_or_default(),
            job.last_error
                .as_deref()
                .map(|e| format!(", hata: {e}"))
                .unwrap_or_default()
        ));
    }
    section("Yazıya dökme kuyruğu (son 15)", job_lines);

    section(
        &format!("Log (son {} MB)", REPORT_LOG_BYTES / (1024 * 1024)),
        vec![log_tail(&log_dir(), REPORT_LOG_BYTES)],
    );
    out
}

/// The newest `max` bytes of the log, across the rotated file and the
/// current one, starting at a line.
fn log_tail(dir: &Path, max: u64) -> String {
    let mut remaining = max;
    let mut parts = Vec::new();
    for name in [LOG_FILE, OLD_LOG_FILE] {
        if remaining == 0 {
            break;
        }
        let Ok(mut file) = File::open(dir.join(name)) else {
            continue;
        };
        let len = file.metadata().map_or(0, |m| m.len());
        let start = len.saturating_sub(remaining);
        // From the byte before `start`: if it ends a line, the line at
        // `start` is whole and stays.
        let from = start.saturating_sub(1);
        let mut bytes = Vec::new();
        if file.seek(SeekFrom::Start(from)).is_err() || file.read_to_end(&mut bytes).is_err() {
            continue;
        }
        remaining = remaining.saturating_sub(len - start);
        let mut text = String::from_utf8_lossy(&bytes).into_owned();
        if start > 0 {
            text = text
                .split_once('\n')
                .map_or(String::new(), |(_, rest)| rest.to_string());
        }
        parts.push(text);
    }
    if parts.is_empty() {
        return "(log yok)".to_string();
    }
    parts.reverse();
    parts.concat()
}

fn reveal(path: &Path) {
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", path.display()))
        .spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn();
    #[cfg(target_os = "linux")]
    if let Some(dir) = path.parent() {
        let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_tail_takes_the_newest_lines_across_both_files() {
        let dir = std::env::temp_dir().join(format!("echomind_diag_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(OLD_LOG_FILE), "old 1\nold 2\n").unwrap();
        fs::write(dir.join(LOG_FILE), "new 1\nnew 2\n").unwrap();

        assert_eq!(log_tail(&dir, 1000), "old 1\nold 2\nnew 1\nnew 2\n");
        // 15 bytes: all of the current file (12) and the end of the old one,
        // cut back to a whole line.
        assert_eq!(log_tail(&dir, 15), "new 1\nnew 2\n");
        assert_eq!(log_tail(&dir, 18), "old 2\nnew 1\nnew 2\n");
        fs::remove_dir_all(&dir).unwrap();
        assert_eq!(log_tail(&dir, 1000), "(log yok)");
    }

    #[test]
    fn report_has_every_section() {
        let report = report_text(Some(false));
        for heading in [
            "== EchoMind tanılama raporu ==",
            "== Sistem ve ekran kartları ==",
            "Whisper cihazı: ",
            "== Konuşma tanıma ==",
            "Canlı yazıya dökme: kapalı",
            "== Toplantı algılama ==",
            "== Yazıya dökme kuyruğu (son 15) ==",
            "== Log (son 3 MB) ==",
        ] {
            assert!(report.contains(heading), "{heading} missing:\n{report}");
        }
    }

    #[test]
    fn repeated_ggml_info_is_written_once() {
        assert!(first_time(b"whisper_init_state: kv self size = 1.23 MB\n"));
        assert!(!first_time(b"whisper_init_state: kv self size = 1.23 MB\n"));
        assert!(first_time(b"whisper_init_state: kv self size = 4.56 MB\n"));
    }
}
