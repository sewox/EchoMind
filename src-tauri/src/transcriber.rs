use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: usize,
    pub speaker_id: String,   // e.g. "Konuşmacı 1", "Konuşmacı 2"
    pub speaker_name: String, // e.g. "Konuşmacı 1 (Siz)", "Konuşmacı 2 (Katılımcı)"
    pub start_time_ms: u64,
    pub end_time_ms: u64,
    pub timestamp_formatted: String, // e.g. "00:12 -> 00:18"
    pub text: String,
    pub language: String, // "tr" or "en"
    pub confidence: f32,  // 0.0 - 1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelStatus {
    pub model_name: String,
    pub is_loaded: bool,
    pub is_downloading: bool,
    pub download_progress: f32,
    pub hardware_acceleration: String,
    /// True when the requested/selected model failed to load (e.g. not yet
    /// downloaded) and the engine silently fell back to a smaller, lower-quality
    /// model instead. Grok Bot's v0.2.5 QA report flagged exactly this case on
    /// Linux: base loaded instead of small with no visible signal to the user.
    pub used_fallback_model: bool,
}

pub struct TranscriberState {
    pub current_language: String,
    pub selected_model_path: String,
    pub model_display_name: String,
    pub is_model_loaded: bool,
    pub used_fallback_model: bool,
    pub segments: Vec<TranscriptSegment>,
    pub segment_counter: usize,
}

impl Default for TranscriberState {
    fn default() -> Self {
        TranscriberState {
            current_language: "tr".to_string(),
            selected_model_path: "models/ggml-small.bin".to_string(),
            model_display_name: "Whisper Small 244M (Kullanım Anında Yüklenecek)".to_string(),
            is_model_loaded: false,
            used_fallback_model: false,
            segments: Vec::new(),
            segment_counter: 0,
        }
    }
}

pub type SharedTranscriberState = Arc<Mutex<TranscriberState>>;

pub struct GlobalTranscriberEngine {
    pub state: SharedTranscriberState,
    pub whisper_ctx: Mutex<Option<WhisperContext>>,
    pub is_transcribing: Arc<AtomicBool>,
}

struct TranscribeGuard<'a>(&'a AtomicBool);
impl<'a> Drop for TranscribeGuard<'a> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl Default for GlobalTranscriberEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl GlobalTranscriberEngine {
    pub fn new() -> Self {
        // Zero-RAM Idle Startup:
        // Do NOT load heavy 500MB Whisper models into RAM/GPU on startup!
        // Model will be lazy-loaded on demand when user starts transcription or imports audio.
        GlobalTranscriberEngine {
            state: Arc::new(Mutex::new(TranscriberState::default())),
            whisper_ctx: Mutex::new(None),
            is_transcribing: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn ensure_model_loaded(&self) -> Result<(), String> {
        let lock = self.whisper_ctx.lock().unwrap();
        if lock.is_some() {
            return Ok(());
        }
        drop(lock);

        let model_path = {
            let state = self.state.lock().unwrap();
            state.selected_model_path.clone()
        };

        let fallback_path = "models/ggml-base.bin";
        if self.init_model(&model_path).is_err() {
            self.init_model(fallback_path)?;
            let fell_back = model_path != fallback_path;
            let mut state = self.state.lock().unwrap();
            state.used_fallback_model = fell_back;
            if fell_back {
                eprintln!(
                    "⚠️ [Model Fallback] İstenen model yüklenemedi ({}), Base modele düşüldü — kalite daha düşük olabilir.",
                    model_path
                );
            }
        } else {
            let mut state = self.state.lock().unwrap();
            state.used_fallback_model = false;
        }
        Ok(())
    }

    pub fn init_model(&self, model_path: &str) -> Result<(), String> {
        let path = Path::new(model_path);
        let actual_path = if path.exists() {
            path.to_path_buf()
        } else {
            let alt = Path::new("src-tauri").join(model_path);
            if alt.exists() {
                alt
            } else {
                return Err(format!("Whisper model dosyası bulunamadı: {}", model_path));
            }
        };

        let mut ctx_params = WhisperContextParameters::default();
        ctx_params.use_gpu(true);

        let (ctx, is_gpu_active) =
            match WhisperContext::new_with_params(actual_path.to_str().unwrap(), ctx_params) {
                Ok(c) => (c, true),
                Err(e) => {
                    println!(
                        "GPU donanım hızlandırma bulunamadı, CPU moduna geçiliyor: {}",
                        e
                    );
                    let mut cpu_params = WhisperContextParameters::default();
                    cpu_params.use_gpu(false);
                    let c =
                        WhisperContext::new_with_params(actual_path.to_str().unwrap(), cpu_params)
                            .map_err(|err| {
                                format!("Whisper GGML model yüklenirken hata oluştu: {}", err)
                            })?;
                    (c, false)
                }
            };

        let mut lock = self.whisper_ctx.lock().unwrap();
        *lock = Some(ctx);

        let mut state = self.state.lock().unwrap();
        state.is_model_loaded = true;
        state.selected_model_path = actual_path.to_str().unwrap().to_string();

        let gpu_label = if is_gpu_active {
            "Metal/CUDA GPU"
        } else {
            "CPU AVX2 Vector"
        };
        state.model_display_name = if model_path.contains("small") {
            format!("ggml-small.bin (Whisper Small 244M - {})", gpu_label)
        } else {
            format!("ggml-base.bin (Whisper Base 74M - {})", gpu_label)
        };

        println!(
            "Whisper GGML Model talep üzerine başarıyla yüklendi [Donanım: {}]: {:?}",
            gpu_label, actual_path
        );
        Ok(())
    }

    pub fn cleanup_context(&self) {
        // 1. If an active inference pass is ongoing, wait gracefully for it to settle (up to 800ms)
        let wait_start = std::time::Instant::now();
        while self.is_transcribing.load(Ordering::SeqCst) {
            if wait_start.elapsed() > std::time::Duration::from_millis(800) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }

        // 2. Safely acquire Whisper context lock and extract handle
        let mut lock = self.whisper_ctx.lock().unwrap();
        if let Some(ctx) = lock.take() {
            // macOS Metal requires in-flight command buffers to drain prior to context drop
            std::thread::sleep(std::time::Duration::from_millis(75));
            drop(ctx);
        }
        let mut state = self.state.lock().unwrap();
        state.is_model_loaded = false;
        state.model_display_name = "Whisper Small 244M (Bellekten Boşaltıldı)".to_string();
        println!("Whisper GGML modeli bellekten boşaltıldı (Metal GPU ve RAM serbest bırakıldı).");
    }
}

impl Drop for GlobalTranscriberEngine {
    fn drop(&mut self) {
        self.cleanup_context();
    }
}

impl GlobalTranscriberEngine {
    pub fn transcribe_pcm(
        &self,
        samples: &[f32],
        language: &str,
    ) -> Result<Vec<TranscriptSegment>, String> {
        if samples.is_empty() {
            let state = self.state.lock().unwrap();
            return Ok(state.segments.clone());
        }

        self.is_transcribing.store(true, Ordering::SeqCst);
        let _transcribe_guard = TranscribeGuard(&self.is_transcribing);

        // Lazy load Whisper model on demand if not already in memory
        self.ensure_model_loaded()?;

        let mut ctx_lock = self.whisper_ctx.lock().unwrap();
        let ctx = ctx_lock
            .as_mut()
            .ok_or_else(|| "Whisper modeli henüz yüklü değil".to_string())?;

        // VAD-Based Intelligent Natural Pause Audio Slicing:
        // Slices audio strictly at natural silence dips between sentences (approx 4-5 minutes nominal).
        // This eliminates cutting words in the middle and avoids Whisper hallucination loops.
        let natural_chunks = split_audio_at_natural_pauses(samples, 16000, 240);

        let cpu_count = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(8);
        let n_threads = (cpu_count.saturating_sub(1)).clamp(4, 12) as i32;
        let is_auto = language.is_empty() || language.eq_ignore_ascii_case("auto");
        let whisper_lang = if is_auto { None } else { Some(language) };

        // When the language is auto-detected, a low detection probability (e.g. p≈0.24)
        // is a strong signal that the audio is noisy/ambiguous even if Whisper still
        // produces fluent-looking, high-token-probability garbage text. Run one cheap
        // encode-only pass on the first chunk to get that probability and fold it into
        // every segment's confidence score below, instead of trusting token probability
        // alone (which doesn't catch this failure mode).
        let lang_confidence_factor: f32 = if is_auto {
            natural_chunks
                .first()
                .and_then(|(_, first_chunk_samples)| {
                    ctx.create_state()
                        .and_then(|mut lang_state| {
                            lang_state.pcm_to_mel(first_chunk_samples, n_threads as usize)?;
                            lang_state.encode(0, n_threads as usize)?;
                            lang_state.lang_detect(0, n_threads as usize)
                        })
                        .ok()
                })
                .and_then(|(lang_id, probs)| probs.get(lang_id as usize).copied())
                .unwrap_or(1.0)
        } else {
            1.0
        };

        let prompt = match language {
            "tr" => "Bu bir Türkçe iş toplantısı ve diyalog ses kaydı dökümüdür. Lütfen Türkçe imla kurallarına, noktalama işaretlerine ve tam cümle yapılarına uygun olarak döküm yapınız.",
            "en" => "This is an English business meeting, discussion, and dialogue audio recording. Please transcribe accurately with proper English punctuation, grammar, and technical terminology.",
            "de" => "Dies ist eine geschäftliche Besprechung und Dialogaufnahme. Bitte transkribieren Sie mit korrekter Grammatik und Zeichensetzung.",
            "fr" => "Il s'agit d'un enregistrement d'une réunion professionnelle et d'un dialogue. Veuillez transcrire avec une ponctuation correcte et une grammaire naturelle.",
            "es" => "Esta es una grabación de una reunión de negocios y diálogo. Transcriba con la puntuación correcta y una gramática adecuada.",
            _ => "Multilingual business meeting and dialogue audio recording. Please accurately transcribe spoken speech with natural punctuation and terminology.",
        };

        let mut new_segments = Vec::new();
        let mut segment_counter = {
            let state = self.state.lock().unwrap();
            state.segment_counter
        };

        let total_duration_ms = ((samples.len() as f64 / 16000.0) * 1000.0) as u64;

        for (chunk_idx, (chunk_time_offset_ms, chunk_samples)) in natural_chunks.iter().enumerate()
        {
            let mut state_ctx = ctx
                .create_state()
                .map_err(|e| format!("Whisper state hatası: {}", e))?;
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 5 });
            params.set_n_threads(n_threads);
            params.set_language(whisper_lang);
            params.set_initial_prompt(prompt);
            params.set_no_context(true); // Isolate chunks from previous hallucination loops
            params.set_single_segment(false);
            params.set_temperature(0.0);
            params.set_temperature_inc(0.2); // Fallback to higher temperatures if trapped in repetition
            params.set_entropy_thold(2.4);
            params.set_logprob_thold(-1.0);
            params.set_no_speech_thold(0.50);
            params.set_suppress_blank(true);
            params.set_suppress_nst(true);
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_translate(false);

            if let Err(e) = state_ctx.full(params, chunk_samples) {
                println!("Whisper chunk {} transkripsiyon hatası: {}", chunk_idx, e);
                continue;
            }

            let num_segments = state_ctx.full_n_segments();

            for i in 0..num_segments {
                if let Some(seg) = state_ctx.get_segment(i) {
                    let raw_text = seg.to_str().unwrap_or_default().trim();
                    let segment_text = crate::security::sanitize_transcript_text(raw_text);
                    if segment_text.is_empty() || segment_text.len() < 2 {
                        continue;
                    }

                    // 1. Anti-Hallucination N-Gram Loop Detection & Truncation
                    let (cleaned_text, has_loop, loop_ratio) =
                        crate::summarizer::cleaner::SpeechCleaner::detect_and_clean_hallucination_loops(&segment_text);

                    // If the segment is overwhelmingly repetitive garbage (e.g. 50x "ve kanalıma"), discard it completely!
                    if has_loop
                        && (loop_ratio > 0.60 || cleaned_text.split_whitespace().count() < 2)
                    {
                        println!("🚫 [ASR Hallucination Guard] Tekrarlayan döngü segmenti reddedildi (oran: {:.2}): {:?}", loop_ratio, segment_text);
                        continue;
                    }

                    let final_text = if has_loop { cleaned_text } else { segment_text };
                    if final_text.trim().is_empty() {
                        continue;
                    }

                    // 2. Timestamp Clamping to Total Audio Duration
                    let seg_start_ms = (seg.start_timestamp() as u64) * 10;
                    let seg_end_ms = (seg.end_timestamp() as u64) * 10;

                    let start_time_ms = chunk_time_offset_ms + seg_start_ms;
                    let mut end_time_ms = chunk_time_offset_ms + seg_end_ms;

                    // Discard ghost segments beyond the physical audio length
                    if start_time_ms >= total_duration_ms {
                        continue;
                    }
                    // Clamp end time to strictly never exceed actual audio duration
                    if end_time_ms > total_duration_ms {
                        end_time_ms = total_duration_ms;
                    }
                    if start_time_ms >= end_time_ms {
                        continue;
                    }

                    let start_sec = start_time_ms / 1000;
                    let end_sec = end_time_ms / 1000;
                    let timestamp_formatted = format!(
                        "{:02}:{:02} -> {:02}:{:02}",
                        start_sec / 60,
                        start_sec % 60,
                        end_sec / 60,
                        end_sec % 60
                    );

                    // 3. Dynamic Confidence & Quality Score Calculation
                    let n_tokens = seg.n_tokens();
                    let mut token_prob_sum = 0.0f32;
                    let mut token_prob_count = 0usize;
                    for t in 0..n_tokens {
                        if let Some(tok) = seg.get_token(t) {
                            let p = tok.token_probability();
                            if p > 0.0 {
                                token_prob_sum += p;
                                token_prob_count += 1;
                            }
                        }
                    }
                    let avg_token_prob = if token_prob_count > 0 {
                        token_prob_sum / (token_prob_count as f32)
                    } else {
                        0.85
                    };

                    let no_speech_p = seg.no_speech_probability();
                    let mut calc_confidence =
                        avg_token_prob * (1.0 - (no_speech_p * 0.5)) * lang_confidence_factor;

                    if has_loop {
                        // Penalize confidence if any repetition loop was stripped
                        calc_confidence *= (1.0 - loop_ratio).max(0.20);
                    }

                    let confidence = (calc_confidence.clamp(0.10, 0.98) * 100.0).round() / 100.0;

                    segment_counter += 1;
                    let id = segment_counter;

                    let segment = TranscriptSegment {
                        id,
                        speaker_id: "Konuşmacı 1".to_string(),
                        speaker_name: "Konuşmacı 1".to_string(),
                        start_time_ms,
                        end_time_ms,
                        timestamp_formatted,
                        text: final_text,
                        language: if is_auto {
                            "auto".to_string()
                        } else {
                            language.to_string()
                        },
                        confidence,
                    };

                    new_segments.push(segment);
                }
            }
        }

        // 1. Cluster speakers into real acoustic voice groups based on physical pitch/timbre
        crate::diarization::cluster_speakers(&mut new_segments, samples, 16000, 6);

        // 2. Automatically resolve speaker names from Turkish vocative addressing and introductions
        crate::diarization::resolve_speaker_names(&mut new_segments);

        let mut state = self.state.lock().unwrap();
        state.segment_counter = segment_counter;
        state.segments.extend(new_segments);

        Ok(state.segments.clone())
    }

    pub fn get_history(&self) -> Vec<TranscriptSegment> {
        let state = self.state.lock().unwrap();
        state.segments.clone()
    }

    pub fn clear_history(&self) {
        let mut state = self.state.lock().unwrap();
        state.segments.clear();
        state.segment_counter = 0;
    }

    pub fn get_model_status(&self) -> ModelStatus {
        let state = self.state.lock().unwrap();
        let accel = if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
            "Metal & CoreML (Apple Neural Engine / GPU)".to_string()
        } else if cfg!(target_os = "windows") {
            "NVIDIA CUDA / DirectX GPU".to_string()
        } else {
            "CPU Multi-Core AVX2 Vector Engine".to_string()
        };

        ModelStatus {
            model_name: state.model_display_name.clone(),
            is_loaded: state.is_model_loaded,
            is_downloading: false,
            download_progress: 100.0,
            hardware_acceleration: accel,
            used_fallback_model: state.used_fallback_model,
        }
    }
}

/// Slices audio into chunks at natural silence/pause boundaries (VAD-based segmentation).
/// This eliminates cutting words in the middle and avoids Whisper hallucination loops on long audio.
pub fn split_audio_at_natural_pauses(
    samples: &[f32],
    sample_rate: u32,
    target_chunk_sec: usize,
) -> Vec<(u64, Vec<f32>)> {
    if samples.is_empty() {
        return Vec::new();
    }

    let target_chunk_samples = target_chunk_sec * (sample_rate as usize);
    if samples.len() <= target_chunk_samples {
        return vec![(0, samples.to_vec())];
    }

    let search_window_samples = 15 * (sample_rate as usize); // 15 seconds search window
    let frame_size = (sample_rate as usize) / 4; // 250ms RMS frame

    let mut result = Vec::new();
    let mut current_idx = 0;

    while current_idx < samples.len() {
        let remaining = samples.len() - current_idx;
        if remaining <= target_chunk_samples + search_window_samples {
            // Last chunk
            let offset_ms = ((current_idx as u64) * 1000) / (sample_rate as u64);
            result.push((offset_ms, samples[current_idx..].to_vec()));
            break;
        }

        // Ideal target split index
        let ideal_split = current_idx + target_chunk_samples;
        let search_start = ideal_split.saturating_sub(search_window_samples);
        let search_end = (ideal_split + search_window_samples).min(samples.len() - frame_size);

        // Find frame with minimum RMS energy (silence / sentence pause)
        let mut min_energy = f32::MAX;
        let mut best_split_point = ideal_split;

        let mut test_idx = search_start;
        while test_idx <= search_end {
            let frame = &samples[test_idx..test_idx + frame_size];
            let energy: f32 = frame.iter().map(|&s| s * s).sum();
            if energy < min_energy {
                min_energy = energy;
                best_split_point = test_idx + (frame_size / 2);
            }
            test_idx += frame_size / 2; // 125ms step
        }

        let offset_ms = ((current_idx as u64) * 1000) / (sample_rate as u64);
        let chunk_slice = samples[current_idx..best_split_point].to_vec();
        result.push((offset_ms, chunk_slice));

        current_idx = best_split_point;
    }

    result
}

pub fn get_global_transcriber() -> &'static GlobalTranscriberEngine {
    static ENGINE: OnceLock<GlobalTranscriberEngine> = OnceLock::new();
    ENGINE.get_or_init(GlobalTranscriberEngine::new)
}

#[tauri::command]
pub fn transcribe_audio_buffer(language: String) -> Result<Vec<TranscriptSegment>, String> {
    let engine = get_global_transcriber();
    let audio_engine = crate::audio::get_global_audio_engine();
    let samples = {
        let mut state = audio_engine.state.lock().unwrap();
        // Require at least 1.0 second (16,000 samples) of audio for clean sentence recognition
        if state.pcm_16k_buffer.len() < 16000 {
            return Ok(engine.get_history());
        }
        std::mem::take(&mut state.pcm_16k_buffer)
    };

    engine.transcribe_pcm(&samples, &language)
}

#[tauri::command]
pub fn get_transcription_history() -> Vec<TranscriptSegment> {
    let engine = get_global_transcriber();
    engine.get_history()
}

#[tauri::command]
pub fn clear_transcription_history() -> Vec<TranscriptSegment> {
    let engine = get_global_transcriber();
    engine.clear_history();
    Vec::new()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub key: String,            // "tiny", "base", "small", "medium", "large-v3-turbo"
    pub name: String,           // "Whisper Small (244M)"
    pub filename: String,       // "ggml-small.bin"
    pub size_mb: usize,         // 487
    pub ram_required_mb: usize, // 500
    pub is_downloaded: bool,
    pub is_active: bool,
    pub description: String, // "Dengeli ve yüksek performanslı model (Önerilen)"
    pub accuracy_score: u8,  // 1 - 5
    pub speed_score: u8,     // 1 - 5
    pub download_url: String,
}

#[tauri::command]
pub fn get_available_models() -> Vec<ModelInfo> {
    let engine = get_global_transcriber();
    let state = engine.state.lock().unwrap();
    let current_selected_path = &state.selected_model_path;

    let base_models_dir = Path::new("models");
    let alt_models_dir = Path::new("src-tauri/models");

    let is_present = |filename: &str| {
        base_models_dir.join(filename).exists() || alt_models_dir.join(filename).exists()
    };

    vec![
        ModelInfo {
            key: "tiny".to_string(),
            name: "Ekspres Mod (Hafif)".to_string(),
            filename: "ggml-tiny.bin".to_string(),
            size_mb: 75,
            ram_required_mb: 150,
            is_downloaded: is_present("ggml-tiny.bin"),
            is_active: current_selected_path.contains("tiny"),
            description: "Çok hızlı ve hafif. Kısa notlar ve hızlı ses kayıtları için idealdir."
                .to_string(),
            accuracy_score: 2,
            speed_score: 5,
            download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
                .to_string(),
        },
        ModelInfo {
            key: "base".to_string(),
            name: "Standart Mod".to_string(),
            filename: "ggml-base.bin".to_string(),
            size_mb: 142,
            ram_required_mb: 250,
            is_downloaded: is_present("ggml-base.bin"),
            is_active: current_selected_path.contains("base"),
            description: "Hızlı ve pratik. Günlük konuşmalar ve birebir sohbetler için uygundur."
                .to_string(),
            accuracy_score: 3,
            speed_score: 4,
            download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
                .to_string(),
        },
        ModelInfo {
            key: "small".to_string(),
            name: "Dengeli Mod (Önerilen)".to_string(),
            filename: "ggml-small.bin".to_string(),
            size_mb: 487,
            ram_required_mb: 500,
            is_downloaded: is_present("ggml-small.bin"),
            is_active: current_selected_path.contains("small"),
            description: "Mükemmel anlama kalitesi ve akıcı hız. Çoğu toplantı için ideal denge."
                .to_string(),
            accuracy_score: 4,
            speed_score: 4,
            download_url:
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
                    .to_string(),
        },
        ModelInfo {
            key: "medium".to_string(),
            name: "Gelişmiş Mod".to_string(),
            filename: "ggml-medium.bin".to_string(),
            size_mb: 1530,
            ram_required_mb: 1600,
            is_downloaded: is_present("ggml-medium.bin"),
            is_active: current_selected_path.contains("medium"),
            description:
                "Teknik terimler ve çok katılımcılı kalabalık toplantılar için üstün doğruluk."
                    .to_string(),
            accuracy_score: 5,
            speed_score: 3,
            download_url:
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"
                    .to_string(),
        },
        ModelInfo {
            key: "large-v3-turbo".to_string(),
            name: "Zirve Hassasiyet (Ultra)".to_string(),
            filename: "ggml-large-v3-turbo.bin".to_string(),
            size_mb: 1620,
            ram_required_mb: 1700,
            is_downloaded: is_present("ggml-large-v3-turbo.bin"),
            is_active: current_selected_path.contains("large-v3-turbo"),
            description:
                "En yüksek anlama yeteneği ve detayları kaçırmayan kristal netliğinde çözümleme."
                    .to_string(),
            accuracy_score: 5,
            speed_score: 4,
            download_url:
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
                    .to_string(),
        },
    ]
}

#[tauri::command]
pub fn switch_transcription_model(model_key: String) -> Result<ModelStatus, String> {
    let filename = match model_key.as_str() {
        "tiny" => "models/ggml-tiny.bin",
        "base" => "models/ggml-base.bin",
        "small" => "models/ggml-small.bin",
        "medium" => "models/ggml-medium.bin",
        "large-v3-turbo" => "models/ggml-large-v3-turbo.bin",
        _ => return Err(format!("Geçersiz model anahtarı: {}", model_key)),
    };

    let engine = get_global_transcriber();
    engine.cleanup_context();

    {
        let mut state = engine.state.lock().unwrap();
        state.selected_model_path = filename.to_string();
    }

    Ok(engine.get_model_status())
}

#[tauri::command]
pub fn download_whisper_model(model_key: String) -> Result<String, String> {
    let models = get_available_models();
    let model = models
        .into_iter()
        .find(|m| m.key == model_key)
        .ok_or_else(|| format!("Model bulunamadı: {}", model_key))?;

    let target_dir = Path::new("models");
    if !target_dir.exists() {
        let _ = std::fs::create_dir_all(target_dir);
    }
    let target_file = target_dir.join(&model.filename);

    if target_file.exists() {
        return Ok(format!("{} zaten mevcut.", model.name));
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client
        .get(&model.download_url)
        .send()
        .map_err(|e| format!("İndirme hatası: {}", e))?;

    let mut out = std::fs::File::create(&target_file)
        .map_err(|e| format!("Dosya oluşturma hatası: {}", e))?;

    std::io::copy(&mut resp, &mut out).map_err(|e| format!("Yazma hatası: {}", e))?;

    Ok(format!("{} başarıyla indirildi!", model.name))
}

#[tauri::command]
pub fn get_model_status() -> ModelStatus {
    let engine = get_global_transcriber();
    engine.get_model_status()
}

#[tauri::command]
pub fn unload_transcription_model() -> ModelStatus {
    let engine = get_global_transcriber();
    engine.cleanup_context();
    engine.get_model_status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transcriber_initialization() {
        let engine = GlobalTranscriberEngine::new();
        let status = engine.get_model_status();
        assert!(!status.is_loaded);
    }
}
