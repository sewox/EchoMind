use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioStatus {
    pub is_recording: bool,
    pub mic_level: f32,    // 0.0 - 1.0 (VU Meter)
    pub sys_level: f32,    // 0.0 - 1.0 (VU Meter)
    pub is_speaking: bool, // VAD Voice Activity Detection with Hangover
    pub sample_rate: u32,  // Standard 16000 Hz for Whisper
    pub channels: u16,     // 1 (Mono)
    pub buffered_samples: usize,
    pub is_loopback: bool, // Whether active device captures loopback/system audio
    pub has_loopback_device: bool, // Whether any loopback device is available on the machine
    pub active_device_name: Option<String>,
}

pub struct AudioState {
    pub is_recording: bool,
    pub mic_level: f32,
    pub sys_level: f32,
    pub is_speaking: bool,
    pub silence_counter: u32,
    pub pcm_16k_buffer: Vec<f32>,
    // High-pass filter state variables
    pub hp_prev_in: f32,
    pub hp_prev_out: f32,
    /// Monotonic id bumped on every `start()` so a recording session can be
    /// saved at most once even when multiple stop signals race.
    pub recording_session_id: u64,
    /// Set when the current session's PCM has already been claimed for save.
    pub session_saved: bool,
}

impl Default for AudioState {
    fn default() -> Self {
        AudioState {
            is_recording: false,
            mic_level: 0.0,
            sys_level: 0.0,
            is_speaking: false,
            silence_counter: 999,
            pcm_16k_buffer: Vec::new(),
            hp_prev_in: 0.0,
            hp_prev_out: 0.0,
            recording_session_id: 0,
            session_saved: false,
        }
    }
}

pub type SharedAudioState = Arc<Mutex<AudioState>>;

pub struct GlobalAudioEngine {
    pub state: SharedAudioState,
    pub stop_tx: Mutex<Option<Sender<()>>>,
    pub preview_tx: Mutex<Option<Sender<()>>>,
    pub active_device_name: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
    pub is_loopback: bool,
    pub max_channels: u16,
    pub default_sample_rate: u32,
}

impl Default for GlobalAudioEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Result of atomically claiming a recording session's PCM for persistence.
#[derive(Debug)]
pub enum PcmClaim {
    /// First claim with audio worth persisting.
    Claimed { session_id: u64, pcm: Vec<f32> },
    /// First claim but buffer empty / too short — session marked saved so
    /// nothing retries; caller must not create a meeting or FLAC.
    NothingToSave { session_id: u64 },
    /// A prior claim already took this session (idempotent).
    AlreadySaved { session_id: u64 },
}

/// Minimum PCM samples (~0.25s at 16 kHz) required to persist a meeting.
pub const MIN_SAVE_PCM_SAMPLES: usize = 4000;

/// Pure name-based loopback heuristic. Safe to call on any thread — never
/// touches CoreAudio / cpal. Used by `get_status` for the active device so
/// loopback detection does not need a fresh device enumeration.
pub fn device_name_is_loopback(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("blackhole")
        || lower.contains("loopback")
        || lower.contains("soundflower")
        || lower.contains("aggregate")
        || lower.contains("multi-output")
        || lower.contains("birleşik")
        || lower.contains("stereo mix")
        || lower.contains("stereomix")
        || lower.contains("what u hear")
        || lower.contains("vb-audio")
        || lower.contains("cable output")
        || lower.contains("voicemeeter")
        || lower.contains("virtual-audio")
        || lower.contains("monitor of")
        || lower.contains("pipewire")
        || lower.contains("pulseaudio")
}

/// Background-owned device catalog.
///
/// v0.2.12 live QA reproduced a P0 macOS hang: after Meet closed while
/// recording, stream teardown (`AudioDeviceDestroyIOProcID` / `StopIOProc`)
/// contended on CoreAudio's HAL mutex with a concurrent `get_status` →
/// `list_devices` enumeration on the Tauri/UI path (AX/menu freeze; kill -9).
/// PR #52's 5s TTL cache reduced how often enumeration ran, but when the TTL
/// expired the real `list_devices()` still ran synchronously on the status
/// caller — and could still coincide with teardown.
///
/// This catalog is the fix: a dedicated worker owns every `list_devices()`
/// call for the status / device-picker paths and publishes an immutable
/// snapshot. Hot paths only clone that snapshot under a short `RwLock` read
/// — they never call into CoreAudio, and they never share a lock that is
/// held across a CoreAudio call with stream start/stop.
struct DeviceCatalog {
    snapshot: RwLock<Vec<AudioDeviceInfo>>,
    request_tx: Mutex<Sender<()>>,
}

type EnumerateFn = Arc<dyn Fn() -> Vec<AudioDeviceInfo> + Send + Sync + 'static>;

impl DeviceCatalog {
    fn spawn(enumerate: EnumerateFn) -> Arc<Self> {
        let (tx, rx) = channel::<()>();
        let catalog = Arc::new(Self {
            snapshot: RwLock::new(Vec::new()),
            request_tx: Mutex::new(tx),
        });
        let worker_catalog = Arc::clone(&catalog);
        thread::Builder::new()
            .name("echomind-device-catalog".into())
            .spawn(move || device_catalog_worker(worker_catalog, rx, enumerate))
            .expect("failed to spawn device catalog worker");
        catalog
    }

    fn snapshot(&self) -> Vec<AudioDeviceInfo> {
        self.snapshot.read().unwrap().clone()
    }

    fn publish(&self, devices: Vec<AudioDeviceInfo>) {
        *self.snapshot.write().unwrap() = devices;
    }

    fn request_refresh(&self) {
        // Ignore send errors (worker gone) — snapshot reads still work.
        let _ = self.request_tx.lock().unwrap().send(());
    }
}

/// Idle poll fallback when no device-change notification arrives.
/// macOS primarily refreshes via `AudioObjectAddPropertyListener`; this is
/// the safety net. Windows/Linux rely on this poll + Settings force-refresh.
#[cfg(not(test))]
const DEVICE_CATALOG_PERIOD: Duration = Duration::from_secs(15);
/// Long period in unit tests so the global worker's timer does not spuriously
/// fire mid-assertion while `TEST_ENUMERATE` is installed.
#[cfg(test)]
const DEVICE_CATALOG_PERIOD: Duration = Duration::from_secs(3600);

/// How long to keep the catalog worker away from CoreAudio after `stop()`
/// signals stream teardown, so `list_devices` cannot overlap
/// `AudioDeviceDestroyIOProcID` / `StopIOProc`.
#[cfg(not(test))]
const POST_STOP_ENUM_DEBOUNCE: Duration = Duration::from_millis(350);
#[cfg(test)]
const POST_STOP_ENUM_DEBOUNCE: Duration = Duration::from_millis(0);

/// True while a capture/preview stream is being built, running, or tearing
/// down. The catalog worker must not call into CoreAudio during this window.
static STREAM_HAL_BUSY: AtomicBool = AtomicBool::new(false);

/// Earliest Instant at which the catalog worker may enumerate again (post-stop
/// debounce). `None` / past = allowed.
static ENUM_QUIET_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

fn mark_stream_hal_busy(busy: bool) {
    STREAM_HAL_BUSY.store(busy, Ordering::SeqCst);
}

fn schedule_post_stop_catalog_refresh() {
    mark_stream_hal_busy(false);
    {
        let mut quiet = ENUM_QUIET_UNTIL.lock().unwrap();
        *quiet = Some(Instant::now() + POST_STOP_ENUM_DEBOUNCE);
    }
    let delay = POST_STOP_ENUM_DEBOUNCE;
    thread::Builder::new()
        .name("echomind-device-catalog-debounce".into())
        .spawn(move || {
            if !delay.is_zero() {
                thread::sleep(delay);
            }
            device_catalog().request_refresh();
        })
        .ok();
}

fn catalog_may_enumerate() -> bool {
    if STREAM_HAL_BUSY.load(Ordering::SeqCst) {
        return false;
    }
    let quiet = ENUM_QUIET_UNTIL.lock().unwrap();
    match *quiet {
        Some(until) => Instant::now() >= until,
        None => true,
    }
}

fn device_catalog_worker(
    catalog: Arc<DeviceCatalog>,
    rx: Receiver<()>,
    enumerate: EnumerateFn,
) {
    // Initial scan — may block on CoreAudio here; that is intentional and
    // confined to this worker. Callers only ever read `snapshot`.
    catalog.publish(enumerate());

    #[cfg(target_os = "macos")]
    macos_device_listener::install(catalog.request_tx.lock().unwrap().clone());

    loop {
        match rx.recv_timeout(DEVICE_CATALOG_PERIOD) {
            Ok(()) | Err(RecvTimeoutError::Timeout) => {
                // Coalesce a burst of refresh requests into one enumeration.
                while rx.try_recv().is_ok() {}
                // Never enumerate while a stream is live / tearing down, and
                // honour the post-stop debounce window.
                if !catalog_may_enumerate() {
                    continue;
                }
                // Enumerate with NO catalog locks held, then publish.
                let devices = enumerate();
                // Re-check: a start() may have begun while we were in HAL.
                if STREAM_HAL_BUSY.load(Ordering::SeqCst) {
                    continue;
                }
                catalog.publish(devices);
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// Test-only override for the real cpal enumeration. Production always uses
/// `GlobalAudioEngine::list_devices`. Tests install a slow/counting stub so
/// Linux CI can prove status never waits on enumeration.
#[cfg(test)]
static TEST_ENUMERATE: Mutex<Option<EnumerateFn>> = Mutex::new(None);

fn catalog_enumerate() -> Vec<AudioDeviceInfo> {
    #[cfg(test)]
    {
        if let Some(ref f) = *TEST_ENUMERATE.lock().unwrap() {
            return f();
        }
    }
    // Catalog path intentionally skips per-device `default_input_config()`
    // (extra HAL round-trips). Names + loopback heuristics are enough for
    // status / Settings picker; channels/rate stay cheap defaults.
    GlobalAudioEngine::list_devices_light()
}

fn device_catalog() -> &'static Arc<DeviceCatalog> {
    static CATALOG: OnceLock<Arc<DeviceCatalog>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        DeviceCatalog::spawn(Arc::new(catalog_enumerate) as EnumerateFn)
    })
}

/// Ensure the background catalog worker is running. Safe to call repeatedly.
pub fn ensure_device_catalog() {
    let _ = device_catalog();
}

/// Non-blocking snapshot for status / UI. Never touches CoreAudio.
pub fn device_snapshot() -> Vec<AudioDeviceInfo> {
    ensure_device_catalog();
    device_catalog().snapshot()
}

/// Ask the worker to re-enumerate soon. Returns the current snapshot
/// immediately — does not wait for CoreAudio.
pub fn devices_for_ui() -> Vec<AudioDeviceInfo> {
    ensure_device_catalog();
    let catalog = device_catalog();
    catalog.request_refresh();
    catalog.snapshot()
}

#[cfg(target_os = "macos")]
mod macos_device_listener {
    //! Best-effort CoreAudio device-change listener. On plug/unplug it pokes
    //! the catalog worker's refresh channel so the snapshot updates without
    //! waiting for the periodic timer. Failures are ignored — periodic
    //! refresh remains the fallback on every platform.
    use super::*;
    use std::os::raw::c_void;

    type AudioObjectID = u32;
    type OSStatus = i32;

    #[repr(C)]
    struct AudioObjectPropertyAddress {
        selector: u32,
        scope: u32,
        element: u32,
    }

    const K_AUDIO_OBJECT_SYSTEM_OBJECT: AudioObjectID = 1;
    // 'dev#' / 'glob' FourCCs; element main is numeric 0 (not a FourCC).
    const K_AUDIO_HARDWARE_PROPERTY_DEVICES: u32 = u32::from_be_bytes(*b"dev#");
    const K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: u32 = u32::from_be_bytes(*b"glob");
    const K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN: u32 = 0;

    type AudioObjectPropertyListenerProc = Option<
        unsafe extern "C" fn(
            AudioObjectID,
            u32,
            *const AudioObjectPropertyAddress,
            *mut c_void,
        ) -> OSStatus,
    >;

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectAddPropertyListener(
            inObjectID: AudioObjectID,
            inAddress: *const AudioObjectPropertyAddress,
            inListener: AudioObjectPropertyListenerProc,
            inClientData: *mut c_void,
        ) -> OSStatus;
    }

    static REFRESH_TX: OnceLock<Mutex<Option<Sender<()>>>> = OnceLock::new();

    unsafe extern "C" fn on_devices_changed(
        _id: AudioObjectID,
        _n: u32,
        _addrs: *const AudioObjectPropertyAddress,
        _data: *mut c_void,
    ) -> OSStatus {
        // Hot CoreAudio callback: signal only. Never enumerate, never hold a
        // lock across any HAL call. try_lock so we never block the HAL thread.
        if let Some(cell) = REFRESH_TX.get() {
            if let Ok(guard) = cell.try_lock() {
                if let Some(ref tx) = *guard {
                    let _ = tx.send(());
                }
            }
        }
        0
    }

    pub fn install(tx: Sender<()>) {
        let cell = REFRESH_TX.get_or_init(|| Mutex::new(None));
        *cell.lock().unwrap() = Some(tx);

        let address = AudioObjectPropertyAddress {
            selector: K_AUDIO_HARDWARE_PROPERTY_DEVICES,
            scope: K_AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
            element: K_AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
        };
        unsafe {
            let _ = AudioObjectAddPropertyListener(
                K_AUDIO_OBJECT_SYSTEM_OBJECT,
                &address,
                Some(on_devices_changed),
                std::ptr::null_mut(),
            );
        }
    }
}

impl GlobalAudioEngine {
    pub fn new() -> Self {
        ensure_device_catalog();
        GlobalAudioEngine {
            state: Arc::new(Mutex::new(AudioState::default())),
            stop_tx: Mutex::new(None),
            preview_tx: Mutex::new(None),
            active_device_name: Mutex::new(None),
        }
    }

    /// Full enumeration including per-device `default_input_config()`.
    /// Prefer [`list_devices_light`] for the catalog worker. Never call from
    /// `get_status` / Tauri UI poll paths.
    pub fn list_devices() -> Vec<AudioDeviceInfo> {
        Self::enumerate_devices(true)
    }

    /// Name + loopback heuristic only — no per-device `default_input_config()`
    /// HAL round-trips. Used exclusively by the catalog worker.
    pub fn list_devices_light() -> Vec<AudioDeviceInfo> {
        Self::enumerate_devices(false)
    }

    fn enumerate_devices(with_input_config: bool) -> Vec<AudioDeviceInfo> {
        let host = cpal::default_host();
        let default_device_name = host.default_input_device().and_then(|d| d.name().ok());
        let mut list = Vec::new();

        if let Ok(devices) = host.input_devices() {
            for dev in devices {
                if let Ok(name) = dev.name() {
                    let is_default = default_device_name
                        .as_ref()
                        .map(|d| d == &name)
                        .unwrap_or(false);
                    let is_loopback = device_name_is_loopback(&name);

                    let (channels, sample_rate) = if with_input_config {
                        match dev.default_input_config() {
                            Ok(cfg) => (cfg.channels(), cfg.sample_rate().0),
                            Err(_) => (1, 16000),
                        }
                    } else {
                        (1, 16000)
                    };

                    list.push(AudioDeviceInfo {
                        name,
                        is_default,
                        is_loopback,
                        max_channels: channels,
                        default_sample_rate: sample_rate,
                    });
                }
            }
        }

        list
    }

    pub fn start(&self, target_device_name: Option<String>) -> Result<(), String> {
        let mut stop_lock = self.stop_tx.lock().unwrap();
        if stop_lock.is_some() {
            return Ok(()); // Already recording
        }

        *self.active_device_name.lock().unwrap() = target_device_name.clone();

        let (tx, rx) = channel::<()>();
        let state_clone = Arc::clone(&self.state);
        let target_device_for_thread = target_device_name;

        {
            let mut state = state_clone.lock().unwrap();
            state.is_recording = true;
            state.silence_counter = 999;
            state.is_speaking = false;
            state.pcm_16k_buffer.clear();
            state.hp_prev_in = 0.0;
            state.hp_prev_out = 0.0;
            state.recording_session_id = state.recording_session_id.wrapping_add(1).max(1);
            state.session_saved = false;
        }

        // Keep the catalog worker off CoreAudio for the whole capture lifetime
        // (build → run → teardown). Device open below still talks to HAL on
        // this dedicated stream thread — that is unavoidable for cpal — but
        // it must not race a concurrent catalog `list_devices`.
        mark_stream_hal_busy(true);

        thread::spawn(move || {
            let host = cpal::default_host();
            // Resolve the named device on the stream thread only. Prefer the
            // default device when no name is set so we avoid a full walk.
            let device = if let Some(ref target_name) = target_device_for_thread {
                let mut found = None;
                if let Ok(devices) = host.input_devices() {
                    for d in devices {
                        if let Ok(name) = d.name() {
                            if name.trim().eq_ignore_ascii_case(target_name.trim()) {
                                found = Some(d);
                                break;
                            }
                        }
                    }
                }
                found.or_else(|| host.default_input_device())
            } else {
                host.default_input_device()
            };

            let device = match device {
                Some(dev) => dev,
                None => {
                    eprintln!("Kayıt yapılacak ses giriş aygıtı bulunamadı");
                    mark_stream_hal_busy(false);
                    return;
                }
            };

            let config = match device.default_input_config() {
                Ok(cfg) => cfg,
                Err(e) => {
                    eprintln!("Ses aygıt konfigürasyon hatası: {}", e);
                    mark_stream_hal_busy(false);
                    return;
                }
            };

            let sample_rate = config.sample_rate().0;
            let channels = config.channels();
            let state_inner = Arc::clone(&state_clone);

            let err_fn = |err| eprintln!("Ses yakalama akışında hata: {}", err);

            let stream_result = match config.sample_format() {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _| {
                        process_audio_data(data, sample_rate, channels, &state_inner)
                    },
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _| {
                        let f32_data: Vec<f32> =
                            data.iter().map(|s| s.to_sample::<f32>()).collect();
                        process_audio_data(&f32_data, sample_rate, channels, &state_inner);
                    },
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::U16 => device.build_input_stream(
                    &config.into(),
                    move |data: &[u16], _| {
                        let f32_data: Vec<f32> =
                            data.iter().map(|s| s.to_sample::<f32>()).collect();
                        process_audio_data(&f32_data, sample_rate, channels, &state_inner);
                    },
                    err_fn,
                    None,
                ),
                _ => {
                    eprintln!("Desteklenmeyen ses örnekleme formatı");
                    mark_stream_hal_busy(false);
                    return;
                }
            };

            if let Ok(stream) = stream_result {
                if let Err(e) = stream.play() {
                    eprintln!("Ses akışı çalıştırılamadı: {}", e);
                    mark_stream_hal_busy(false);
                    return;
                }

                // Block thread until stop signal is received
                let _ = rx.recv();
                // Stream Drop (teardown) happens as `stream` leaves scope here.
            } else {
                mark_stream_hal_busy(false);
            }
        });

        *stop_lock = Some(tx);
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut stop_lock = self.stop_tx.lock().unwrap();
        if let Some(tx) = stop_lock.take() {
            let _ = tx.send(()); // Signal thread to exit and drop stream
        }
        // Release stop_tx before touching state — never hold engine locks
        // across CoreAudio (stream Drop runs on the capture thread).
        drop(stop_lock);

        {
            let mut state = self.state.lock().unwrap();
            state.is_recording = false;
            state.mic_level = 0.0;
            state.sys_level = 0.0;
            state.is_speaking = false;
        }

        // Do NOT enumerate here. Debounce a catalog refresh until after
        // stream teardown is likely finished so the worker cannot overlap
        // CoreAudio's StopIOProc / DestroyIOProcID.
        schedule_post_stop_catalog_refresh();

        Ok(())
    }

    pub fn start_preview(&self, target_device_name: Option<String>) -> Result<(), String> {
        let is_rec = self.state.lock().unwrap().is_recording;
        if is_rec {
            return Ok(()); // Already actively recording and calculating mic levels
        }

        self.stop_preview()?;
        *self.active_device_name.lock().unwrap() = target_device_name.clone();

        let (tx, rx) = channel::<()>();
        let state_clone = Arc::clone(&self.state);

        mark_stream_hal_busy(true);

        thread::spawn(move || {
            let host = cpal::default_host();
            let device = if let Some(ref target_name) = target_device_name {
                let mut found = None;
                if let Ok(devices) = host.input_devices() {
                    for d in devices {
                        if let Ok(name) = d.name() {
                            if name.trim().eq_ignore_ascii_case(target_name.trim()) {
                                found = Some(d);
                                break;
                            }
                        }
                    }
                }
                found.or_else(|| host.default_input_device())
            } else {
                host.default_input_device()
            };

            let device = match device {
                Some(dev) => dev,
                None => {
                    mark_stream_hal_busy(false);
                    return;
                }
            };

            let config = match device.default_input_config() {
                Ok(cfg) => cfg,
                Err(_) => {
                    mark_stream_hal_busy(false);
                    return;
                }
            };

            let sample_rate = config.sample_rate().0;
            let channels = config.channels();
            let state_inner = Arc::clone(&state_clone);

            let err_fn = |_| ();

            let stream_result = match config.sample_format() {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _| {
                        process_audio_data(data, sample_rate, channels, &state_inner)
                    },
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _| {
                        let f32_data: Vec<f32> =
                            data.iter().map(|s| s.to_sample::<f32>()).collect();
                        process_audio_data(&f32_data, sample_rate, channels, &state_inner);
                    },
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::U16 => device.build_input_stream(
                    &config.into(),
                    move |data: &[u16], _| {
                        let f32_data: Vec<f32> =
                            data.iter().map(|s| s.to_sample::<f32>()).collect();
                        process_audio_data(&f32_data, sample_rate, channels, &state_inner);
                    },
                    err_fn,
                    None,
                ),
                _ => {
                    mark_stream_hal_busy(false);
                    return;
                }
            };

            if let Ok(stream) = stream_result {
                if stream.play().is_ok() {
                    let _ = rx.recv();
                } else {
                    mark_stream_hal_busy(false);
                }
            } else {
                mark_stream_hal_busy(false);
            }
        });

        let mut preview_lock = self.preview_tx.lock().unwrap();
        *preview_lock = Some(tx);
        Ok(())
    }

    pub fn stop_preview(&self) -> Result<(), String> {
        let mut preview_lock = self.preview_tx.lock().unwrap();
        let had_preview = if let Some(tx) = preview_lock.take() {
            let _ = tx.send(());
            true
        } else {
            false
        };
        drop(preview_lock);

        {
            let mut state = self.state.lock().unwrap();
            if !state.is_recording {
                state.mic_level = 0.0;
                state.is_speaking = false;
            }
        }

        if had_preview && !self.state.lock().unwrap().is_recording {
            schedule_post_stop_catalog_refresh();
        }

        Ok(())
    }

    pub fn get_status(&self) -> AudioStatus {
        // Critical: never call list_devices() / CoreAudio here, and never hold
        // `state` (or any lock shared with start/stop) across a CoreAudio call.
        // Device fields come only from the catalog snapshot + name heuristics.
        let (is_recording, mic_level, sys_level, is_speaking, buffered_samples) = {
            let state = self.state.lock().unwrap();
            (
                state.is_recording,
                state.mic_level,
                state.sys_level,
                state.is_speaking,
                state.pcm_16k_buffer.len(),
            )
        };
        let dev_name = self.active_device_name.lock().unwrap().clone();
        let devices = device_snapshot();
        let has_loopback = devices.iter().any(|d| d.is_loopback);
        let is_loopback = match &dev_name {
            Some(name) => device_name_is_loopback(name),
            None => devices
                .iter()
                .find(|d| d.is_default)
                .map(|d| d.is_loopback)
                .unwrap_or(false),
        };

        AudioStatus {
            is_recording,
            mic_level: (mic_level * 100.0).round() / 100.0,
            sys_level: (sys_level * 100.0).round() / 100.0,
            is_speaking,
            sample_rate: 16000,
            channels: 1,
            buffered_samples,
            is_loopback,
            has_loopback_device: has_loopback,
            active_device_name: dev_name,
        }
    }

    /// Clone of the live PCM buffer for preview / debug / VU inspection only.
    /// Persistence must use [`Self::claim_pcm_for_save`] so audio is taken once.
    pub fn get_pcm_buffer(&self) -> Vec<f32> {
        let state = self.state.lock().unwrap();
        state.pcm_16k_buffer.clone()
    }

    /// Atomically take the PCM buffer for the current recording session.
    /// Empty / tiny buffers return `NothingToSave` (session still marked saved).
    /// Subsequent callers get `AlreadySaved`.
    pub fn claim_pcm_for_save(&self) -> PcmClaim {
        let mut state = self.state.lock().unwrap();
        let session_id = state.recording_session_id;
        if state.session_saved {
            return PcmClaim::AlreadySaved { session_id };
        }
        state.session_saved = true;
        let pcm = std::mem::take(&mut state.pcm_16k_buffer);
        if pcm.len() < MIN_SAVE_PCM_SAMPLES {
            return PcmClaim::NothingToSave { session_id };
        }
        PcmClaim::Claimed { session_id, pcm }
    }

    /// Test helper: inject PCM without starting capture.
    #[cfg(test)]
    pub fn inject_pcm_for_test(&self, samples: Vec<f32>, session_id: u64) {
        let mut state = self.state.lock().unwrap();
        state.pcm_16k_buffer = samples;
        state.recording_session_id = session_id;
        state.session_saved = false;
    }
}

// Audio DSP Pre-processing:
// 1. High-Pass Filter (80Hz cut-off for rumble/fan noise reduction)
// 2. Resample to 16000 Hz Mono
// 3. RMS & VAD calculation with speech hangover
// 4. Clean PCM buffer accumulation
fn process_audio_data(
    data: &[f32],
    src_sample_rate: u32,
    channels: u16,
    state_arc: &SharedAudioState,
) {
    if data.is_empty() {
        return;
    }

    // 1. Downmix channels to mono
    let raw_mono: Vec<f32> = if channels > 1 {
        data.chunks(channels as usize)
            .map(|chunk| chunk.iter().sum::<f32>() / (channels as f32))
            .collect()
    } else {
        data.to_vec()
    };

    let mut state = state_arc.lock().unwrap();

    // 2. Apply High-Pass Filter (80Hz cut-off to isolate voice from low-frequency background noise)
    // Single-pole IIR high-pass filter: y[n] = alpha * (y[n-1] + x[n] - x[n-1])
    let dt = 1.0 / (src_sample_rate as f32);
    let rc = 1.0 / (2.0 * std::f32::consts::PI * 80.0);
    let alpha = rc / (rc + dt);

    let mut filtered_mono = Vec::with_capacity(raw_mono.len());
    let mut prev_in = state.hp_prev_in;
    let mut prev_out = state.hp_prev_out;

    for &sample in &raw_mono {
        let out = alpha * (prev_out + sample - prev_in);
        prev_in = sample;
        prev_out = out;
        filtered_mono.push(out);
    }

    state.hp_prev_in = prev_in;
    state.hp_prev_out = prev_out;

    // 3. Compute RMS Energy & Mic VU Level
    let sum_sq: f32 = filtered_mono.iter().map(|&s| s * s).sum();
    let rms = (sum_sq / filtered_mono.len() as f32).sqrt();
    let mic_level = (rms * 6.0).min(1.0);
    state.mic_level = mic_level;

    // 4. VAD with Speech Hangover
    let raw_speech_detected = rms > 0.003;
    if raw_speech_detected {
        state.is_speaking = true;
        state.silence_counter = 0;
    } else {
        state.silence_counter = state.silence_counter.saturating_add(1);
        if state.silence_counter > 35 {
            // ~1.5s silence hangover
            state.is_speaking = false;
        }
    }

    // 5. Resample to 16000 Hz Mono
    let target_sample_rate = 16000.0;
    let ratio = src_sample_rate as f64 / target_sample_rate;
    let resampled_len = (filtered_mono.len() as f64 / ratio) as usize;

    let mut resampled_pcm = Vec::with_capacity(resampled_len);
    for i in 0..resampled_len {
        let src_idx = (i as f64 * ratio) as usize;
        if src_idx < filtered_mono.len() {
            resampled_pcm.push(filtered_mono[src_idx]);
        }
    }

    // Accumulate in 16kHz PCM buffer ONLY during active recording (up to 2 hours)
    if state.is_recording {
        state.pcm_16k_buffer.extend_from_slice(&resampled_pcm);
        const MAX_BUFFER_SAMPLES: usize = 16000 * 3600 * 2; // 2 hours buffer (115,200,000 samples)
        if state.pcm_16k_buffer.len() > MAX_BUFFER_SAMPLES {
            let overflow = state.pcm_16k_buffer.len() - MAX_BUFFER_SAMPLES;
            state.pcm_16k_buffer.drain(0..overflow);
        }
    }
}

// Audio Normalization & DSP Speech Enhancement:
// 1. High-Pass Filter (85 Hz) removes low-frequency hum, air conditioning and sub-bass rumble.
// 2. Soft Noise Gate cleans background room hiss between sentences.
// 3. Normalizes PCM samples so peak amplitude reaches 0.90 (-1dB).
pub fn normalize_audio_samples(samples: &mut [f32]) {
    if samples.is_empty() {
        return;
    }

    // 1. High-Pass Filter (85 Hz cutoff at 16kHz sample rate)
    // alpha = RC / (RC + dt) ≈ 0.967
    let alpha = 0.967f32;
    let mut prev_in = 0.0f32;
    let mut prev_out = 0.0f32;
    for sample in samples.iter_mut() {
        let curr_in = *sample;
        let curr_out = alpha * (prev_out + curr_in - prev_in);
        prev_in = curr_in;
        prev_out = curr_out;
        *sample = curr_out;
    }

    // 2. Soft Noise Gating: reduce background noise floor below 0.008 by 80%
    let gate_threshold = 0.008f32;
    for sample in samples.iter_mut() {
        if sample.abs() < gate_threshold {
            *sample *= 0.20; // 80% attenuation for room silence
        }
    }

    // 3. Peak Normalization to 0.90 (-1dB)
    let max_peak = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
    if max_peak > 0.001 {
        let target_peak = 0.90;
        let gain = target_peak / max_peak;
        // Limit maximum amplification to 10x to prevent amplifying pure silence
        let safe_gain = gain.min(10.0);
        for sample in samples.iter_mut() {
            *sample *= safe_gain;
        }
    }
}

pub fn get_global_audio_engine() -> &'static GlobalAudioEngine {
    static ENGINE: OnceLock<GlobalAudioEngine> = OnceLock::new();
    ENGINE.get_or_init(GlobalAudioEngine::new)
}

/// Fires a one-time, OS-level notification when a recording starts using only
/// the microphone. The in-app warning badge (App.tsx) only helps if EchoMind's
/// own window is actually visible and in the foreground — but during a real
/// call the user is looking at Zoom/Meet/Teams, not this app, so an in-app-only
/// warning can go completely unseen. A system notification reaches the user
/// regardless of which app currently has focus.
#[cfg(target_os = "macos")]
fn notify_mic_only_capture() {
    let script = "display notification \"Şu an yalnızca mikrofon yakalanıyor. Sistem sesi (Zoom / Meet / Teams) desteklenmiyor.\" with title \"EchoMind Asistan\" subtitle \"Sistem Sesi Yakalanmıyor\" sound name \"Basso\"";
    let _ = std::process::Command::new("osascript")
        .args(["-e", script])
        .spawn();
}

#[cfg(not(target_os = "macos"))]
fn notify_mic_only_capture() {}

/// Whether the mic-only notification should fire: exactly once, on the
/// transition from "not recording" into "actively recording without
/// loopback" — never on a no-op start-while-already-recording call (`start()`
/// itself is a no-op in that case), and never when loopback is active.
fn should_notify_mic_only(was_already_recording: bool, status: &AudioStatus) -> bool {
    !was_already_recording && status.is_recording && !status.is_loopback
}

#[tauri::command]
pub fn start_audio_capture(device_name: Option<String>) -> Result<AudioStatus, String> {
    let engine = get_global_audio_engine();
    let was_already_recording = engine.get_status().is_recording;
    engine.start(device_name)?;
    let status = engine.get_status();
    if should_notify_mic_only(was_already_recording, &status) {
        notify_mic_only_capture();
    }
    Ok(status)
}

#[tauri::command]
pub fn start_meeting_recording(
    app_handle: tauri::AppHandle,
    device_name: Option<String>,
    meeting_title: Option<String>,
) -> Result<AudioStatus, String> {
    use tauri::{Emitter, Manager};
    let engine = get_global_audio_engine();
    let was_already_recording = engine.get_status().is_recording;
    engine.start(device_name)?;
    let title = meeting_title.unwrap_or_else(|| "Google Meet Toplantısı".to_string());
    println!("🎙️ start_meeting_recording çağrıldı: {:?}", title);
    let _ = app_handle.emit(
        "trigger-start-recording",
        serde_json::json!({
            "title": title
        }),
    );
    if let Some(island_win) = app_handle.get_webview_window("island") {
        let _ = island_win.hide();
    }
    let status = engine.get_status();
    if should_notify_mic_only(was_already_recording, &status) {
        notify_mic_only_capture();
    }
    Ok(status)
}

#[tauri::command]
pub fn stop_audio_capture() -> Result<AudioStatus, String> {
    let engine = get_global_audio_engine();
    engine.stop()?;
    Ok(engine.get_status())
}

/// Stops capture without persisting the meeting, for the "discard recording" UI flow.
/// The audio engine itself never writes to disk on stop, so this is functionally
/// identical to `stop_audio_capture`; the distinct command name lets the frontend
/// skip its post-stop save step when the user explicitly cancels.
#[tauri::command]
pub fn cancel_audio_capture() -> Result<AudioStatus, String> {
    let engine = get_global_audio_engine();
    engine.stop()?;
    Ok(engine.get_status())
}

#[tauri::command]
pub fn get_audio_status() -> AudioStatus {
    let engine = get_global_audio_engine();
    engine.get_status()
}

#[tauri::command]
pub fn start_mic_preview(device_name: Option<String>) -> Result<(), String> {
    let engine = get_global_audio_engine();
    engine.start_preview(device_name)
}

#[tauri::command]
pub fn stop_mic_preview() -> Result<(), String> {
    let engine = get_global_audio_engine();
    engine.stop_preview()
}

#[tauri::command]
pub fn list_audio_devices() -> Vec<AudioDeviceInfo> {
    // Return the published snapshot immediately and poke the worker for a
    // refresh. Never enumerate on the Tauri command thread — that is the
    // same class of CoreAudio contention that hung get_status in v0.2.12.
    devices_for_ui()
}

#[tauri::command]
pub fn open_audio_midi_setup() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-a")
            .arg("Audio MIDI Setup")
            .spawn()
            .map_err(|e| format!("Audio MIDI Setup açılamadı: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "ms-settings:sound"])
            .spawn()
            .map_err(|e| format!("Windows Ses Ayarları açılamadı: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let res = std::process::Command::new("pavucontrol").spawn();
        if res.is_err() {
            let _ = std::process::Command::new("gnome-control-center")
                .arg("sound")
                .spawn()
                .map_err(|e| format!("Linux Ses Denetimi açılamadı: {}", e))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::Condvar;
    use std::time::Instant;

    /// Serializes tests that mutate the process-global `TEST_ENUMERATE` hook.
    fn test_enumerate_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn sample_device(name: &str, is_default: bool, is_loopback: bool) -> AudioDeviceInfo {
        AudioDeviceInfo {
            name: name.to_string(),
            is_default,
            is_loopback,
            max_channels: 1,
            default_sample_rate: 48000,
        }
    }

    #[test]
    fn test_device_name_is_loopback_heuristics() {
        assert!(device_name_is_loopback("BlackHole 2ch"));
        assert!(device_name_is_loopback("VB-Audio Cable Output"));
        assert!(!device_name_is_loopback("MacBook Pro Microphone"));
    }

    #[test]
    fn test_catalog_skips_enumerate_while_stream_hal_busy() {
        // Grok review: never let the catalog worker race stream teardown.
        mark_stream_hal_busy(true);
        assert!(!catalog_may_enumerate());
        mark_stream_hal_busy(false);
        {
            let mut quiet = ENUM_QUIET_UNTIL.lock().unwrap();
            *quiet = None;
        }
        assert!(catalog_may_enumerate());
    }

    #[test]
    fn test_device_catalog_snapshot_never_calls_enumerate() {
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_w = Arc::clone(&calls);
        let catalog = DeviceCatalog::spawn(Arc::new(move || {
            calls_w.fetch_add(1, Ordering::SeqCst);
            vec![sample_device("Test Mic", true, false)]
        }));

        // Wait for the worker's initial enumeration to publish.
        let deadline = Instant::now() + Duration::from_secs(2);
        while catalog.snapshot().is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(!catalog.snapshot().is_empty());
        let baseline = calls.load(Ordering::SeqCst);
        assert!(baseline >= 1);

        for _ in 0..200 {
            let snap = catalog.snapshot();
            assert_eq!(snap.len(), 1);
            assert_eq!(snap[0].name, "Test Mic");
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            baseline,
            "snapshot reads must not trigger enumeration"
        );
    }

    #[test]
    fn test_device_catalog_returns_while_enumeration_blocked() {
        let allow_second = Arc::new((Mutex::new(false), Condvar::new()));
        let phase = Arc::new(AtomicUsize::new(0));
        let allow_second_w = Arc::clone(&allow_second);
        let phase_w = Arc::clone(&phase);

        let catalog = DeviceCatalog::spawn(Arc::new(move || {
            let n = phase_w.fetch_add(1, Ordering::SeqCst);
            if n == 0 {
                return vec![sample_device("Seed Mic", true, false)];
            }
            let (lock, cvar) = &*allow_second_w;
            let mut ready = lock.lock().unwrap();
            while !*ready {
                ready = cvar.wait(ready).unwrap();
            }
            vec![sample_device("After Unblock", true, false)]
        }));

        let deadline = Instant::now() + Duration::from_secs(2);
        while catalog.snapshot().is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(catalog.snapshot()[0].name, "Seed Mic");

        // Kick a refresh that will block inside the worker's enumerate.
        catalog.request_refresh();
        let entered = Instant::now() + Duration::from_secs(2);
        while phase.load(Ordering::SeqCst) < 2 && Instant::now() < entered {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(
            phase.load(Ordering::SeqCst) >= 2,
            "worker should have entered the blocking refresh"
        );

        let start = Instant::now();
        for _ in 0..50 {
            let snap = catalog.snapshot();
            assert_eq!(snap[0].name, "Seed Mic");
        }
        let elapsed = start.elapsed();
        assert!(
            elapsed < Duration::from_millis(100),
            "snapshot reads took {:?} while enumeration was blocked — must stay non-blocking",
            elapsed
        );

        // Unblock worker so the thread can exit cleanly.
        {
            let (lock, cvar) = &*allow_second;
            *lock.lock().unwrap() = true;
            cvar.notify_all();
        }
    }

    #[test]
    fn test_get_status_does_not_call_enumeration() {
        let _guard = test_enumerate_lock();
        ensure_device_catalog();

        // Seed snapshot so has_loopback fields are defined, then prove get_status
        // stays fast and derives active-device loopback from the name heuristic
        // alone (no enumeration on this path).
        {
            *TEST_ENUMERATE.lock().unwrap() = Some(Arc::new(|| {
                vec![sample_device("Status Seed", true, false)]
            }));
            device_catalog().request_refresh();
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                let snap = device_snapshot();
                if snap.iter().any(|d| d.name == "Status Seed") {
                    break;
                }
                assert!(Instant::now() < deadline, "timed out seeding catalog");
                thread::sleep(Duration::from_millis(5));
            }
        }

        let engine = GlobalAudioEngine::new();
        *engine.active_device_name.lock().unwrap() = Some("BlackHole 2ch".into());

        // Do not request_refresh here — get_status must not do so itself.
        let start = Instant::now();
        for _ in 0..100 {
            let status = engine.get_status();
            assert!(
                status.is_loopback,
                "active BlackHole must be loopback via name heuristic"
            );
            assert_eq!(status.active_device_name.as_deref(), Some("BlackHole 2ch"));
        }
        let elapsed = start.elapsed();

        assert!(
            elapsed < Duration::from_millis(200),
            "100 get_status calls took {:?} — must stay off the CoreAudio path",
            elapsed
        );

        *TEST_ENUMERATE.lock().unwrap() = None;
    }

    struct ReleaseEnumerateOnDrop {
        gate: Arc<(Mutex<bool>, Condvar)>,
    }

    impl Drop for ReleaseEnumerateOnDrop {
        fn drop(&mut self) {
            let (lock, cvar) = &*self.gate;
            if let Ok(mut open) = lock.lock() {
                *open = true;
                cvar.notify_all();
            }
            if let Ok(mut slot) = TEST_ENUMERATE.lock() {
                *slot = None;
            }
        }
    }

    #[test]
    fn test_get_status_and_list_devices_prompt_while_refresh_blocked() {
        let _guard = test_enumerate_lock();
        ensure_device_catalog();

        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let _release = ReleaseEnumerateOnDrop {
            gate: Arc::clone(&gate),
        };
        let in_block = Arc::new(AtomicBool::new(false));

        // First, publish a usable snapshot.
        {
            *TEST_ENUMERATE.lock().unwrap() = Some(Arc::new(|| {
                vec![
                    sample_device("Built-in Mic", true, false),
                    sample_device("BlackHole 2ch", false, true),
                ]
            }));
            device_catalog().request_refresh();
            let deadline = Instant::now() + Duration::from_secs(2);
            while !device_snapshot().iter().any(|d| d.name == "Built-in Mic")
                && Instant::now() < deadline
            {
                thread::sleep(Duration::from_millis(5));
            }
            assert!(device_snapshot().iter().any(|d| d.is_loopback));
        }

        let gate_w = Arc::clone(&gate);
        let in_block_w = Arc::clone(&in_block);
        *TEST_ENUMERATE.lock().unwrap() = Some(Arc::new(move || {
            in_block_w.store(true, Ordering::SeqCst);
            let (lock, cvar) = &*gate_w;
            let mut open = lock.lock().unwrap();
            while !*open {
                open = cvar.wait(open).unwrap();
            }
            in_block_w.store(false, Ordering::SeqCst);
            vec![sample_device("Unblocked", true, false)]
        }));

        device_catalog().request_refresh();
        let deadline = Instant::now() + Duration::from_secs(2);
        while !in_block.load(Ordering::SeqCst) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(
            in_block.load(Ordering::SeqCst),
            "worker should be blocked inside enumerate (simulating CoreAudio teardown contention)"
        );

        let engine = GlobalAudioEngine::new();
        let start = Instant::now();
        let status = engine.get_status();
        let listed = list_audio_devices();
        let elapsed = start.elapsed();

        assert!(
            elapsed < Duration::from_millis(100),
            "get_status + list_audio_devices took {:?} while enumerate blocked",
            elapsed
        );
        assert!(
            status.has_loopback_device,
            "status should still report loopback from the last good snapshot"
        );
        assert!(
            listed.iter().any(|d| d.name == "Built-in Mic"),
            "list_audio_devices must return the prior snapshot without waiting"
        );
    }

    #[test]
    fn test_stop_does_not_block_on_catalog_refresh() {
        let _guard = test_enumerate_lock();
        ensure_device_catalog();

        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let _release = ReleaseEnumerateOnDrop {
            gate: Arc::clone(&gate),
        };
        let in_block = Arc::new(AtomicBool::new(false));

        {
            *TEST_ENUMERATE.lock().unwrap() =
                Some(Arc::new(|| vec![sample_device("Mic", true, false)]));
            device_catalog().request_refresh();
            let deadline = Instant::now() + Duration::from_secs(2);
            while device_snapshot().is_empty() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(5));
            }
        }

        let gate_w = Arc::clone(&gate);
        let in_block_w = Arc::clone(&in_block);
        *TEST_ENUMERATE.lock().unwrap() = Some(Arc::new(move || {
            in_block_w.store(true, Ordering::SeqCst);
            let (lock, cvar) = &*gate_w;
            let mut open = lock.lock().unwrap();
            while !*open {
                open = cvar.wait(open).unwrap();
            }
            vec![]
        }));

        let engine = GlobalAudioEngine::new();
        // stop() requests a catalog refresh; that must not make stop wait on
        // the (blocked) enumerator.
        let start = Instant::now();
        engine.stop().unwrap();
        let status = engine.get_status();
        let elapsed = start.elapsed();

        assert!(!status.is_recording);
        assert!(
            elapsed < Duration::from_millis(100),
            "stop+get_status took {:?} — must not wait on blocked catalog refresh",
            elapsed
        );
    }

    #[test]
    fn test_audio_filter_and_normalize() {
        let mut mock_pcm = vec![0.05, -0.05, 0.1, -0.1, 0.02, -0.02];
        normalize_audio_samples(&mut mock_pcm);
        let max_peak = mock_pcm.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!((max_peak - 0.90).abs() < 0.01);
    }

    fn status(is_recording: bool, is_loopback: bool) -> AudioStatus {
        AudioStatus {
            is_recording,
            mic_level: 0.0,
            sys_level: 0.0,
            is_speaking: false,
            sample_rate: 16000,
            channels: 1,
            buffered_samples: 0,
            is_loopback,
            has_loopback_device: false,
            active_device_name: None,
        }
    }

    #[test]
    fn test_should_notify_mic_only_fires_on_fresh_mic_only_start() {
        assert!(should_notify_mic_only(false, &status(true, false)));
    }

    #[test]
    fn test_should_notify_mic_only_never_fires_with_loopback_active() {
        assert!(!should_notify_mic_only(false, &status(true, true)));
    }

    #[test]
    fn test_should_notify_mic_only_never_fires_on_noop_restart() {
        // start() is a no-op if already recording; a redundant call must not
        // re-notify a user who already saw the warning for this session.
        assert!(!should_notify_mic_only(true, &status(true, false)));
    }

    #[test]
    fn test_should_notify_mic_only_never_fires_if_start_failed() {
        assert!(!should_notify_mic_only(false, &status(false, false)));
    }

    #[test]
    fn test_claim_pcm_for_save_takes_buffer_once_per_session() {
        let engine = GlobalAudioEngine::new();
        let samples: Vec<f32> = (0..8000).map(|i| ((i % 50) as f32) * 0.001).collect();
        engine.inject_pcm_for_test(samples.clone(), 7);

        match engine.claim_pcm_for_save() {
            PcmClaim::Claimed { session_id, pcm } => {
                assert_eq!(session_id, 7);
                assert_eq!(pcm.len(), samples.len());
            }
            other => panic!("expected Claimed, got {:?}", other),
        }
        assert!(engine.get_pcm_buffer().is_empty());
        assert!(matches!(
            engine.claim_pcm_for_save(),
            PcmClaim::AlreadySaved { session_id: 7 }
        ));
    }

    #[test]
    fn test_claim_empty_pcm_is_nothing_to_save() {
        let engine = GlobalAudioEngine::new();
        engine.inject_pcm_for_test(vec![0.01; 10], 3);
        assert!(matches!(
            engine.claim_pcm_for_save(),
            PcmClaim::NothingToSave { session_id: 3 }
        ));
        assert!(matches!(
            engine.claim_pcm_for_save(),
            PcmClaim::AlreadySaved { session_id: 3 }
        ));
    }

    #[test]
    fn test_new_recording_session_resets_save_guard() {
        let engine = GlobalAudioEngine::new();
        engine.inject_pcm_for_test(vec![0.1; 5000], 1);
        assert!(matches!(
            engine.claim_pcm_for_save(),
            PcmClaim::Claimed { .. }
        ));
        {
            let mut state = engine.state.lock().unwrap();
            state.recording_session_id = 2;
            state.session_saved = false;
            state.pcm_16k_buffer = vec![0.3; 5000];
        }
        match engine.claim_pcm_for_save() {
            PcmClaim::Claimed { session_id, pcm } => {
                assert_eq!(session_id, 2);
                assert_eq!(pcm.len(), 5000);
            }
            other => panic!("expected Claimed, got {:?}", other),
        }
    }
}
