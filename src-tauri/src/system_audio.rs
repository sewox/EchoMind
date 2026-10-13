//! System-audio capture (the remote side of a call), recorded next to the
//! microphone so transcription hears everyone and speakers can be attributed
//! by channel: microphone = the local user, system audio = remote people.
//!
//! - macOS 14.2+: Core Audio process tap (Swift bridge in `swift/EchoMindAudio`).
//! - Windows: WASAPI loopback of the default output device (through cpal).
//! - Linux: the monitor of the default output in PulseAudio or PipeWire
//!   (`libpulse-simple`, loaded at run time so the app still starts without it).
use crate::audio::{align_sys_buffer_to_mic, SharedAudioState};

/// Whether this OS build can capture system audio.
pub fn is_supported() -> bool {
    imp::is_supported()
}

/// Starts writing system audio into `state.sys_pcm_16k_buffer` while
/// `state.is_recording`. Returns an error string when unsupported or when
/// Core Audio refuses (e.g. permission denied).
pub fn start(state: SharedAudioState) -> Result<(), String> {
    imp::start(state)
}

/// Stops system-audio capture. Safe to call when not running.
pub fn stop() {
    imp::stop()
}

/// Appends one callback's worth of interleaved frames to the session.
///
/// System taps often pause callbacks during silence; the mic timeline is the
/// master, so we pad the system buffer up to the current mic length before
/// writing, and trim a large lead if the two clocks drift apart.
#[cfg_attr(
    not(any(target_os = "macos", target_os = "windows", target_os = "linux", test)),
    allow(dead_code)
)]
pub(crate) fn ingest(state: &SharedAudioState, interleaved: &[f32], channels: usize, rate: f64) {
    if interleaved.is_empty() || channels == 0 {
        return;
    }
    let mono: Vec<f32> = interleaved
        .chunks(channels)
        .map(|c| c.iter().sum::<f32>() / channels as f32)
        .collect();
    let mut st = state.lock().unwrap();
    if !st.is_recording || st.limit_reached {
        return;
    }
    let rms = (mono.iter().map(|s| s * s).sum::<f32>() / mono.len() as f32).sqrt();
    st.sys_level = (rms * 6.0).min(1.0);
    let rate_u = rate.round().max(1.0) as u32;
    let needs_new = st
        .sys_resampler
        .as_ref()
        .map(|r| r.input_rate() != rate_u)
        .unwrap_or(true);
    if needs_new {
        st.sys_resampler = Some(crate::resample::Downsampler::new(rate_u, 16000));
    }
    // Pad for silent gaps where Core Audio skipped callbacks.
    align_sys_buffer_to_mic(&mut st);
    let out = st.sys_resampler.as_mut().unwrap().process(&mono);
    st.sys_pcm_16k_buffer
        .extend(out.iter().map(|&s| crate::audio::sample_to_i16(s)));
    st.sys_capture_active = true;
    // If the system clock ran ahead of the mic by more than ~300 ms, trim so
    // the next mic pad keeps the two tracks sample-aligned.
    const MAX_LEAD: usize = 16000 * 3 / 10;
    let mic_len = st.pcm_16k_buffer.len();
    if st.sys_pcm_16k_buffer.len() > mic_len.saturating_add(MAX_LEAD) {
        st.sys_pcm_16k_buffer.truncate(mic_len.saturating_add(1600));
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use std::ffi::c_void;
    use std::sync::Mutex;

    type Callback = extern "C" fn(*const f32, u32, u32, f64, *mut c_void);

    extern "C" {
        fn echomind_systap_start(cb: Callback, ctx: *mut c_void) -> i32;
        fn echomind_systap_stop();
        fn echomind_systap_supported() -> i32;
    }

    /// Context handed to the Swift side; owned here until `stop()`.
    static CONTEXT: Mutex<Option<usize>> = Mutex::new(None);

    extern "C" fn on_audio(
        data: *const f32,
        frames: u32,
        channels: u32,
        rate: f64,
        ctx: *mut c_void,
    ) {
        if data.is_null() || ctx.is_null() || frames == 0 {
            return;
        }
        // SAFETY: ctx is the Box<SharedAudioState> leaked in `start` and only
        // freed in `stop` after the tap has been torn down; `data` holds
        // frames * channels floats for the duration of this call.
        let state = unsafe { &*(ctx as *const SharedAudioState) };
        let samples =
            unsafe { std::slice::from_raw_parts(data, (frames * channels.max(1)) as usize) };
        ingest(state, samples, channels.max(1) as usize, rate);
    }

    pub fn is_supported() -> bool {
        unsafe { echomind_systap_supported() == 1 }
    }

    pub fn start(state: SharedAudioState) -> Result<(), String> {
        let mut ctx_slot = CONTEXT.lock().unwrap();
        if ctx_slot.is_some() {
            return Ok(());
        }
        let ctx = Box::into_raw(Box::new(state)) as *mut c_void;
        let status = unsafe { echomind_systap_start(on_audio, ctx) };
        if status != 0 {
            // SAFETY: Swift did not keep the pointer on failure.
            drop(unsafe { Box::from_raw(ctx as *mut SharedAudioState) });
            return Err(match status {
                -1 => "system audio capture needs macOS 14.2 or later".into(),
                -2 => "system audio capture is already running".into(),
                // TCC denial / missing NSAudioCaptureUsageDescription often
                // surfaces as a Core Audio property / device error.
                other => format!("system audio capture failed (Core Audio status {other})"),
            });
        }
        *ctx_slot = Some(ctx as usize);
        Ok(())
    }

    pub fn stop() {
        let mut ctx_slot = CONTEXT.lock().unwrap();
        if let Some(ctx) = ctx_slot.take() {
            // Tear down first so no callback can still be running, then free.
            unsafe { echomind_systap_stop() };
            drop(unsafe { Box::from_raw(ctx as *mut SharedAudioState) });
        }
    }
}

/// A capture thread that owns its platform stream: started with a ready
/// handshake (so `start` can report an error), stopped by flag and joined, so
/// no callback runs after `stop` returns.
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod worker {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread::JoinHandle;

    static RUNNING: Mutex<Option<(Arc<AtomicBool>, JoinHandle<()>)>> = Mutex::new(None);

    /// Runs `capture` on its own thread. It calls `ready` once the stream is
    /// open (or failed) and must return soon after the stop flag is set.
    pub fn start<F>(capture: F) -> Result<(), String>
    where
        F: FnOnce(&AtomicBool, &dyn Fn(Result<(), String>)) + Send + 'static,
    {
        let mut running = RUNNING.lock().unwrap();
        if running.is_some() {
            return Ok(());
        }
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel();
        let flag = Arc::clone(&stop);
        let handle = std::thread::Builder::new()
            .name("system-audio".into())
            .spawn(move || {
                capture(&flag, &|result| {
                    let _ = ready_tx.send(result);
                })
            })
            .map_err(|e| format!("system audio thread failed to start: {e}"))?;
        match ready_rx.recv() {
            Ok(Ok(())) => {
                *running = Some((stop, handle));
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = handle.join();
                Err(e)
            }
            Err(_) => {
                let _ = handle.join();
                Err("system audio capture stopped before it started".into())
            }
        }
    }

    pub fn stop() {
        let running = RUNNING.lock().unwrap().take();
        if let Some((stop, handle)) = running {
            stop.store(true, Ordering::SeqCst);
            let _ = handle.join();
        }
    }

    pub fn stop_requested(flag: &AtomicBool) -> bool {
        flag.load(Ordering::SeqCst)
    }
}

/// How often the capture thread checks which output is the default when it
/// cannot be told (Linux without server events), and how long it waits
/// between attempts to reopen a broken stream.
#[cfg(any(target_os = "windows", target_os = "linux"))]
const FOLLOW_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);

/// Windows polls the default output this often: whatever plays between the
/// switch and the reopen is not recorded, so the check has to be short.
#[cfg(target_os = "windows")]
const WINDOWS_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_millis(200);

/// `PA_SUBSCRIPTION_MASK_SERVER`: server changes, the default sink included.
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
const PA_SUBSCRIPTION_MASK_SERVER: u32 = 0x0080;

/// Whether a libpulse subscription event is about the server (where the
/// default sink lives) rather than a sink, source or stream.
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn is_server_event(event: u32) -> bool {
    const FACILITY_MASK: u32 = 0x000F;
    const FACILITY_SERVER: u32 = 0x0007;
    event & FACILITY_MASK == FACILITY_SERVER
}

/// The default output changed (speakers → headset mid-meeting): the stream
/// recording the old one must be reopened, or the system track goes silent.
/// An unknown output (`None`) never triggers a reopen on its own.
#[cfg_attr(
    not(any(target_os = "windows", target_os = "linux", test)),
    allow(dead_code)
)]
fn output_changed(recording: Option<&str>, default_now: Option<&str>) -> bool {
    default_now.is_some() && default_now != recording
}

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    pub fn is_supported() -> bool {
        cpal::default_host().default_output_device().is_some()
    }

    fn default_output_name() -> Option<String> {
        cpal::default_host().default_output_device()?.name().ok()
    }

    pub fn start(state: SharedAudioState) -> Result<(), String> {
        worker::start(move |stop, ready| {
            // Set by the stream's error callback (device unplugged/invalidated).
            let broken = Arc::new(AtomicBool::new(false));
            let mut recording = default_output_name();
            let mut stream = match open_loopback(Arc::clone(&state), Arc::clone(&broken)) {
                Ok(s) => s,
                Err(e) => return ready(Err(e)),
            };
            ready(Ok(()));
            let mut checked = Instant::now();
            // The stream lives on this thread until stop; dropping it here
            // ends the callbacks before `stop` returns.
            while !worker::stop_requested(stop) {
                std::thread::sleep(Duration::from_millis(50));
                if checked.elapsed() < WINDOWS_CHECK_INTERVAL && !broken.load(Ordering::SeqCst) {
                    continue;
                }
                checked = Instant::now();
                let now = default_output_name();
                let was_broken = broken.swap(false, Ordering::SeqCst);
                if !was_broken && !output_changed(recording.as_deref(), now.as_deref()) {
                    continue;
                }
                drop(stream);
                match open_loopback(Arc::clone(&state), Arc::clone(&broken)) {
                    Ok(s) => {
                        println!(
                            "🔁 System audio now records {}",
                            now.as_deref().unwrap_or("the default output")
                        );
                        stream = s;
                        recording = now;
                    }
                    Err(e) => {
                        // Try again on the next check (e.g. no output right now).
                        eprintln!("⚠️ System audio could not follow the output change: {e}");
                        broken.store(true, Ordering::SeqCst);
                        stream = match retry_until_open(&state, &broken, stop) {
                            Some(s) => s,
                            None => return,
                        };
                        recording = default_output_name();
                    }
                }
            }
            drop(stream);
        })
    }

    /// Waits for an output to come back (headset unplugged with nothing else
    /// active); `None` when the recording stops first.
    fn retry_until_open(
        state: &SharedAudioState,
        broken: &Arc<AtomicBool>,
        stop: &AtomicBool,
    ) -> Option<cpal::Stream> {
        while !worker::stop_requested(stop) {
            std::thread::sleep(FOLLOW_INTERVAL);
            if let Ok(s) = open_loopback(Arc::clone(state), Arc::clone(broken)) {
                broken.store(false, Ordering::SeqCst);
                return Some(s);
            }
        }
        None
    }

    /// WASAPI records what the default output device plays when an input
    /// stream is opened on it (loopback mode; cpal sets the flag).
    fn open_loopback(
        state: SharedAudioState,
        broken: Arc<AtomicBool>,
    ) -> Result<cpal::Stream, String> {
        let device = cpal::default_host()
            .default_output_device()
            .ok_or("no audio output device for system audio capture")?;
        let config = device
            .default_output_config()
            .map_err(|e| format!("system audio output format unavailable: {e}"))?;
        let channels = config.channels() as usize;
        let rate = config.sample_rate().0 as f64;
        let format = config.sample_format();
        let config: cpal::StreamConfig = config.into();
        let on_error = move |e: cpal::StreamError| {
            eprintln!("⚠️ System audio stream error: {e}");
            broken.store(true, Ordering::SeqCst);
        };
        let stream = match format {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    ingest(&state, data, channels, rate)
                },
                on_error,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let samples: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                    ingest(&state, &samples, channels, rate)
                },
                on_error,
                None,
            ),
            other => {
                return Err(format!(
                    "system audio sample format {other:?} not supported"
                ))
            }
        }
        .map_err(|e| format!("system audio capture failed (WASAPI loopback): {e}"))?;
        stream
            .play()
            .map_err(|e| format!("system audio capture failed to start: {e}"))?;
        Ok(stream)
    }

    pub fn stop() {
        worker::stop()
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use libloading::Library;
    use std::ffi::{c_char, c_int, c_void, CStr, CString};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    /// `pa_sample_spec`.
    #[repr(C)]
    pub(super) struct SampleSpec {
        pub format: c_int,
        pub rate: u32,
        pub channels: u8,
    }

    /// `pa_buffer_attr`; `u32::MAX` asks the server for its default.
    #[repr(C)]
    pub(super) struct BufferAttr {
        pub maxlength: u32,
        pub tlength: u32,
        pub prebuf: u32,
        pub minreq: u32,
        pub fragsize: u32,
    }

    /// The leading fields of `pa_server_info`, up to the default sink.
    #[repr(C)]
    pub(super) struct ServerInfo {
        pub user_name: *const c_char,
        pub host_name: *const c_char,
        pub server_version: *const c_char,
        pub server_name: *const c_char,
        pub sample_spec: SampleSpec,
        pub default_sink_name: *const c_char,
    }

    const PA_STREAM_RECORD: c_int = 2;
    const PA_SAMPLE_FLOAT32LE: c_int = 5;
    const PA_CONTEXT_READY: c_int = 4;
    const PA_CONTEXT_FAILED: c_int = 5;
    const PA_CONTEXT_TERMINATED: c_int = 6;
    const PA_OPERATION_RUNNING: c_int = 0;
    pub(super) const RATE: u32 = 48_000;
    pub(super) const CHANNELS: u8 = 2;
    /// 20 ms reads: system audio is padded to the mic timeline whenever it
    /// lags, so it must arrive in small pieces, not in seconds-long bursts.
    pub(super) const READ_FRAMES: usize = RATE as usize / 50;

    type NewFn = unsafe extern "C" fn(
        server: *const c_char,
        name: *const c_char,
        dir: c_int,
        dev: *const c_char,
        stream_name: *const c_char,
        spec: *const SampleSpec,
        map: *const c_void,
        attr: *const BufferAttr,
        error: *mut c_int,
    ) -> *mut c_void;
    type ReadFn = unsafe extern "C" fn(
        s: *mut c_void,
        data: *mut c_void,
        bytes: usize,
        error: *mut c_int,
    ) -> c_int;
    type FreeFn = unsafe extern "C" fn(s: *mut c_void);
    type StrErrorFn = unsafe extern "C" fn(error: c_int) -> *const c_char;
    type InfoCallback =
        extern "C" fn(c: *mut c_void, info: *const ServerInfo, userdata: *mut c_void);
    type SubscribeCallback =
        extern "C" fn(c: *mut c_void, event: u32, index: u32, userdata: *mut c_void);

    /// The asynchronous libpulse calls needed to ask which output is the
    /// default (pa_simple cannot).
    struct Introspect {
        mainloop_new: unsafe extern "C" fn() -> *mut c_void,
        mainloop_get_api: unsafe extern "C" fn(m: *mut c_void) -> *mut c_void,
        mainloop_iterate:
            unsafe extern "C" fn(m: *mut c_void, block: c_int, retval: *mut c_int) -> c_int,
        mainloop_free: unsafe extern "C" fn(m: *mut c_void),
        context_new: unsafe extern "C" fn(api: *mut c_void, name: *const c_char) -> *mut c_void,
        context_connect: unsafe extern "C" fn(
            c: *mut c_void,
            server: *const c_char,
            flags: c_int,
            api: *const c_void,
        ) -> c_int,
        context_get_state: unsafe extern "C" fn(c: *mut c_void) -> c_int,
        context_disconnect: unsafe extern "C" fn(c: *mut c_void),
        context_unref: unsafe extern "C" fn(c: *mut c_void),
        context_get_server_info: unsafe extern "C" fn(
            c: *mut c_void,
            cb: InfoCallback,
            userdata: *mut c_void,
        ) -> *mut c_void,
        operation_get_state: unsafe extern "C" fn(o: *mut c_void) -> c_int,
        operation_unref: unsafe extern "C" fn(o: *mut c_void),
        context_set_subscribe_callback:
            unsafe extern "C" fn(c: *mut c_void, cb: SubscribeCallback, userdata: *mut c_void),
        context_subscribe: unsafe extern "C" fn(
            c: *mut c_void,
            mask: u32,
            cb: *const c_void,
            userdata: *mut c_void,
        ) -> *mut c_void,
    }

    struct Pulse {
        new: NewFn,
        read: ReadFn,
        free: FreeFn,
        strerror: Option<StrErrorFn>,
        introspect: Option<Introspect>,
        _simple: Library,
        _pulse: Option<Library>,
    }

    /// libpulse-simple, from PulseAudio or PipeWire's pipewire-pulse; `None`
    /// when neither is installed.
    fn pulse() -> Option<&'static Pulse> {
        static PULSE: OnceLock<Option<Pulse>> = OnceLock::new();
        PULSE
            .get_or_init(|| {
                // SAFETY: plain C libraries without load-time side effects;
                // the symbols are looked up with their documented signatures.
                unsafe {
                    let simple = Library::new("libpulse-simple.so.0").ok()?;
                    let pulse = Library::new("libpulse.so.0").ok();
                    let new = *simple.get::<NewFn>(b"pa_simple_new\0").ok()?;
                    let read = *simple.get::<ReadFn>(b"pa_simple_read\0").ok()?;
                    let free = *simple.get::<FreeFn>(b"pa_simple_free\0").ok()?;
                    let strerror = pulse
                        .as_ref()
                        .and_then(|l| l.get::<StrErrorFn>(b"pa_strerror\0").ok())
                        .map(|f| *f);
                    let introspect = pulse.as_ref().and_then(|l| {
                        Some(Introspect {
                            mainloop_new: *l.get(b"pa_mainloop_new\0").ok()?,
                            mainloop_get_api: *l.get(b"pa_mainloop_get_api\0").ok()?,
                            mainloop_iterate: *l.get(b"pa_mainloop_iterate\0").ok()?,
                            mainloop_free: *l.get(b"pa_mainloop_free\0").ok()?,
                            context_new: *l.get(b"pa_context_new\0").ok()?,
                            context_connect: *l.get(b"pa_context_connect\0").ok()?,
                            context_get_state: *l.get(b"pa_context_get_state\0").ok()?,
                            context_disconnect: *l.get(b"pa_context_disconnect\0").ok()?,
                            context_unref: *l.get(b"pa_context_unref\0").ok()?,
                            context_get_server_info: *l
                                .get(b"pa_context_get_server_info\0")
                                .ok()?,
                            operation_get_state: *l.get(b"pa_operation_get_state\0").ok()?,
                            operation_unref: *l.get(b"pa_operation_unref\0").ok()?,
                            context_set_subscribe_callback: *l
                                .get(b"pa_context_set_subscribe_callback\0")
                                .ok()?,
                            context_subscribe: *l.get(b"pa_context_subscribe\0").ok()?,
                        })
                    });
                    Some(Pulse {
                        new,
                        read,
                        free,
                        strerror,
                        introspect,
                        _simple: simple,
                        _pulse: pulse,
                    })
                }
            })
            .as_ref()
    }

    fn describe(pulse: &Pulse, error: c_int) -> String {
        match pulse.strerror {
            // SAFETY: pa_strerror returns a static string (or null).
            Some(f) => unsafe {
                let text = f(error);
                if text.is_null() {
                    format!("error {error}")
                } else {
                    CStr::from_ptr(text).to_string_lossy().into_owned()
                }
            },
            None => format!("error {error}"),
        }
    }

    pub fn is_supported() -> bool {
        pulse().is_some()
    }

    /// A connection to the sound server that reports the default output.
    /// PipeWire resolves `@DEFAULT_MONITOR@` once and pins the stream to that
    /// sink, so the capture thread asks this and reopens on a change.
    struct DefaultOutput {
        api: &'static Introspect,
        mainloop: *mut c_void,
        context: *mut c_void,
        /// Set by the server-event callback; boxed so its address stays put
        /// while libpulse holds it.
        changed: Box<AtomicBool>,
    }

    extern "C" fn on_server_event(_c: *mut c_void, event: u32, _index: u32, userdata: *mut c_void) {
        if is_server_event(event) {
            // SAFETY: `userdata` is the boxed flag of a live DefaultOutput;
            // the callback runs on its thread, inside mainloop_iterate.
            unsafe { (*(userdata as *const AtomicBool)).store(true, Ordering::SeqCst) };
        }
    }

    impl DefaultOutput {
        fn connect(api: &'static Introspect) -> Option<Self> {
            // SAFETY: standard libpulse mainloop/context setup on this thread;
            // every object is freed in Drop.
            unsafe {
                let mainloop = (api.mainloop_new)();
                if mainloop.is_null() {
                    return None;
                }
                let context =
                    (api.context_new)((api.mainloop_get_api)(mainloop), c"EchoMind".as_ptr());
                let mut watcher = DefaultOutput {
                    api,
                    mainloop,
                    context,
                    changed: Box::new(AtomicBool::new(false)),
                };
                if context.is_null()
                    || (api.context_connect)(context, std::ptr::null(), 0, std::ptr::null()) < 0
                {
                    return None;
                }
                for _ in 0..1000 {
                    match (api.context_get_state)(context) {
                        PA_CONTEXT_READY => {
                            watcher.subscribe();
                            return Some(watcher);
                        }
                        PA_CONTEXT_FAILED | PA_CONTEXT_TERMINATED => return None,
                        _ => {
                            if (api.mainloop_iterate)(mainloop, 1, std::ptr::null_mut()) < 0 {
                                return None;
                            }
                        }
                    }
                }
                None
            }
        }

        /// Asks the server to report its own changes (a new default sink
        /// among them), so a switch is followed at once instead of at the
        /// next one-second check.
        fn subscribe(&mut self) {
            // SAFETY: the context is ready; the flag outlives the context
            // (Drop disconnects before the box is freed).
            unsafe {
                let flag = &*self.changed as *const AtomicBool as *mut c_void;
                (self.api.context_set_subscribe_callback)(self.context, on_server_event, flag);
                let op = (self.api.context_subscribe)(
                    self.context,
                    PA_SUBSCRIPTION_MASK_SERVER,
                    std::ptr::null(),
                    std::ptr::null_mut(),
                );
                if !op.is_null() {
                    (self.api.operation_unref)(op);
                }
            }
        }

        /// Handles pending server events without waiting; true when one
        /// arrived since the last call.
        fn server_changed(&mut self) -> bool {
            // SAFETY: non-blocking dispatch on the thread that owns the loop.
            unsafe {
                for _ in 0..16 {
                    if (self.api.mainloop_iterate)(self.mainloop, 0, std::ptr::null_mut()) <= 0 {
                        break;
                    }
                }
            }
            self.changed.swap(false, Ordering::SeqCst)
        }

        /// The default sink's name, or `None` when the server doesn't say.
        fn current(&mut self) -> Option<String> {
            extern "C" fn on_info(_c: *mut c_void, info: *const ServerInfo, userdata: *mut c_void) {
                // SAFETY: `userdata` is the `Option<String>` below, alive for
                // the whole operation; `info` is valid during the callback.
                unsafe {
                    let out = &mut *(userdata as *mut Option<String>);
                    if !info.is_null() && !(*info).default_sink_name.is_null() {
                        *out = Some(
                            CStr::from_ptr((*info).default_sink_name)
                                .to_string_lossy()
                                .into_owned(),
                        );
                    }
                }
            }
            let mut name: Option<String> = None;
            // SAFETY: the operation is driven to completion on this thread
            // before `name` goes out of scope.
            unsafe {
                let op = (self.api.context_get_server_info)(
                    self.context,
                    on_info,
                    &mut name as *mut Option<String> as *mut c_void,
                );
                if op.is_null() {
                    return None;
                }
                let mut spins = 0;
                while (self.api.operation_get_state)(op) == PA_OPERATION_RUNNING && spins < 1000 {
                    if (self.api.mainloop_iterate)(self.mainloop, 1, std::ptr::null_mut()) < 0 {
                        break;
                    }
                    spins += 1;
                }
                (self.api.operation_unref)(op);
            }
            name
        }
    }

    impl Drop for DefaultOutput {
        fn drop(&mut self) {
            // SAFETY: the objects were created in `connect` and not freed since.
            unsafe {
                if !self.context.is_null() {
                    (self.api.context_disconnect)(self.context);
                    (self.api.context_unref)(self.context);
                }
                (self.api.mainloop_free)(self.mainloop);
            }
        }
    }

    /// The monitor of a sink: what it plays. Without a name, the server's
    /// default monitor.
    pub(super) fn monitor_of(sink: Option<&str>) -> CString {
        sink.and_then(|s| CString::new(format!("{s}.monitor")).ok())
            .unwrap_or_else(|| c"@DEFAULT_MONITOR@".to_owned())
    }

    struct Recorder {
        pulse: &'static Pulse,
        handle: *mut c_void,
    }

    // SAFETY: a pa_simple connection is used from the one thread that owns it.
    unsafe impl Send for Recorder {}

    impl Drop for Recorder {
        fn drop(&mut self) {
            // SAFETY: the connection is not used after this.
            unsafe { (self.pulse.free)(self.handle) };
        }
    }

    fn open(pulse: &'static Pulse, device: &CStr) -> Result<Recorder, String> {
        let spec = SampleSpec {
            format: PA_SAMPLE_FLOAT32LE,
            rate: RATE,
            channels: CHANNELS,
        };
        let attr = BufferAttr {
            maxlength: u32::MAX,
            tlength: u32::MAX,
            prebuf: u32::MAX,
            minreq: u32::MAX,
            fragsize: (READ_FRAMES * CHANNELS as usize * 4) as u32,
        };
        let mut error: c_int = 0;
        // SAFETY: every pointer is valid for the call; strings are NUL-terminated.
        let handle = unsafe {
            (pulse.new)(
                std::ptr::null(),
                c"EchoMind".as_ptr(),
                PA_STREAM_RECORD,
                device.as_ptr(),
                c"System audio".as_ptr(),
                &spec,
                std::ptr::null(),
                &attr,
                &mut error,
            )
        };
        if handle.is_null() {
            return Err(format!(
                "system audio capture failed (PulseAudio/PipeWire: {})",
                describe(pulse, error)
            ));
        }
        Ok(Recorder { pulse, handle })
    }

    /// Opens the monitor of `sink`, or the default monitor if that fails.
    fn open_following(pulse: &'static Pulse, sink: Option<&str>) -> Result<Recorder, String> {
        open(pulse, &monitor_of(sink)).or_else(|e| {
            if sink.is_some() {
                open(pulse, &monitor_of(None))
            } else {
                Err(e)
            }
        })
    }

    pub fn start(state: SharedAudioState) -> Result<(), String> {
        let pulse = pulse().ok_or("system audio needs PulseAudio or PipeWire (libpulse)")?;
        worker::start(move |stop, ready| {
            let mut watcher = pulse.introspect.as_ref().and_then(DefaultOutput::connect);
            let mut recording = watcher.as_mut().and_then(DefaultOutput::current);
            let mut recorder = match open_following(pulse, recording.as_deref()) {
                Ok(r) => r,
                Err(e) => return ready(Err(e)),
            };
            ready(Ok(()));
            let mut buf = vec![0f32; READ_FRAMES * CHANNELS as usize];
            let mut checked = Instant::now();
            while !worker::stop_requested(stop) {
                let mut error: c_int = 0;
                // SAFETY: `buf` holds exactly the bytes asked for; the read
                // blocks for about 20 ms, so the stop flag is seen promptly.
                let status = unsafe {
                    (pulse.read)(
                        recorder.handle,
                        buf.as_mut_ptr() as *mut c_void,
                        buf.len() * 4,
                        &mut error,
                    )
                };
                let failed = status < 0;
                if failed {
                    eprintln!("⚠️ System audio stream ended: {}", describe(pulse, error));
                } else {
                    ingest(&state, &buf, CHANNELS as usize, RATE as f64);
                }
                // A server event means "ask now"; without events, ask once a
                // second as before.
                let event = watcher.as_mut().is_some_and(DefaultOutput::server_changed);
                let due = checked.elapsed() >= FOLLOW_INTERVAL;
                if !failed && !event && !due {
                    continue;
                }
                checked = Instant::now();
                let now = watcher.as_mut().and_then(DefaultOutput::current);
                if !failed && !output_changed(recording.as_deref(), now.as_deref()) {
                    continue;
                }
                // The default output changed or the stream broke: reopen on
                // the current default, retrying until it opens or we stop.
                let target = now.or_else(|| recording.clone());
                drop(recorder);
                recorder = loop {
                    match open_following(pulse, target.as_deref()) {
                        Ok(r) => break r,
                        Err(e) => {
                            eprintln!("⚠️ System audio could not reopen: {e}");
                            std::thread::sleep(FOLLOW_INTERVAL);
                            if worker::stop_requested(stop) {
                                return;
                            }
                            if watcher.is_none() {
                                watcher =
                                    pulse.introspect.as_ref().and_then(DefaultOutput::connect);
                            }
                        }
                    }
                };
                println!(
                    "🔁 System audio now records {}",
                    target.as_deref().unwrap_or("the default output")
                );
                recording = target;
            }
        })
    }

    pub fn stop() {
        worker::stop()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod imp {
    use super::*;
    pub fn is_supported() -> bool {
        false
    }
    pub fn start(_state: SharedAudioState) -> Result<(), String> {
        Err("system audio capture is not available on this platform yet".into())
    }
    pub fn stop() {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::AudioState;
    use std::sync::{Arc, Mutex};

    #[test]
    fn test_ingest_pads_silence_when_mic_is_ahead() {
        let state = Arc::new(Mutex::new(AudioState {
            is_recording: true,
            pcm_16k_buffer: vec![3277; 4800], // 300 ms of mic already buffered
            sys_capture_started: true,
            ..AudioState::default()
        }));
        // One frame of system audio at 48 kHz mono → ~16 samples @ 16 kHz after resample.
        let frame = vec![0.5f32; 48];
        ingest(&state, &frame, 1, 48000.0);
        let st = state.lock().unwrap();
        assert!(st.sys_capture_active);
        // Must have been padded up to the mic timeline before the new samples.
        assert!(
            st.sys_pcm_16k_buffer.len() >= 4800,
            "sys len {} should cover mic timeline",
            st.sys_pcm_16k_buffer.len()
        );
        // Leading pad is silence.
        assert!(st.sys_pcm_16k_buffer[..4800].iter().all(|&s| s == 0));
    }

    /// The layouts libpulse expects (`pa_sample_spec`, `pa_buffer_attr`).
    #[cfg(target_os = "linux")]
    #[test]
    fn test_pulse_structs_match_the_c_layout() {
        assert_eq!(std::mem::size_of::<imp::SampleSpec>(), 12);
        assert_eq!(std::mem::size_of::<imp::BufferAttr>(), 20);
        assert_eq!(imp::READ_FRAMES, 960, "20 ms at 48 kHz");
    }

    /// The leading `pa_server_info` fields: four strings, the sample spec,
    /// then the default sink name at byte 48 on 64-bit Linux.
    #[cfg(target_os = "linux")]
    #[test]
    fn test_server_info_reaches_the_default_sink() {
        assert_eq!(std::mem::offset_of!(imp::ServerInfo, default_sink_name), 48);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_monitor_of_a_sink() {
        assert_eq!(
            imp::monitor_of(Some("alsa_output.usb-headset"))
                .to_str()
                .unwrap(),
            "alsa_output.usb-headset.monitor"
        );
        assert_eq!(imp::monitor_of(None).to_str().unwrap(), "@DEFAULT_MONITOR@");
    }

    /// Without PulseAudio/PipeWire this reports unsupported instead of failing.
    #[cfg(target_os = "linux")]
    #[test]
    fn test_linux_support_check_never_panics() {
        let _ = is_supported();
    }

    #[test]
    fn test_a_new_default_output_reopens_the_stream() {
        assert!(
            output_changed(Some("speakers"), Some("headset")),
            "speakers → headset"
        );
        assert!(!output_changed(Some("speakers"), Some("speakers")));
        assert!(
            !output_changed(Some("speakers"), None),
            "unknown is not a change"
        );
        assert!(
            output_changed(None, Some("headset")),
            "learned the output later"
        );
    }

    /// libpulse event = facility | type; only the server facility (where the
    /// default sink is) triggers a check.
    #[test]
    fn test_only_server_events_trigger_a_check() {
        assert!(is_server_event(0x0007), "server, new");
        assert!(is_server_event(0x0010 | 0x0007), "server, change");
        assert!(!is_server_event(0x0010), "sink change");
        assert!(!is_server_event(0x0010 | 0x0001), "source change");
        assert!(!is_server_event(0x0020 | 0x0002), "sink input removed");
        assert_eq!(PA_SUBSCRIPTION_MASK_SERVER, 1 << 7);
    }

    #[test]
    fn test_ingest_stops_at_the_recording_limit() {
        let state = Arc::new(Mutex::new(AudioState {
            is_recording: true,
            limit_reached: true,
            pcm_16k_buffer: vec![0; 4800],
            sys_capture_started: true,
            ..AudioState::default()
        }));
        ingest(&state, &[0.5f32; 48], 1, 48000.0);
        assert!(state.lock().unwrap().sys_pcm_16k_buffer.is_empty());
    }
}
