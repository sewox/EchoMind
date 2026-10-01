//! System-audio capture (the remote side of a call), recorded next to the
//! microphone so transcription hears everyone and speakers can be attributed
//! by channel: microphone = the local user, system audio = remote people.
//!
//! macOS 14.2+: Core Audio process tap (Swift bridge in `swift/EchoMindAudio`).
//! Other platforms: not yet available (`is_supported()` = false).
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
#[cfg_attr(all(not(target_os = "macos"), not(test)), allow(dead_code))]
pub(crate) fn ingest(state: &SharedAudioState, interleaved: &[f32], channels: usize, rate: f64) {
    if interleaved.is_empty() || channels == 0 {
        return;
    }
    let mono: Vec<f32> = interleaved
        .chunks(channels)
        .map(|c| c.iter().sum::<f32>() / channels as f32)
        .collect();
    let mut st = state.lock().unwrap();
    if !st.is_recording {
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
    st.sys_pcm_16k_buffer.extend_from_slice(&out);
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

#[cfg(not(target_os = "macos"))]
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
            pcm_16k_buffer: vec![0.1; 4800], // 300 ms of mic already buffered
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
        assert!(st.sys_pcm_16k_buffer[..4800].iter().all(|&s| s == 0.0));
    }
}
