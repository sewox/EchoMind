use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioStatus {
    pub is_recording: bool,
    pub mic_level: f32,       // 0.0 - 1.0 (VU Meter)
    pub sys_level: f32,       // 0.0 - 1.0 (VU Meter)
    pub is_speaking: bool,     // VAD Voice Activity Detection with Hangover
    pub sample_rate: u32,      // Standard 16000 Hz for Whisper
    pub channels: u16,         // 1 (Mono)
    pub buffered_samples: usize,
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
        }
    }
}

pub type SharedAudioState = Arc<Mutex<AudioState>>;

pub struct GlobalAudioEngine {
    pub state: SharedAudioState,
    pub stop_tx: Mutex<Option<Sender<()>>>,
    pub preview_tx: Mutex<Option<Sender<()>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
    pub is_loopback: bool,
    pub max_channels: u16,
    pub default_sample_rate: u32,
}

impl GlobalAudioEngine {
    pub fn new() -> Self {
        GlobalAudioEngine {
            state: Arc::new(Mutex::new(AudioState::default())),
            stop_tx: Mutex::new(None),
            preview_tx: Mutex::new(None),
        }
    }

    pub fn list_devices() -> Vec<AudioDeviceInfo> {
        let host = cpal::default_host();
        let default_device_name = host.default_input_device().and_then(|d| d.name().ok());
        let mut list = Vec::new();

        if let Ok(devices) = host.input_devices() {
            for dev in devices {
                if let Ok(name) = dev.name() {
                    let is_default = default_device_name.as_ref().map(|d| d == &name).unwrap_or(false);
                    let lower = name.to_lowercase();
                    let is_loopback = lower.contains("blackhole")
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
                        || lower.contains("pulseaudio");

                    let (channels, sample_rate) = match dev.default_input_config() {
                        Ok(cfg) => (cfg.channels(), cfg.sample_rate().0),
                        Err(_) => (1, 16000),
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

        let (tx, rx) = channel::<()>();
        let state_clone = Arc::clone(&self.state);

        {
            let mut state = state_clone.lock().unwrap();
            state.is_recording = true;
            state.silence_counter = 999;
            state.is_speaking = false;
            state.pcm_16k_buffer.clear();
            state.hp_prev_in = 0.0;
            state.hp_prev_out = 0.0;
        }

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
                    eprintln!("Kayıt yapılacak ses giriş aygıtı bulunamadı");
                    return;
                }
            };

            let config = match device.default_input_config() {
                Ok(cfg) => cfg,
                Err(e) => {
                    eprintln!("Ses aygıt konfigürasyon hatası: {}", e);
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
                    move |data: &[f32], _| process_audio_data(data, sample_rate, channels, &state_inner),
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _| {
                        let f32_data: Vec<f32> = data.iter().map(|s| s.to_sample::<f32>()).collect();
                        process_audio_data(&f32_data, sample_rate, channels, &state_inner);
                    },
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::U16 => device.build_input_stream(
                    &config.into(),
                    move |data: &[u16], _| {
                        let f32_data: Vec<f32> = data.iter().map(|s| s.to_sample::<f32>()).collect();
                        process_audio_data(&f32_data, sample_rate, channels, &state_inner);
                    },
                    err_fn,
                    None,
                ),
                _ => {
                    eprintln!("Desteklenmeyen ses örnekleme formatı");
                    return;
                }
            };

            if let Ok(stream) = stream_result {
                if let Err(e) = stream.play() {
                    eprintln!("Ses akışı çalıştırılamadı: {}", e);
                    return;
                }

                // Block thread until stop signal is received
                let _ = rx.recv();
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

        let mut state = self.state.lock().unwrap();
        state.is_recording = false;
        state.mic_level = 0.0;
        state.sys_level = 0.0;
        state.is_speaking = false;

        Ok(())
    }

    pub fn start_preview(&self, target_device_name: Option<String>) -> Result<(), String> {
        let is_rec = self.state.lock().unwrap().is_recording;
        if is_rec {
            return Ok(()); // Already actively recording and calculating mic levels
        }

        self.stop_preview()?;

        let (tx, rx) = channel::<()>();
        let state_clone = Arc::clone(&self.state);

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
                None => return,
            };

            let config = match device.default_input_config() {
                Ok(cfg) => cfg,
                Err(_) => return,
            };

            let sample_rate = config.sample_rate().0;
            let channels = config.channels();
            let state_inner = Arc::clone(&state_clone);

            let err_fn = |_| ();

            let stream_result = match config.sample_format() {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _| process_audio_data(data, sample_rate, channels, &state_inner),
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _| {
                        let f32_data: Vec<f32> = data.iter().map(|s| s.to_sample::<f32>()).collect();
                        process_audio_data(&f32_data, sample_rate, channels, &state_inner);
                    },
                    err_fn,
                    None,
                ),
                cpal::SampleFormat::U16 => device.build_input_stream(
                    &config.into(),
                    move |data: &[u16], _| {
                        let f32_data: Vec<f32> = data.iter().map(|s| s.to_sample::<f32>()).collect();
                        process_audio_data(&f32_data, sample_rate, channels, &state_inner);
                    },
                    err_fn,
                    None,
                ),
                _ => return,
            };

            if let Ok(stream) = stream_result {
                if stream.play().is_ok() {
                    let _ = rx.recv();
                }
            }
        });

        let mut preview_lock = self.preview_tx.lock().unwrap();
        *preview_lock = Some(tx);
        Ok(())
    }

    pub fn stop_preview(&self) -> Result<(), String> {
        let mut preview_lock = self.preview_tx.lock().unwrap();
        if let Some(tx) = preview_lock.take() {
            let _ = tx.send(());
        }

        let mut state = self.state.lock().unwrap();
        if !state.is_recording {
            state.mic_level = 0.0;
            state.is_speaking = false;
        }

        Ok(())
    }

    pub fn get_status(&self) -> AudioStatus {
        let state = self.state.lock().unwrap();
        AudioStatus {
            is_recording: state.is_recording,
            mic_level: (state.mic_level * 100.0).round() / 100.0,
            sys_level: (state.sys_level * 100.0).round() / 100.0,
            is_speaking: state.is_speaking,
            sample_rate: 16000,
            channels: 1,
            buffered_samples: state.pcm_16k_buffer.len(),
        }
    }

    pub fn get_pcm_buffer(&self) -> Vec<f32> {
        let state = self.state.lock().unwrap();
        state.pcm_16k_buffer.clone()
    }
}

// Audio DSP Pre-processing:
// 1. High-Pass Filter (80Hz cut-off for rumble/fan noise reduction)
// 2. Resample to 16000 Hz Mono
// 3. RMS & VAD calculation with speech hangover
// 4. Clean PCM buffer accumulation
fn process_audio_data(data: &[f32], src_sample_rate: u32, channels: u16, state_arc: &SharedAudioState) {
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
        if state.silence_counter > 35 { // ~1.5s silence hangover
            state.is_speaking = false;
        }
    }

    // 5. Resample to 16000 Hz Mono
    let target_sample_rate = 16000.0;
    let ratio = src_sample_rate as f64 / target_sample_rate as f64;
    let resampled_len = (filtered_mono.len() as f64 / ratio) as usize;

    let mut resampled_pcm = Vec::with_capacity(resampled_len);
    for i in 0..resampled_len {
        let src_idx = (i as f64 * ratio) as usize;
        if src_idx < filtered_mono.len() {
            resampled_pcm.push(filtered_mono[src_idx]);
        }
    }

    // Accumulate in 16kHz PCM buffer ONLY during active recording
    if state.is_recording {
        state.pcm_16k_buffer.extend_from_slice(&resampled_pcm);
        if state.pcm_16k_buffer.len() > 2_880_000 {
            let overflow = state.pcm_16k_buffer.len() - 2_880_000;
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

#[tauri::command]
pub fn start_audio_capture(device_name: Option<String>) -> Result<AudioStatus, String> {
    let engine = get_global_audio_engine();
    engine.start(device_name)?;
    Ok(engine.get_status())
}

#[tauri::command]
pub fn start_meeting_recording(
    app_handle: tauri::AppHandle,
    device_name: Option<String>,
    meeting_title: Option<String>,
) -> Result<AudioStatus, String> {
    use tauri::{Emitter, Manager};
    let engine = get_global_audio_engine();
    engine.start(device_name)?;
    let title = meeting_title.unwrap_or_else(|| "Google Meet Toplantısı".to_string());
    println!("🎙️ start_meeting_recording çağrıldı: {:?}", title);
    let _ = app_handle.emit("trigger-start-recording", serde_json::json!({
        "title": title
    }));
    if let Some(island_win) = app_handle.get_webview_window("island") {
        let _ = island_win.hide();
    }
    Ok(engine.get_status())
}

#[tauri::command]
pub fn stop_audio_capture() -> Result<AudioStatus, String> {
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
    GlobalAudioEngine::list_devices()
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

    #[test]
    fn test_audio_filter_and_normalize() {
        let mut mock_pcm = vec![0.05, -0.05, 0.1, -0.1, 0.02, -0.02];
        normalize_audio_samples(&mut mock_pcm);
        let max_peak = mock_pcm.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!((max_peak - 0.90).abs() < 0.01);
    }
}
