use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::{Path, PathBuf};
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::storage::MeetingRecord;

/// Decodes any external audio file (.mp3, .m4a, .opus, .ogg, .wav, .flac, .aac, .3gp, .caf) into 16,000 Hz Mono float32 PCM samples.
pub fn decode_audio_file_to_pcm16k(file_path: &Path) -> Result<(Vec<f32>, u64), String> {
    let file = File::open(file_path).map_err(|e| format!("Ses dosyası açılamadı: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Provide hint based on file extension
    let mut hint = Hint::new();
    if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();
    let decoder_opts = DecoderOptions::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| format!("Ses formatı çözümlenemedi: {:?}", e))?;

    let mut format_reader = probed.format;
    let track = format_reader
        .tracks()
        .iter()
        .find(|t| t.codec_params.sample_rate.is_some())
        .cloned()
        .ok_or_else(|| "Ses izi (audio track) bulunamadı".to_string())?;

    let src_sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let num_channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &decoder_opts)
        .map_err(|e| format!("Ses dekoderi oluşturulamadı: {:?}", e))?;

    let track_id = track.id;
    let mut raw_pcm_samples: Vec<f32> = Vec::new();

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
                append_audio_buffer_samples(&decoded, &mut raw_pcm_samples, num_channels);
            }
            Err(Error::DecodeError(_)) => continue,
            Err(e) => return Err(format!("Dekodlama hatası: {:?}", e)),
        }
    }

    if raw_pcm_samples.is_empty() {
        return Err("Ses dosyasından veri okunamadı".to_string());
    }

    // Resample to 16,000 Hz Mono PCM
    let target_sample_rate = 16000;
    let resampled_pcm = resample_mono_pcm(&raw_pcm_samples, src_sample_rate, target_sample_rate);
    drop(raw_pcm_samples); // Immediately free raw uncompressed vector from RAM

    let duration_seconds = (resampled_pcm.len() as u64) / (target_sample_rate as u64);

    Ok((resampled_pcm, duration_seconds))
}

fn append_audio_buffer_samples(decoded: &AudioBufferRef, out: &mut Vec<f32>, num_channels: usize) {
    match decoded {
        AudioBufferRef::F32(buf) => {
            let planes = buf.planes();
            let num_frames = buf.frames();
            for frame in 0..num_frames {
                let mut sum = 0.0;
                for ch in 0..num_channels {
                    if ch < planes.planes().len() {
                        sum += planes.planes()[ch][frame];
                    }
                }
                out.push(sum / (num_channels as f32));
            }
        }
        AudioBufferRef::U8(buf) => {
            let planes = buf.planes();
            let num_frames = buf.frames();
            for frame in 0..num_frames {
                let mut sum = 0.0;
                for ch in 0..num_channels {
                    if ch < planes.planes().len() {
                        sum += (planes.planes()[ch][frame] as f32 - 128.0) / 128.0;
                    }
                }
                out.push(sum / (num_channels as f32));
            }
        }
        AudioBufferRef::S16(buf) => {
            let planes = buf.planes();
            let num_frames = buf.frames();
            for frame in 0..num_frames {
                let mut sum = 0.0;
                for ch in 0..num_channels {
                    if ch < planes.planes().len() {
                        sum += planes.planes()[ch][frame] as f32 / 32768.0;
                    }
                }
                out.push(sum / (num_channels as f32));
            }
        }
        AudioBufferRef::S32(buf) => {
            let planes = buf.planes();
            let num_frames = buf.frames();
            for frame in 0..num_frames {
                let mut sum = 0.0;
                for ch in 0..num_channels {
                    if ch < planes.planes().len() {
                        sum += planes.planes()[ch][frame] as f32 / 2147483648.0;
                    }
                }
                out.push(sum / (num_channels as f32));
            }
        }
        _ => {}
    }
}

fn resample_mono_pcm(src: &[f32], src_rate: u32, target_rate: u32) -> Vec<f32> {
    if src_rate == target_rate {
        return src.to_vec();
    }

    let ratio = src_rate as f64 / target_rate as f64;
    let target_len = ((src.len() as f64) / ratio) as usize;
    let mut out = Vec::with_capacity(target_len);

    for i in 0..target_len {
        let src_index = (i as f64) * ratio;
        let idx0 = src_index.floor() as usize;
        let idx1 = (idx0 + 1).min(src.len() - 1);
        let frac = (src_index - (idx0 as f64)) as f32;

        let sample0 = src.get(idx0).copied().unwrap_or(0.0);
        let sample1 = src.get(idx1).copied().unwrap_or(0.0);
        let interpolated = sample0 + frac * (sample1 - sample0);

        out.push(interpolated);
    }

    out
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

        // 4. Cloud ASR vs Offline Engines vs Local Whisper ASR
        let mut segments = None;

        if let Some(prov) = cloud_provider.as_deref() {
            let clean_prov = prov.trim().to_lowercase();
            if clean_prov == "apple_speech" || clean_prov == "apple_native" || clean_prov == "apple" {
                println!("🍎 macOS Yerel Ses Tanıma (Apple Speech / ANE) başlatılıyor...");
                if let Ok(apple_segs) = crate::offline_engines::transcribe_apple_speech(&flac_file_path, lang) {
                    segments = Some(apple_segs);
                    println!("✅ Apple Yerel Ses Tanıma tamamlandı!");
                }
            } else if clean_prov == "sensevoice" {
                println!("⚡ SenseVoice Yerel Çevrimdışı ASR başlatılıyor...");
                if let Ok(sv_segs) = crate::offline_engines::transcribe_sensevoice(&flac_file_path, lang) {
                    segments = Some(sv_segs);
                    println!("✅ SenseVoice tamamlandı!");
                }
            } else if let Some(key) = api_key.as_deref() {
                let clean_key = key.trim();
                if !clean_key.is_empty() && (clean_prov == "groq" || clean_prov == "openai" || clean_prov == "gemini") {
                    println!("🌐 Online Bulut ASR başlatılıyor (Sağlayıcı: {}, Model: {:?})...", clean_prov, model_version);
                    if let Ok(mut cloud_segs) = crate::cloud_transcriber::transcribe_audio_cloud(
                        &flac_file_path,
                        &clean_prov,
                        clean_key,
                        lang,
                        model_version.as_deref(),
                    ) {
                        crate::diarization::cluster_speakers(&mut cloud_segs, &pcm_16k, 16000, 6);
                        crate::diarization::resolve_speaker_names(&mut cloud_segs);
                        segments = Some(cloud_segs);
                        println!("✅ Online Bulut ASR başarıyla tamamlandı!");
                    } else {
                        println!("⚠️ Bulut ASR başarısız oldu, yerel modele geçiliyor...");
                    }
                }
            }
        }

        // Fallback to local Whisper engine if cloud wasn't used or failed
        let segments = match segments {
            Some(segs) => segs,
            None => {
                let transcriber = crate::transcriber::get_global_transcriber();
                let res = transcriber.transcribe_pcm(&pcm_16k, lang)?;
                // Auto-cleanup local context memory after heavy batch transcription
                transcriber.cleanup_context();
                res
            }
        };

        // Explicitly free 16k PCM vector after compression
        drop(pcm_16k);

        // Step 1: Automatic Redaction and Phonetic Error Correction Pass
        let mut segments = segments;
        crate::summarizer::TranscriptRedactor::redact_segments(
            &mut segments,
            cloud_provider.as_deref(),
            api_key.as_deref(),
        );

        // Step 2: Immediate Deep Synthesis Summary Generation (Role-Play Intelligence)
        let prov_str = cloud_provider.as_deref().unwrap_or("local");
        let summary_res = crate::summarizer::SummarizerEngine::generate_summary(
            &segments,
            prov_str,
            api_key.as_deref(),
            None,
            None,
        );

        let engine_label = if let (Some(prov), Some(key)) = (cloud_provider.as_deref(), api_key.as_deref()) {
            if !key.trim().is_empty() {
                format!("⚡ Bulut Zekası ({})", prov.to_uppercase())
            } else {
                "🔒 Bilgisayarınızda (Standart Mod)".to_string()
            }
        } else {
            "🔒 Bilgisayarınızda (Standart Mod)".to_string()
        };

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
        };

        let storage = crate::storage::get_global_storage();
        storage.add_meeting(meeting)
    })
    .await
    .map_err(|e| format!("İçe aktarma işlem hatası: {}", e))?
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
    let file = rfd::AsyncFileDialog::new()
        .add_filter(
            "Desteklenen Ses Dosyaları",
            &["mp3", "m4a", "opus", "ogg", "wav", "flac", "aac", "3gp", "mp4", "caf", "wma"],
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

            let file_size_bytes = std::fs::metadata(&path_buf)
                .map(|m| m.len())
                .unwrap_or(0);

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

#[tauri::command]
pub async fn process_audio_file_path(
    file_path: String,
    language: Option<String>,
    cloud_provider: Option<String>,
    api_key: Option<String>,
    model_version: Option<String>,
) -> Result<MeetingRecord, String> {
    import_audio_file(file_path, None, language, cloud_provider, api_key, model_version).await
}

#[tauri::command]
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
        let storage = crate::storage::get_global_storage();
        let mut meetings_lock = storage.meetings.lock().unwrap();

        let target_index = meetings_lock
            .iter()
            .position(|m| m.id == meeting_id)
            .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;

        let audio_path_opt = meetings_lock[target_index].audio_file_path.clone();
        let audio_path_str = audio_path_opt.ok_or_else(|| {
            "Bu toplantı için kaydedilmiş ses dosyası bulunamadı. Yeniden transkribe işlemi için orijinal ses kaydı gereklidir.".to_string()
        })?;

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
        let (mut pcm_16k, _) = decode_audio_file_to_pcm16k(&path)?;
        crate::audio::normalize_audio_samples(&mut pcm_16k);

        let lang = language.as_deref().unwrap_or("auto");

        // 2. Cloud ASR vs Offline Engines vs Local Whisper ASR
        let mut segments = None;

        if let Some(prov) = cloud_provider.as_deref() {
            let clean_prov = prov.trim().to_lowercase();
            if clean_prov == "apple_speech" || clean_prov == "apple_native" || clean_prov == "apple" {
                if let Ok(apple_segs) = crate::offline_engines::transcribe_apple_speech(&path, lang) {
                    segments = Some(apple_segs);
                }
            } else if clean_prov == "sensevoice" {
                if let Ok(sv_segs) = crate::offline_engines::transcribe_sensevoice(&path, lang) {
                    segments = Some(sv_segs);
                }
            } else if let Some(key) = api_key.as_deref() {
                let clean_key = key.trim();
                if !clean_key.is_empty() && (clean_prov == "groq" || clean_prov == "openai" || clean_prov == "gemini") {
                    if let Ok(mut cloud_segs) = crate::cloud_transcriber::transcribe_audio_cloud(
                        &path,
                        &clean_prov,
                        clean_key,
                        lang,
                        model_version.as_deref(),
                    ) {
                        crate::diarization::cluster_speakers(&mut cloud_segs, &pcm_16k, 16000, 6);
                        crate::diarization::resolve_speaker_names(&mut cloud_segs);
                        segments = Some(cloud_segs);
                    }
                }
            }
        }

        // Switch local model if local model key provided
        if segments.is_none() {
            if let Some(ref local_model_key) = model_version {
                if ["tiny", "base", "small", "medium", "large-v3-turbo"].contains(&local_model_key.as_str()) {
                    let _ = crate::transcriber::switch_transcription_model(local_model_key.clone());
                }
            }
            let transcriber = crate::transcriber::get_global_transcriber();
            let res = transcriber.transcribe_pcm(&pcm_16k, lang)?;
            transcriber.cleanup_context();
            segments = Some(res);
        }

        let mut segments = segments.unwrap_or_default();
        drop(pcm_16k);

        // Step 1: Redaction & phonetic correction
        crate::summarizer::TranscriptRedactor::redact_segments(
            &mut segments,
            cloud_provider.as_deref(),
            api_key.as_deref(),
        );

        // Step 2: Summary Generation with chosen summary provider
        let prov_str = summary_provider.as_deref().unwrap_or("local");
        let summary_res = crate::summarizer::SummarizerEngine::generate_summary(
            &segments,
            prov_str,
            summary_api_key.as_deref(),
            custom_endpoint.as_deref(),
            custom_model.as_deref(),
        );

        let engine_label = if let (Some(prov), Some(key)) = (cloud_provider.as_deref(), api_key.as_deref()) {
            if !key.trim().is_empty() {
                format!("⚡ Bulut Zekası ({})", prov.to_uppercase())
            } else {
                let model_name = match model_version.as_deref() {
                    Some("medium") => "Gelişmiş Mod",
                    Some("large-v3-turbo") => "Zirve Netlik",
                    Some("base") => "Hızlı Mod",
                    _ => "Standart Mod",
                };
                format!("🔒 Bilgisayarınızda ({})", model_name)
            }
        } else {
            let model_name = match model_version.as_deref() {
                Some("medium") => "Gelişmiş Mod",
                Some("large-v3-turbo") => "Zirve Netlik",
                Some("base") => "Hızlı Mod",
                _ => "Standart Mod",
            };
            format!("🔒 Bilgisayarınızda ({})", model_name)
        };

        let target = &mut meetings_lock[target_index];
        if let Some(ref st) = summary_res.smart_title {
            let clean = st.trim();
            if !clean.is_empty() {
                target.title = clean.to_string();
            }
        }
        target.segments = segments;
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

        let updated_record = target.clone();

        // Persist to disk
        let json_data = serde_json::to_string_pretty(&*meetings_lock).map_err(|e| e.to_string())?;
        std::fs::write(&storage.file_path, json_data).map_err(|e| e.to_string())?;

        Ok(updated_record)
    })
    .await
    .map_err(|e| format!("Yeniden transkribe iş parçacığı hatası: {}", e))?
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
            &["mp3", "m4a", "opus", "ogg", "wav", "flac", "aac", "3gp", "mp4", "caf", "wma"],
        )
        .set_title("Toplantı Ses Dosyası Seç")
        .pick_file()
        .await;

    match file {
        Some(handle) => {
            let path_str = handle.path().to_string_lossy().to_string();
            let meeting = import_audio_file(path_str, None, language, cloud_provider, api_key, model_version).await?;
            Ok(Some(meeting))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn read_audio_file_bytes(file_path: String) -> Result<Vec<u8>, String> {
    let mut path = PathBuf::from(&file_path);

    if !path.exists() {
        if let Ok(cwd) = std::env::current_dir() {
            let alt1 = cwd.join(&file_path);
            let alt2 = cwd.join("src-tauri").join(&file_path);
            if alt1.exists() {
                path = alt1;
            } else if alt2.exists() {
                path = alt2;
            }
        }
    }

    if !path.exists() {
        return Err(format!("Ses dosyası diskte bulunamadı: {}", file_path));
    }

    std::fs::read(&path).map_err(|e| format!("Dosya okuma hatası: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resample_mono_pcm() {
        let src_samples = vec![0.0, 0.5, 1.0, 0.5, 0.0];
        let resampled = resample_mono_pcm(&src_samples, 44100, 16000);
        assert!(!resampled.is_empty());
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
