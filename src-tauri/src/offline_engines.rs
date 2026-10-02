use crate::transcriber::TranscriptSegment;
use std::path::Path;

/// Offline Speech Recognition Engine Types
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OfflineEngineType {
    WhisperLocal,
    AppleSpeechNative,
}

impl OfflineEngineType {
    pub fn from_identifier(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "apple_speech" | "apple_native" | "apple" => OfflineEngineType::AppleSpeechNative,
            _ => OfflineEngineType::WhisperLocal,
        }
    }
}

/// BCP-47 locale for Apple dictation from an EchoMind language code
/// ("auto" lets the bridge pick the closest supported system language).
fn apple_locale(language: &str) -> &'static str {
    match language {
        "tr" => "tr-TR",
        "en" => "en-US",
        "de" => "de-DE",
        "fr" => "fr-FR",
        "es" => "es-ES",
        _ => "auto",
    }
}

/// Transcribes an audio file with Apple's on-device dictation model
/// (macOS 26+, DictationTranscriber via the Swift bridge). Returns an error
/// — never a silent Whisper result — when unavailable, so callers can fall
/// back and label the result honestly.
pub fn transcribe_apple_speech(
    audio_path: &Path,
    language: &str,
) -> Result<Vec<TranscriptSegment>, String> {
    // Apple's file reader rejects some FLACs (ExtAudioFileRead -50), and
    // EchoMind stores recordings as FLAC: decode with our own decoder and hand
    // Apple a temporary 16 kHz WAV, removed again right after.
    let (pcm, _) = crate::importer::decode_audio_file_to_pcm16k(audio_path)?;
    transcribe_apple_pcm(&pcm, language)
}

/// [`transcribe_apple_speech`] for audio already decoded to 16 kHz mono.
pub fn transcribe_apple_pcm(pcm: &[f32], language: &str) -> Result<Vec<TranscriptSegment>, String> {
    if pcm.is_empty() {
        return Ok(Vec::new());
    }
    let wav = std::env::temp_dir().join(format!(
        "echomind-dictation-{}-{}.wav",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    write_wav_16k_mono(&wav, pcm)?;
    let result = apple::dictate(&wav, apple_locale(language));
    let _ = std::fs::remove_file(&wav);
    parse_dictation_json(&result?, language)
}

/// Minimal 16-bit PCM WAV writer (16 kHz mono), owner-only permissions.
fn write_wav_16k_mono(path: &Path, pcm: &[f32]) -> Result<(), String> {
    let data_len = (pcm.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&16000u32.to_le_bytes());
    out.extend_from_slice(&32000u32.to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for &s in pcm {
        out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    std::fs::write(path, out).map_err(|e| format!("temp wav: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Whether Apple dictation can transcribe `language` on this machine.
pub fn apple_dictation_available(language: &str) -> bool {
    apple::supported(apple_locale(language))
}

fn parse_dictation_json(json: &str, language: &str) -> Result<Vec<TranscriptSegment>, String> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Apple dictation: bad response ({e})"))?;
    if v["ok"].as_bool() != Some(true) {
        return Err(format!(
            "Apple dictation unavailable: {}",
            v["error"].as_str().unwrap_or("unknown error")
        ));
    }
    let lang = v["locale"]
        .as_str()
        .and_then(|l| l.split('-').next())
        .unwrap_or(language)
        .to_string();
    let segments = v["segments"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    let text = s["text"].as_str()?.trim().to_string();
                    if text.is_empty() {
                        return None;
                    }
                    let start = (s["start"].as_f64()? * 1000.0) as u64;
                    let end = ((s["end"].as_f64()? * 1000.0) as u64).max(start + 1);
                    Some((start, end, text))
                })
                .enumerate()
                .map(|(i, (start, end, text))| TranscriptSegment {
                    id: i + 1,
                    speaker_id: "Konuşmacı 1".to_string(),
                    speaker_name: "Konuşmacı 1".to_string(),
                    start_time_ms: start,
                    end_time_ms: end,
                    timestamp_formatted: crate::transcriber::format_span(start, end),
                    text,
                    language: lang.clone(),
                    confidence: 0.95,
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(segments)
}

#[cfg(target_os = "macos")]
mod apple {
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;
    use std::path::Path;

    extern "C" {
        fn echomind_dictate_file(path: *const c_char, locale: *const c_char) -> *mut c_char;
        fn echomind_dictation_supported(locale: *const c_char) -> i32;
        fn echomind_free_cstring(ptr: *mut c_char);
    }

    pub fn dictate(path: &Path, locale: &str) -> Result<String, String> {
        let path = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let locale = CString::new(locale).map_err(|e| e.to_string())?;
        // SAFETY: both pointers are valid NUL-terminated strings for the call;
        // the returned string is owned by us until echomind_free_cstring.
        unsafe {
            let raw = echomind_dictate_file(path.as_ptr(), locale.as_ptr());
            if raw.is_null() {
                return Err("Apple dictation: no response".into());
            }
            let out = CStr::from_ptr(raw).to_string_lossy().into_owned();
            echomind_free_cstring(raw);
            Ok(out)
        }
    }

    pub fn supported(locale: &str) -> bool {
        match CString::new(locale) {
            // SAFETY: valid NUL-terminated string for the duration of the call.
            Ok(l) => unsafe { echomind_dictation_supported(l.as_ptr()) == 1 },
            Err(_) => false,
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod apple {
    use std::path::Path;
    pub fn dictate(_path: &Path, _locale: &str) -> Result<String, String> {
        Err("Apple dictation is only available on macOS".into())
    }
    pub fn supported(_locale: &str) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_offline_engine_type_parsing() {
        assert_eq!(
            OfflineEngineType::from_identifier("apple_speech"),
            OfflineEngineType::AppleSpeechNative
        );
        // Retired "SenseVoice" (it only ever ran Whisper) maps to local Whisper.
        assert_eq!(
            OfflineEngineType::from_identifier("sensevoice"),
            OfflineEngineType::WhisperLocal
        );
        assert_eq!(
            OfflineEngineType::from_identifier("whisper"),
            OfflineEngineType::WhisperLocal
        );
    }

    #[test]
    fn test_parse_dictation_segments() {
        let json = r#"{"ok":true,"locale":"tr-TR","segments":[
            {"start":0.0,"end":3.25,"text":"Günaydın ekip"},
            {"start":3.9,"end":5.0,"text":"  "},
            {"start":65.5,"end":70.0,"text":"bütçe salı günü"}]}"#;
        let segs = parse_dictation_json(json, "auto").unwrap();
        assert_eq!(segs.len(), 2, "empty text is dropped");
        assert_eq!(segs[0].start_time_ms, 0);
        assert_eq!(segs[0].end_time_ms, 3250);
        assert_eq!(segs[1].id, 2);
        assert_eq!(segs[1].timestamp_formatted, "01:05 -> 01:10");
        assert_eq!(segs[1].language, "tr");
    }

    #[test]
    fn test_parse_dictation_error_is_an_error_not_a_silent_fallback() {
        let err =
            parse_dictation_json(r#"{"ok":false,"error":"requires_macos_26"}"#, "tr").unwrap_err();
        assert!(err.contains("requires_macos_26"));
        assert!(parse_dictation_json("not json", "tr").is_err());
    }

    #[test]
    fn test_apple_locale_mapping() {
        assert_eq!(apple_locale("tr"), "tr-TR");
        assert_eq!(apple_locale("auto"), "auto");
        assert_eq!(apple_locale("xx"), "auto");
    }

    #[test]
    fn test_wav_writer_header_and_length() {
        let path =
            std::env::temp_dir().join(format!("echomind_test_wav_{}.wav", std::process::id()));
        write_wav_16k_mono(&path, &[0.0, 0.5, -0.5, 1.5]).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 16000);
        assert_eq!(bytes.len(), 44 + 8);
        // Out-of-range input is clipped, not wrapped.
        assert_eq!(i16::from_le_bytes(bytes[50..52].try_into().unwrap()), 32767);
        let (pcm, _) = crate::importer::decode_audio_file_to_pcm16k(&path).unwrap();
        assert_eq!(pcm.len(), 4);
        let _ = std::fs::remove_file(path);
    }
}
