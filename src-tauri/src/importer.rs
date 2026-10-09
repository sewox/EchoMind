use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::{Path, PathBuf};

use crate::transcriber::TranscriptSegment;
use symphonia::core::audio::AudioBufferRef;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::storage::MeetingRecord;

/// Appends a visible warning when the local Whisper engine silently fell back to a
/// smaller/lower-quality model because the selected one failed to load (e.g. not
/// yet downloaded) — otherwise this only shows up if the user checks Settings.
const WHISPER_MODEL_KEYS: [&str; 5] = ["tiny", "base", "small", "medium", "large-v3-turbo"];

fn model_missing_message(key: &str) -> String {
    format!(
        "Seçilen konuşma tanıma modeli ({}) bu bilgisayarda yüklü değil. Modeller penceresinden indirip yeniden deneyin.",
        local_model_label(Some(key))
    )
}

fn model_unusable_message(key: &str) -> String {
    format!(
        "Seçilen konuşma tanıma modeli ({}) yüklenemedi; dosya bozuk olabilir. Modeller penceresinden silip yeniden indirin.",
        local_model_label(Some(key))
    )
}

/// Refuses a Whisper model that is not on disk instead of silently using another one.
fn check_requested_model(key: &str, downloaded: impl Fn(&str) -> bool) -> Result<(), String> {
    if downloaded(key) {
        Ok(())
    } else {
        Err(model_missing_message(key))
    }
}

fn with_model_fallback_warning(label: String) -> String {
    if crate::transcriber::get_global_transcriber()
        .get_model_status()
        .used_fallback_model
    {
        format!("{} ⚠️ (İstenen model yüklenemedi, Base'e düşüldü)", label)
    } else {
        label
    }
}

fn local_model_label(model_version: Option<&str>) -> &'static str {
    match model_version {
        Some("medium") => "Gelişmiş Mod",
        Some("large-v3-turbo") => "Zirve Netlik",
        Some("base") => "Hızlı Mod",
        _ => "Standart Mod",
    }
}

/// Runs the ASR engine the user picked for an import / re-transcription.
/// When that engine fails it falls back to local Whisper and says so in the
/// returned label — the label must never claim a cloud engine that didn't run.
/// Local Whisper runs in batch mode, so the result never leaks into (or picks
/// up) the live-recording transcript history.
/// Cloud engines are sent the audio file rather than samples.
fn is_cloud_provider(provider: Option<&str>) -> bool {
    provider.is_some_and(|p| {
        matches!(
            p.trim().to_lowercase().as_str(),
            "groq" | "openai" | "gemini"
        )
    })
}

fn run_asr_engine(
    audio_path: &Path,
    pcm_16k: &[f32],
    lang: &str,
    cloud_provider: Option<&str>,
    api_key: Option<&str>,
    model_version: Option<&str>,
) -> Result<(Vec<TranscriptSegment>, String), String> {
    let mut failed_engine: Option<&'static str> = None;

    if let Some(prov) = cloud_provider {
        let clean_prov = prov.trim().to_lowercase();
        match clean_prov.as_str() {
            "apple_speech" | "apple_native" | "apple" => {
                let ticker = crate::import_progress::EstimatedTicker::start(
                    crate::import_progress::apple_expected_duration(pcm_16k.len() as f32 / 16000.0),
                );
                let result = crate::offline_engines::transcribe_apple_pcm(pcm_16k, lang);
                drop(ticker);
                match result {
                    Ok(mut segs) => {
                        crate::import_progress::diarizing();
                        crate::diarization::cluster_speakers(&mut segs, pcm_16k, 16000, 6);
                        crate::diarization::resolve_speaker_names(&mut segs);
                        return Ok((segs, crate::asr_engine::APPLE_ENGINE_LABEL.to_string()));
                    }
                    Err(e) => {
                        eprintln!("⚠️ Apple Speech başarısız: {}", e);
                        failed_engine = Some("Apple Speech");
                    }
                }
            }
            // "sensevoice" (retired; it only ever ran Whisper) falls through to local Whisper.
            "groq" | "openai" | "gemini" => {
                if let Some(key) = api_key.map(str::trim).filter(|k| !k.is_empty()) {
                    // HARD REJECT in Paranoid / Air-Gapped Mode
                    crate::security::check_cloud_access_allowed()?;
                    crate::import_progress::transcribing_unmeasured();
                    match crate::cloud_transcriber::transcribe_audio_cloud(
                        audio_path,
                        &clean_prov,
                        key,
                        lang,
                        model_version,
                    ) {
                        Ok(mut segs) => {
                            // Keep the provider's own speaker separation when it
                            // produced one; only cluster acoustically otherwise.
                            let distinct: std::collections::HashSet<&str> =
                                segs.iter().map(|s| s.speaker_id.as_str()).collect();
                            if distinct.len() <= 1 {
                                crate::import_progress::diarizing();
                                crate::diarization::cluster_speakers(&mut segs, pcm_16k, 16000, 6);
                            }
                            crate::diarization::resolve_speaker_names(&mut segs);
                            return Ok((
                                segs,
                                format!("⚡ Bulut Zekası ({})", clean_prov.to_uppercase()),
                            ));
                        }
                        Err(e) => {
                            // Errors can embed the request URL (incl. the API key):
                            // log a redacted form, never surface it in the label.
                            eprintln!(
                                "⚠️ Bulut ASR başarısız ({}): {}",
                                clean_prov,
                                e.replace(key, "***")
                            );
                            failed_engine = Some(match clean_prov.as_str() {
                                "groq" => "Groq",
                                "openai" => "OpenAI",
                                _ => "Gemini",
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let transcriber = crate::transcriber::get_global_transcriber();
    // A model the user picked is used or the job stops: hours of transcription
    // with a weaker model they didn't choose is worse than an error.
    if let Some(key) = model_version.filter(|k| WHISPER_MODEL_KEYS.contains(k)) {
        check_requested_model(key, crate::transcriber::is_model_downloaded)?;
        crate::transcriber::switch_transcription_model(key.to_string())?;
        transcriber.ensure_model_loaded()?;
        if transcriber.get_model_status().used_fallback_model {
            transcriber.cleanup_context();
            return Err(model_unusable_message(key));
        }
    }
    let not_cancelled = std::sync::atomic::AtomicBool::new(false);
    let segs = transcriber.transcribe_pcm_batch(pcm_16k, lang, &not_cancelled)?;
    // Auto-cleanup local context memory after heavy batch transcription
    transcriber.cleanup_context();

    let mut label = with_model_fallback_warning(format!(
        "🔒 Bilgisayarınızda ({})",
        local_model_label(model_version)
    ));
    if let Some(engine) = failed_engine {
        label = format!(
            "{} ⚠️ ({} başarısız oldu, yerel modele geçildi)",
            label, engine
        );
    }
    Ok((segs, label))
}

/// Recognition fixes by the on-device model before the report (first 30% of
/// the report stage); `None` when no model is installed or the check failed.
fn correct_before_report(
    segments: &mut Vec<TranscriptSegment>,
) -> Option<Vec<crate::local_llm::correction::AsrCorrection>> {
    let model = crate::local_llm::catalog::installed()?;
    match crate::local_llm::correction::correct(segments, model, None, &|f| {
        crate::import_progress::summarizing(0.3 * f)
    }) {
        Ok((fixed, corrections)) => {
            *segments = fixed;
            Some(corrections)
        }
        Err(e) => {
            eprintln!("⚠️ Transkript düzeltmesi yapılamadı: {e}");
            None
        }
    }
}

/// Report progress after an optional correction pass took the first 30%.
fn report_progress(corrected: bool) -> impl Fn(f32) + Sync {
    move |f| {
        if corrected {
            crate::import_progress::summarizing(0.3 + 0.7 * f)
        } else {
            crate::import_progress::summarizing(f)
        }
    }
}

/// Titles EchoMind generated itself; a smart title may replace these, but a
/// title the user typed must never be overwritten by a re-transcription.
pub(crate) fn is_auto_generated_title(title: &str) -> bool {
    let t = title.trim();
    t.is_empty()
        || t.starts_with("Toplantı - ")
        || t.starts_with("İçe Aktarıldı:")
        || t.starts_with("Meeting - ")
        || t.contains(" Toplantısı - ")
        || t.contains(" Toplantısı (")
}

/// Decodes any external audio file (.mp3, .m4a, .opus, .ogg, .wav, .flac, .aac, .3gp, .caf) into 16,000 Hz Mono float32 PCM samples.
pub fn decode_audio_file_to_pcm16k(file_path: &Path) -> Result<(Vec<f32>, u64), String> {
    let mono = mix_channels(&decode_audio_file_channels_16k(file_path)?);
    let duration_seconds = (mono.len() as u64) / 16000;
    Ok((mono, duration_seconds))
}

/// Averages channels into one mono track (shorter channels count as silence).
pub fn mix_channels(channels: &[Vec<f32>]) -> Vec<f32> {
    if let [only] = channels {
        return only.clone();
    }
    let n = channels.iter().map(Vec::len).max().unwrap_or(0);
    let k = channels.len().max(1) as f32;
    (0..n)
        .map(|i| {
            channels
                .iter()
                .map(|c| c.get(i).copied().unwrap_or(0.0))
                .sum::<f32>()
                / k
        })
        .collect()
}

/// Decodes an audio file to 16 kHz, one vector per channel. EchoMind stores
/// recordings with system audio as stereo FLAC (left = microphone, right =
/// system audio), which keeps local vs remote speakers separable later.
pub fn decode_audio_file_channels_16k(file_path: &Path) -> Result<Vec<Vec<f32>>, String> {
    let file = File::open(file_path).map_err(|e| format!("Ses dosyası açılamadı: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Provide hint based on file extension
    let mut hint = Hint::new();
    if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Ses formatı çözümlenemedi: {:?}", e))?;

    let mut format_reader = probed.format;
    let track = format_reader
        .tracks()
        .iter()
        .find(|t| t.codec_params.sample_rate.is_some())
        .cloned()
        .ok_or_else(|| "Ses izi (audio track) bulunamadı".to_string())?;

    let src_sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let num_channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(1)
        .max(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Ses dekoderi oluşturulamadı: {:?}", e))?;

    let track_id = track.id;
    // Low-pass + resample per channel as packets arrive (no full-rate copy
    // of the whole file in memory, and no aliasing from plain interpolation).
    let mut resamplers: Vec<crate::resample::Downsampler> = (0..num_channels)
        .map(|_| crate::resample::Downsampler::new(src_sample_rate, 16000))
        .collect();
    let mut out: Vec<Vec<f32>> = vec![Vec::new(); num_channels];
    let mut planar: Vec<Vec<f32>> = vec![Vec::new(); num_channels];

    loop {
        let packet = match format_reader.next_packet() {
            Ok(packet) => packet,
            Err(Error::IoError(ref e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(Error::ResetRequired) => break,
            Err(e) => return Err(format!("Ses paket okuma hatası: {:?}", e)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                for p in planar.iter_mut() {
                    p.clear();
                }
                append_audio_buffer_channels(&decoded, &mut planar);
                for (ch, samples) in planar.iter().enumerate() {
                    let resampled = resamplers[ch].process(samples);
                    out[ch].extend_from_slice(&resampled);
                }
            }
            Err(Error::DecodeError(_)) => continue,
            Err(e) => return Err(format!("Dekodlama hatası: {:?}", e)),
        }
    }

    if out.iter().all(Vec::is_empty) {
        return Err("Ses dosyasından veri okunamadı".to_string());
    }
    Ok(out)
}

fn append_audio_buffer_channels(decoded: &AudioBufferRef, out: &mut [Vec<f32>]) {
    fn push<T: Copy>(planes: &[&[T]], out: &mut [Vec<f32>], conv: impl Fn(T) -> f32) {
        for (ch, dst) in out.iter_mut().enumerate() {
            if let Some(src) = planes.get(ch) {
                dst.extend(src.iter().map(|&x| conv(x)));
            }
        }
    }
    match decoded {
        AudioBufferRef::F32(buf) => push(buf.planes().planes(), out, |x| x),
        AudioBufferRef::U8(buf) => push(buf.planes().planes(), out, |x| (x as f32 - 128.0) / 128.0),
        AudioBufferRef::S16(buf) => push(buf.planes().planes(), out, |x| x as f32 / 32768.0),
        AudioBufferRef::S32(buf) => push(buf.planes().planes(), out, |x| x as f32 / 2147483648.0),
        _ => {}
    }
}

#[tauri::command]
pub async fn import_audio_file(
    file_path: String,
    custom_title: Option<String>,
    language: Option<String>,
    cloud_provider: Option<String>,
    api_key: Option<String>,
    model_version: Option<String>,
) -> Result<MeetingRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _import = crate::import_progress::ImportGuard::acquire()?;
        let path = PathBuf::from(&file_path);
        if !path.exists() {
            return Err(format!("Dosya bulunamadı: {}", file_path));
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let supported_exts = ["mp3", "m4a", "opus", "ogg", "wav", "flac", "aac", "3gp", "mp4", "caf", "wma"];
        if !supported_exts.contains(&ext.as_str()) {
            return Err(format!(
                "Desteklenmeyen dosya formatı (.{})\nLütfen yalnızca desteklenen ses dosyalarını (.mp3, .m4a, .opus, .ogg, .wav, .flac, .aac, .3gp, .caf) seçiniz.",
                ext
            ));
        }

        // 1. Pure Rust multi-format audio decoding
        crate::import_progress::decoding();
        let (mut pcm_16k, duration_seconds) = decode_audio_file_to_pcm16k(&path)?;

        // 2. Audio AGC normalization
        crate::audio::normalize_audio_samples(&mut pcm_16k);

        // 3. Prepare FLAC output file
        let now = chrono::Local::now();
        let id = format!("mtg_import_{}", now.format("%Y%m%d_%H%M%S"));
        let date_formatted = now.format("%d %B %Y, %H:%M").to_string();

        let mins = duration_seconds / 60;
        let secs = duration_seconds % 60;
        let duration_formatted = format!("{:02}:{:02}", mins, secs);

        let default_title = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| format!("İçe Aktarıldı: {}", s))
            .unwrap_or_else(|| format!("Ses Kaydı - {}", date_formatted));

        let title = custom_title.unwrap_or(default_title);

        // Save FLAC audio file (Absolute Path Resolution outside src-tauri)
        let storage_dir = crate::storage::get_storage_dir();
        let rec_dir = storage_dir.join("recordings");
        if !rec_dir.exists() {
            let _ = std::fs::create_dir_all(&rec_dir);
        }
        let flac_file_path = rec_dir.join(format!("{}.flac", id));
        let audio_file_path = match crate::storage::compress_audio_to_flac(&pcm_16k, &flac_file_path) {
            Ok(_) => {
                let abs_flac = std::fs::canonicalize(&flac_file_path).unwrap_or(flac_file_path.clone());
                Some(abs_flac.to_string_lossy().to_string())
            }
            Err(_) => None,
        };

        let lang = language.as_deref().unwrap_or("auto");

        // 4. ASR (cloud / offline engine, local Whisper fallback with honest label)
        let (segments, engine_label) = run_asr_engine(
            &flac_file_path,
            &pcm_16k,
            lang,
            cloud_provider.as_deref(),
            api_key.as_deref(),
            model_version.as_deref(),
        )?;

        // Explicitly free 16k PCM vector after compression
        drop(pcm_16k);

        // Step 0: Audio duration clamp and hallucination loop filter pass
        let total_duration_ms = duration_seconds * 1000;
        let mut clean_segs = Vec::new();
        for mut s in segments {
            if s.start_time_ms >= total_duration_ms {
                continue;
            }
            if s.end_time_ms > total_duration_ms {
                s.end_time_ms = total_duration_ms;
                let start_sec = s.start_time_ms / 1000;
                let end_sec = s.end_time_ms / 1000;
                s.timestamp_formatted = format!(
                    "{:02}:{:02} -> {:02}:{:02}",
                    start_sec / 60,
                    start_sec % 60,
                    end_sec / 60,
                    end_sec % 60
                );
            }
            if s.start_time_ms >= s.end_time_ms {
                continue;
            }

            let (cleaned, has_loop, ratio) =
                crate::summarizer::cleaner::SpeechCleaner::detect_and_clean_hallucination_loops(&s.text);
            if has_loop && (ratio > 0.60 || cleaned.split_whitespace().count() < 2) {
                continue;
            }
            if has_loop {
                s.text = cleaned;
                s.confidence = (s.confidence * (1.0 - ratio).max(0.20) * 100.0).round() / 100.0;
            }

            clean_segs.push(s);
        }
        let mut segments = clean_segs;

        // Step 1: Automatic Redaction and Phonetic Error Correction Pass
        crate::summarizer::TranscriptRedactor::redact_segments(
            &mut segments,
            cloud_provider.as_deref(),
            api_key.as_deref(),
        );

        // Step 2: Immediate Deep Synthesis Summary Generation (Role-Play Intelligence)
        let prov_str = cloud_provider.as_deref().unwrap_or("local");
        crate::import_progress::summarizing(0.0);
        let asr_corrections = correct_before_report(&mut segments);
        let summary_res = crate::summarizer::SummarizerEngine::generate_summary_with_progress(
            &segments,
            prov_str,
            api_key.as_deref(),
            None,
            None,
            None,
            None,
            &report_progress(asr_corrections.is_some()),
        );

        let final_title = if let Some(ref st) = summary_res.smart_title {
            let clean = st.trim();
            if !clean.is_empty() {
                clean.to_string()
            } else {
                title
            }
        } else {
            title
        };

        crate::import_progress::saving();
        let meeting = MeetingRecord {
            id,
            title: final_title,
            date_formatted,
            duration_seconds,
            duration_formatted,
            audio_file_path,
            segments,
            summary: summary_res.summary,
            key_decisions: summary_res.key_decisions,
            meeting_goal: Some(summary_res.meeting_goal),
            key_highlights: Some(summary_res.key_highlights),
            action_items: Some(summary_res.action_items),
            phase1_agreed: Some(summary_res.phase1_agreed),
            phase2_deferred: Some(summary_res.phase2_deferred),
            detailed_topics: Some(summary_res.detailed_topics),
            participants: Some(summary_res.participants),
            engine_used: Some(engine_label),
            summary_provider: Some(summary_res.provider_used),
            tags: None,
            transcript_pending: false,
            asr_corrections,
        };

        let storage = crate::storage::get_global_storage();
        storage.add_meeting(meeting)
    })
    .await
    .map_err(|e| format!("İçe aktarma işlem hatası: {}", e))?
    .inspect_err(|e| eprintln!("❌ İçe aktarma başarısız: {}", e))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickedFileInfo {
    pub path: String,
    pub file_name: String,
    pub file_size_mb: f64,
    pub is_large_file: bool,
}

#[tauri::command]
pub async fn pick_audio_file_dialog() -> Result<Option<PickedFileInfo>, String> {
    #[cfg(target_os = "linux")]
    {
        // 1. Try zenity first (common on Ubuntu, Debian, GNOME, XFCE)
        let zenity_res = std::process::Command::new("zenity")
            .args([
                "--file-selection",
                "--title=Toplantı Ses Dosyası Seç",
                "--file-filter=Ses Dosyaları | *.mp3 *.m4a *.opus *.ogg *.wav *.flac *.aac *.mp4 *.wma *.3gp",
            ])
            .output();

        if let Ok(out) = zenity_res {
            if out.status.success() {
                let path_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path_str.is_empty() {
                    let path_buf = std::path::PathBuf::from(&path_str);
                    if path_buf.exists() {
                        let file_name = path_buf
                            .file_name()
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or_else(|| "Ses Kaydı".to_string());
                        let file_size_bytes =
                            std::fs::metadata(&path_buf).map(|m| m.len()).unwrap_or(0);
                        let file_size_mb = (file_size_bytes as f64) / (1024.0 * 1024.0);
                        return Ok(Some(PickedFileInfo {
                            path: path_str,
                            file_name,
                            file_size_mb: (file_size_mb * 10.0).round() / 10.0,
                            is_large_file: file_size_mb > 15.0,
                        }));
                    }
                }
            }
        }

        // 2. Try kdialog (common on KDE Plasma / Linux)
        let kdialog_res = std::process::Command::new("kdialog")
            .args([
                "--getopenfilename",
                ".",
                "*.mp3 *.m4a *.opus *.ogg *.wav *.flac *.aac *.mp4 *.wma *.3gp",
            ])
            .output();

        if let Ok(out) = kdialog_res {
            if out.status.success() {
                let path_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path_str.is_empty() {
                    let path_buf = std::path::PathBuf::from(&path_str);
                    if path_buf.exists() {
                        let file_name = path_buf
                            .file_name()
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or_else(|| "Ses Kaydı".to_string());
                        let file_size_bytes =
                            std::fs::metadata(&path_buf).map(|m| m.len()).unwrap_or(0);
                        let file_size_mb = (file_size_bytes as f64) / (1024.0 * 1024.0);
                        return Ok(Some(PickedFileInfo {
                            path: path_str,
                            file_name,
                            file_size_mb: (file_size_mb * 10.0).round() / 10.0,
                            is_large_file: file_size_mb > 15.0,
                        }));
                    }
                }
            }
        }
    }

    let file = rfd::AsyncFileDialog::new()
        .add_filter(
            "Desteklenen Ses Dosyaları",
            &[
                "mp3", "m4a", "opus", "ogg", "wav", "flac", "aac", "3gp", "mp4", "caf", "wma",
            ],
        )
        .set_title("Toplantı Ses Dosyası Seç")
        .pick_file()
        .await;

    match file {
        Some(handle) => {
            let path_buf = handle.path().to_path_buf();
            let path_str = path_buf.to_string_lossy().to_string();
            let file_name = path_buf
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "Ses Kaydı".to_string());

            let file_size_bytes = std::fs::metadata(&path_buf).map(|m| m.len()).unwrap_or(0);

            let file_size_mb = (file_size_bytes as f64) / (1024.0 * 1024.0);
            let is_large_file = file_size_mb > 15.0;

            Ok(Some(PickedFileInfo {
                path: path_str,
                file_name,
                file_size_mb: (file_size_mb * 10.0).round() / 10.0,
                is_large_file,
            }))
        }
        None => Ok(None),
    }
}

fn internal_base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let clean = input.trim();
    let mut val = 0u32;
    let mut valb = -8;
    for c in clean.chars() {
        if c == '=' {
            break;
        }
        let b = match c {
            'A'..='Z' => c as u32 - 'A' as u32,
            'a'..='z' => c as u32 - 'a' as u32 + 26,
            '0'..='9' => c as u32 - '0' as u32 + 52,
            '+' => 62,
            '/' => 63,
            _ => continue,
        };
        val = (val << 6) | b;
        valb += 6;
        if valb >= 0 {
            out.push(((val >> valb) & 0xFF) as u8);
            valb -= 8;
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn save_uploaded_audio_bytes(
    file_name: String,
    file_base64: String,
) -> Result<PickedFileInfo, String> {
    let bytes = internal_base64_decode(&file_base64)?;

    let temp_dir = std::env::temp_dir().join("echomind_uploads");
    if !temp_dir.exists() {
        let _ = std::fs::create_dir_all(&temp_dir);
    }

    let clean_name = std::path::Path::new(&file_name)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "uploaded_audio.mp3".to_string());

    let target_path = temp_dir.join(&clean_name);
    std::fs::write(&target_path, &bytes)
        .map_err(|e| format!("Dosya geçici dizine yazılamadı: {}", e))?;

    let file_size_mb = (bytes.len() as f64) / (1024.0 * 1024.0);

    Ok(PickedFileInfo {
        path: target_path.to_string_lossy().to_string(),
        file_name: clean_name,
        file_size_mb: (file_size_mb * 10.0).round() / 10.0,
        is_large_file: file_size_mb > 15.0,
    })
}

#[tauri::command]
pub async fn process_audio_file_path(
    file_path: String,
    language: Option<String>,
    cloud_provider: Option<String>,
    api_key: Option<String>,
    model_version: Option<String>,
) -> Result<MeetingRecord, String> {
    import_audio_file(
        file_path,
        None,
        language,
        cloud_provider,
        api_key,
        model_version,
    )
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn retranscribe_meeting(
    meeting_id: String,
    language: Option<String>,
    cloud_provider: Option<String>,
    api_key: Option<String>,
    model_version: Option<String>,
    summary_provider: Option<String>,
    summary_api_key: Option<String>,
    custom_endpoint: Option<String>,
    custom_model: Option<String>,
) -> Result<MeetingRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _import = crate::import_progress::ImportGuard::acquire()?;
        crate::storage::require_storage_ready()?;
        let storage = crate::storage::get_global_storage();

        // Read what we need, then release the history lock: transcription of a
        // long recording (plus a cloud summary) takes minutes, and holding the
        // lock that long blocks every history read/write, including saving a
        // new recording.
        let audio_path_str = {
            let meetings = storage.meetings.lock().unwrap();
            let target = meetings
                .iter()
                .find(|m| m.id == meeting_id)
                .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;
            target.audio_file_path.clone().ok_or_else(|| {
                "Bu toplantı için kaydedilmiş ses dosyası bulunamadı. Yeniden transkribe işlemi için orijinal ses kaydı gereklidir.".to_string()
            })?
        };

        let mut path = PathBuf::from(&audio_path_str);
        if !path.exists() {
            if let Ok(cwd) = std::env::current_dir() {
                let alt1 = cwd.join(&audio_path_str);
                let alt2 = cwd.join("src-tauri").join(&audio_path_str);
                if alt1.exists() {
                    path = alt1;
                } else if alt2.exists() {
                    path = alt2;
                }
            }
        }

        if !path.exists() {
            return Err(format!("Ses dosyası diskte bulunamadı: {}", audio_path_str));
        }

        // 1. Decode audio to 16kHz PCM
        crate::import_progress::decoding();
        let mut channels = decode_audio_file_channels_16k(&path)?;
        // App recordings keep mic and system audio apart; with loudspeakers
        // the mic also holds the remote side, which doubles it in the mix.
        if let Some(lag) = crate::echo::clean_channels(&mut channels) {
            println!("🔇 Yankı giderildi (sistem sesi {lag:.0} ms kaydırıldı)");
        }
        let mut pcm_16k = mix_channels(&channels);
        let duration_seconds = (pcm_16k.len() as u64) / 16000;
        crate::audio::normalize_audio_samples(&mut pcm_16k);

        let lang = language.as_deref().unwrap_or("auto");

        // 2. ASR (cloud / offline engine, local Whisper fallback with honest label)
        let asr = |audio: &[f32]| {
            run_asr_engine(
                &path,
                audio,
                lang,
                cloud_provider.as_deref(),
                api_key.as_deref(),
                model_version.as_deref(),
            )
        };
        // Recordings with system audio: the microphone ("Siz") and the remote
        // side are transcribed apart and merged by time. Cloud engines get the
        // file itself, so they keep the mixed path for now.
        let (segments_raw, engine_label) = match channels.as_slice() {
            [mic, system] if !is_cloud_provider(cloud_provider.as_deref()) => {
                drop(pcm_16k);
                let mut label = String::new();
                // Apple dictation stays quiet on silence; Whisper does not.
                let silence = if matches!(
                    cloud_provider.as_deref().map(str::trim),
                    Some("apple_speech" | "apple_native" | "apple")
                ) {
                    crate::dual_track::Silence::Keep
                } else {
                    crate::dual_track::Silence::Remove
                };
                let segments = crate::dual_track::transcribe(mic, system, silence, |track| {
                    let mut track = track.to_vec();
                    crate::audio::normalize_audio_samples(&mut track);
                    let (segments, used) = asr(&track)?;
                    label = used;
                    Ok(segments)
                })?;
                (segments, label)
            }
            _ => {
                let (mut segments, label) = asr(&pcm_16k)?;
                drop(pcm_16k);
                if let [mic, system] = channels.as_slice() {
                    crate::diarization::attribute_speakers_by_channel(
                        &mut segments,
                        mic,
                        system,
                        16000,
                    );
                }
                (segments, label)
            }
        };
        drop(channels);

        let total_duration_ms = duration_seconds * 1000;
        let mut clean_segs = Vec::new();
        for mut s in segments_raw {
            if s.start_time_ms >= total_duration_ms {
                continue;
            }
            if s.end_time_ms > total_duration_ms {
                s.end_time_ms = total_duration_ms;
                let start_sec = s.start_time_ms / 1000;
                let end_sec = s.end_time_ms / 1000;
                s.timestamp_formatted = format!(
                    "{:02}:{:02} -> {:02}:{:02}",
                    start_sec / 60,
                    start_sec % 60,
                    end_sec / 60,
                    end_sec % 60
                );
            }
            if s.start_time_ms >= s.end_time_ms {
                continue;
            }

            let (cleaned, has_loop, ratio) =
                crate::summarizer::cleaner::SpeechCleaner::detect_and_clean_hallucination_loops(&s.text);
            if has_loop && (ratio > 0.60 || cleaned.split_whitespace().count() < 2) {
                continue;
            }
            if has_loop {
                s.text = cleaned;
                s.confidence = (s.confidence * (1.0 - ratio).max(0.20) * 100.0).round() / 100.0;
            }

            clean_segs.push(s);
        }
        let mut segments = clean_segs;

        // Step 1: Redaction & phonetic correction
        crate::summarizer::TranscriptRedactor::redact_segments(
            &mut segments,
            cloud_provider.as_deref(),
            api_key.as_deref(),
        );

        // Step 2: Summary Generation with chosen summary provider
        let prov_str = summary_provider.as_deref().unwrap_or("local");
        crate::import_progress::summarizing(0.0);
        let asr_corrections = correct_before_report(&mut segments);
        let summary_res = crate::summarizer::SummarizerEngine::generate_summary_with_progress(
            &segments,
            prov_str,
            summary_api_key.as_deref(),
            custom_endpoint.as_deref(),
            custom_model.as_deref(),
            None,
            None,
            &report_progress(asr_corrections.is_some()),
        );

        crate::import_progress::saving();
        // 3. Write back under a short lock; the meeting may have been deleted meanwhile.
        let updated_record = {
            let mut meetings = storage.meetings.lock().unwrap();
            let target = meetings
                .iter_mut()
                .find(|m| m.id == meeting_id)
                .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;
            if let Some(ref st) = summary_res.smart_title {
                let clean = st.trim();
                if !clean.is_empty() && is_auto_generated_title(&target.title) {
                    target.title = clean.to_string();
                }
            }
            target.segments = segments;
            target.transcript_pending = false;
            target.asr_corrections = asr_corrections;
            target.summary = summary_res.summary;
            target.key_decisions = summary_res.key_decisions;
            target.meeting_goal = Some(summary_res.meeting_goal);
            target.key_highlights = Some(summary_res.key_highlights);
            target.action_items = Some(summary_res.action_items);
            target.phase1_agreed = Some(summary_res.phase1_agreed);
            target.phase2_deferred = Some(summary_res.phase2_deferred);
            target.detailed_topics = Some(summary_res.detailed_topics);
            target.participants = Some(summary_res.participants);
            target.engine_used = Some(engine_label);
            target.summary_provider = Some(summary_res.provider_used);
            target.clone()
        };

        // Persist through the encrypted store (this path used to write the
        // whole history to disk as plaintext JSON).
        storage.save_to_disk()?;
        crate::transcription_queue::forget_meeting(&meeting_id);

        Ok(updated_record)
    })
    .await
    .map_err(|e| format!("Yeniden transkribe iş parçacığı hatası: {}", e))?
    .inspect_err(|e| eprintln!("❌ Yeniden yazıya dökme başarısız: {}", e))
}

#[tauri::command]
pub async fn pick_and_import_audio_file(
    language: Option<String>,
    cloud_provider: Option<String>,
    api_key: Option<String>,
    model_version: Option<String>,
) -> Result<Option<MeetingRecord>, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter(
            "Desteklenen Ses Dosyaları",
            &[
                "mp3", "m4a", "opus", "ogg", "wav", "flac", "aac", "3gp", "mp4", "caf", "wma",
            ],
        )
        .set_title("Toplantı Ses Dosyası Seç")
        .pick_file()
        .await;

    match file {
        Some(handle) => {
            let path_str = handle.path().to_string_lossy().to_string();
            let meeting = import_audio_file(
                path_str,
                None,
                language,
                cloud_provider,
                api_key,
                model_version,
            )
            .await?;
            Ok(Some(meeting))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn a_missing_model_is_refused_not_replaced() {
        let err = check_requested_model("large-v3-turbo", |_| false).unwrap_err();
        assert!(err.contains("Zirve Netlik"), "{err}");
        assert!(err.contains("Modeller penceresinden indirip"), "{err}");
        assert!(check_requested_model("small", |k| k == "small").is_ok());
        assert!(model_unusable_message("medium").contains("Gelişmiş Mod"));
    }
    #[test]
    fn test_retranscribe_never_overwrites_user_titles() {
        assert!(is_auto_generated_title(
            "Toplantı - 30 September 2026, 16:29"
        ));
        assert!(is_auto_generated_title("İçe Aktarıldı: q3-roadmap-demo"));
        assert!(is_auto_generated_title(
            "Google Meet Toplantısı (abc-defg-hij) - 30 Eylül"
        ));
        assert!(is_auto_generated_title("   "));
        assert!(!is_auto_generated_title("Q3 bütçe toplantısı"));
        assert!(!is_auto_generated_title("Müşteri görüşmesi - Acme"));
    }

    use super::*;

    #[test]
    fn test_mix_channels_averages_and_pads_short_channels() {
        assert_eq!(mix_channels(&[]), Vec::<f32>::new());
        assert_eq!(mix_channels(&[vec![0.5, -0.5]]), vec![0.5, -0.5]);
        assert_eq!(
            mix_channels(&[vec![1.0, 1.0, 1.0], vec![0.0, 1.0]]),
            vec![0.5, 1.0, 0.5]
        );
    }

    #[test]
    fn test_decode_keeps_stereo_channels_apart_and_resamples() {
        // Left = 440 Hz (microphone), right = silence (system audio), 48 kHz.
        let path =
            std::env::temp_dir().join(format!("echomind_test_stereo_{}.wav", std::process::id()));
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 48000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(&path, spec).unwrap();
        for i in 0..48000 {
            let v = (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48000.0).sin() * 0.5;
            w.write_sample((v * 32767.0) as i16).unwrap();
            w.write_sample(0i16).unwrap();
        }
        w.finalize().unwrap();

        let ch = decode_audio_file_channels_16k(&path).unwrap();
        assert_eq!(ch.len(), 2);
        assert!(
            (ch[0].len() as i64 - 16000).abs() < 100,
            "len {}",
            ch[0].len()
        );
        let rms = |v: &[f32]| (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt();
        assert!(rms(&ch[0][500..]) > 0.3);
        assert!(rms(&ch[1]) < 1e-4);
        let (mono, _) = decode_audio_file_to_pcm16k(&path).unwrap();
        assert!(
            (rms(&mono[500..]) - rms(&ch[0][500..]) / 2.0).abs() < 0.02,
            "mono is the channel average"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn test_import_user_file() {
        let test_file = PathBuf::from("/Users/macbookpro/Downloads/Çekirdek_Dökümü.mp4");
        if test_file.exists() {
            let res = decode_audio_file_to_pcm16k(&test_file);
            assert!(res.is_ok());
        }
    }
}
