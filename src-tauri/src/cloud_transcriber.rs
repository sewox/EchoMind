use crate::transcriber::TranscriptSegment;
use reqwest::blocking::multipart::{Form, Part};
use reqwest::blocking::{Client, Response};
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::time::Duration;

/// Gemini model used when none is chosen.
pub const GEMINI_DEFAULT_MODEL: &str = "gemini-3.6-flash";
/// Tried in order where any working Gemini model will do.
pub const GEMINI_FALLBACK_MODELS: [&str; 3] = [
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash",
];

fn is_retired_gemini(model: &str) -> bool {
    model.starts_with("gemini-1.") || model.starts_with("gemini-2.0")
}

/// Gemini models to try in order: the one the user picked, or the defaults.
/// Google shut down Gemini 1.x and 2.0, so a model saved back then (or none
/// at all) gets the defaults.
fn gemini_models(chosen: Option<&str>) -> Vec<&str> {
    match chosen.map(str::trim) {
        Some(m) if !m.is_empty() && !is_retired_gemini(m) => vec![m],
        _ => GEMINI_FALLBACK_MODELS.to_vec(),
    }
}

/// Waits before each retry while the server is busy or rate limiting.
const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(2),
    Duration::from_secs(5),
    Duration::from_secs(10),
];

/// Busy, rate limited or briefly down: worth another try after a wait.
fn is_transient(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

/// Sends a request, retrying after a short wait when the server is busy or
/// the connection drops. Returns the last response, successful or not.
fn send_with_retry(
    send: impl Fn() -> reqwest::Result<Response>,
) -> Result<Response, reqwest::Error> {
    for delay in RETRY_DELAYS {
        match send() {
            Ok(resp) if !is_transient(resp.status()) => return Ok(resp),
            Ok(resp) => eprintln!(
                "⏳ Bulut sunucusu meşgul ({}), {} sn sonra yeniden denenecek",
                resp.status().as_u16(),
                delay.as_secs()
            ),
            Err(e) => eprintln!(
                "⏳ Bulut bağlantısı koptu ({e}), {} sn sonra yeniden denenecek",
                delay.as_secs()
            ),
        }
        std::thread::sleep(delay);
    }
    send()
}

/// Media type of an audio file, from its extension.
fn audio_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("m4a" | "mp4") => "audio/mp4",
        Some("ogg") => "audio/ogg",
        Some("webm") => "audio/webm",
        _ => "audio/flac",
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };

        result.push(CHARSET[(b0 >> 2) as usize] as char);
        result.push(CHARSET[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARSET[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARSET[(b2 & 0x3f) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

/// Transcribes audio using Online Cloud AI APIs (Google Gemini, Groq Cloud Whisper, or OpenAI Whisper).
/// Delivers ultra-fast, zero-hardware load transcription directly from high-end GPU clusters.
pub fn transcribe_audio_cloud(
    audio_path: &Path,
    provider: &str,
    api_key: &str,
    language: &str,
    model_version: Option<&str>,
) -> Result<Vec<TranscriptSegment>, String> {
    // 🛡️ Security Gate: Enforce Paranoid Mode backend restriction
    crate::security::check_cloud_access_allowed()?;

    if !audio_path.exists() {
        return Err(format!("Ses dosyası bulunamadı: {:?}", audio_path));
    }

    let prov = provider.to_lowercase();

    // 1. Google Gemini Multimodal Audio Transcription
    if prov == "gemini" {
        return transcribe_audio_gemini(audio_path, api_key, language, model_version);
    }

    // 2. OpenAI / Groq Whisper API
    let (endpoint, default_model) = match prov.as_str() {
        "groq" => (
            "https://api.groq.com/openai/v1/audio/transcriptions",
            "whisper-large-v3-turbo",
        ),
        "openai" => (
            "https://api.openai.com/v1/audio/transcriptions",
            "whisper-1",
        ),
        _ => return Err(format!("Desteklenmeyen bulut sağlayıcı: {}", provider)),
    };

    let model_name = model_version.unwrap_or(default_model);

    let file_bytes = fs::read(audio_path).map_err(|e| format!("Dosya okuma hatası: {}", e))?;
    let file_name = audio_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio.flac")
        .to_string();

    let client = Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let mime = audio_mime(audio_path);
    let is_auto = language.is_empty() || language.eq_ignore_ascii_case("auto");
    // A multipart form is consumed by sending it, so each try builds its own.
    let form = || -> reqwest::Result<Form> {
        let file_part = Part::bytes(file_bytes.clone())
            .file_name(file_name.clone())
            .mime_str(mime)?;
        let mut form = Form::new()
            .part("file", file_part)
            .text("model", model_name.to_string())
            .text("response_format", "verbose_json".to_string())
            .text(
                "prompt",
                "Multilingual business meeting recording (English, Turkish, German, French, Spanish and technical terms). Accurately transcribe exact speech, names, numbers and decisions with proper punctuation.".to_string(),
            );
        if !is_auto {
            form = form.text("language", language.to_string());
        }
        Ok(form)
    };

    let resp = send_with_retry(|| {
        client
            .post(endpoint)
            .header("Authorization", format!("Bearer {}", api_key.trim()))
            .multipart(form()?)
            .send()
    })
    .map_err(|e| format!("Bulut ASR sunucusuna bağlanılamadı: {}", e))?;

    if !resp.status().is_success() {
        let err_text = resp.text().unwrap_or_default();
        return Err(format!("Bulut ASR hatası ({}): {}", provider, err_text));
    }

    let json_val: Value = resp
        .json()
        .map_err(|e| format!("Bulut yanıtı JSON ayrıştırma hatası: {}", e))?;

    let mut segments: Vec<TranscriptSegment> = Vec::new();

    if let Some(segs) = json_val.get("segments").and_then(|s| s.as_array()) {
        for (idx, seg) in segs.iter().enumerate() {
            let start = seg.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let end = seg.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let text = seg
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            if text.is_empty() {
                continue;
            }

            let start_ms = (start * 1000.0) as u64;
            let end_ms = (end * 1000.0) as u64;

            let start_min = start_ms / 60000;
            let start_sec = (start_ms % 60000) / 1000;
            let end_min = end_ms / 60000;
            let end_sec = (end_ms % 60000) / 1000;

            let timestamp_formatted = format!(
                "{:02}:{:02} -> {:02}:{:02}",
                start_min, start_sec, end_min, end_sec
            );

            segments.push(TranscriptSegment {
                id: idx + 1,
                speaker_id: "Konuşmacı 1".to_string(),
                speaker_name: "Konuşmacı 1".to_string(),
                start_time_ms: start_ms,
                end_time_ms: end_ms,
                timestamp_formatted,
                text,
                language: language.to_string(),
                confidence: 0.99,
            });
        }
    } else if let Some(full_text) = json_val.get("text").and_then(|t| t.as_str()) {
        if !full_text.trim().is_empty() {
            segments.push(TranscriptSegment {
                id: 1,
                speaker_id: "Konuşmacı 1".to_string(),
                speaker_name: "Konuşmacı 1".to_string(),
                start_time_ms: 0,
                end_time_ms: 10000,
                timestamp_formatted: "00:00 -> 00:10".to_string(),
                text: full_text.trim().to_string(),
                language: language.to_string(),
                confidence: 0.99,
            });
        }
    }

    Ok(segments)
}

/// Generation settings for a transcript: bare JSON in a fixed shape and room
/// for long answers. Thinking spends output tokens and adds nothing to a
/// transcript, so it is kept to the minimum each model family allows.
fn gemini_generation_config(model: &str) -> Value {
    let mut config = json!({
        "temperature": 0.0,
        "maxOutputTokens": 32768,
        "responseMimeType": "application/json",
        "responseSchema": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "start": { "type": "NUMBER" },
                    "end": { "type": "NUMBER" },
                    "speaker": { "type": "STRING" },
                    "text": { "type": "STRING" }
                },
                "required": ["start", "end", "text"]
            }
        }
    });
    if model.starts_with("gemini-2.5-flash") {
        config["thinkingConfig"] = json!({ "thinkingBudget": 0 });
    } else if !model.starts_with("gemini-2.") {
        config["thinkingConfig"] = json!({ "thinkingLevel": "minimal" });
    }
    config
}

/// The answer text of a Gemini response. A cut-off answer (output limit,
/// safety stop) is an error: half a transcript must not pass for a whole one.
fn gemini_answer(response: &Value) -> Result<String, String> {
    let candidate = response
        .get("candidates")
        .and_then(|c| c.get(0))
        .ok_or("Gemini boş yanıt döndürdü")?;
    let reason = candidate
        .get("finishReason")
        .and_then(Value::as_str)
        .unwrap_or("STOP");
    if reason != "STOP" {
        return Err(format!("Gemini yanıtı yarıda kesildi ({reason})"));
    }
    Ok(candidate
        .pointer("/content/parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|p| !p.get("thought").and_then(Value::as_bool).unwrap_or(false))
        .filter_map(|p| p.get("text").and_then(Value::as_str))
        .collect())
}

fn transcribe_audio_gemini(
    audio_path: &Path,
    api_key: &str,
    language: &str,
    model_version: Option<&str>,
) -> Result<Vec<TranscriptSegment>, String> {
    let file_bytes =
        fs::read(audio_path).map_err(|e| format!("Ses dosyası okuma hatası: {}", e))?;
    let b64_audio = base64_encode(&file_bytes);

    let client = Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let prompt = "Sen profesyonel, kesin ve harfiyen (verbatim) bir ses deşifre (Speech-To-Text) motorusun.\n\
        Görevin ses kaydında konuşulan gerçek kelimeleri birebir, hiçbir şey eklemeden veya uydurmadan metne dökmektir.\n\n\
        KESİN KURALLAR:\n\
        1. SADECE VE SADECE ses dosyasında GERÇEKTE söylenen kelimeleri yaz. Asla kelime tahmin etme, cümle tamamlama veya hayali konuşma üretme.\n\
        2. Ses kalitesi düşük veya sessiz olan kısımlara kesinlikle uydurma metin yazma.\n\
        3. Konuşmacı ayrımı: Konuşmacıları 'Konuşmacı 1', 'Konuşmacı 2' şeklinde etiketle (eğer konuşma içinde açıkça bir isimle hitap ediliyorsa o ismi kullan).\n\
        4. Zaman damgaları: 'start' ve 'end' saniye cinsinden ondalıklı olsun.\n\
        5. SADECE aşağıdaki JSON dizisi formatında yanıt döndür (başka hiçbir açıklama metni ekleme):\n\
        [\n  {\"start\": 0.0, \"end\": 4.2, \"speaker\": \"Konuşmacı 1\", \"text\": \"Söylenen gerçek cümle buraya yazılacak.\"}\n]";

    let contents = json!([{
        "parts": [
            {
                "inline_data": {
                    "mime_type": audio_mime(audio_path),
                    "data": b64_audio
                }
            },
            {
                "text": prompt
            }
        ]
    }]);

    // A busy or missing model hands over to the next one; any other error
    // (bad key, bad request) would fail the same way on every model.
    let mut last_err = String::new();
    let mut ok = None;
    for model in gemini_models(model_version) {
        let endpoint = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model,
            api_key.trim()
        );
        let body = json!({
            "contents": contents,
            "generationConfig": gemini_generation_config(model),
        });
        let resp = send_with_retry(|| {
            client
                .post(&endpoint)
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
        })
        .map_err(|e| format!("Google Gemini sunucusuna bağlanılamadı: {}", e))?;
        let status = resp.status();
        if status.is_success() {
            ok = Some(resp);
            break;
        }
        last_err = format!(
            "Google Gemini ASR hatası ({model}): {}",
            resp.text().unwrap_or_default()
        );
        if !(is_transient(status) || status == StatusCode::NOT_FOUND) {
            break;
        }
        eprintln!(
            "⚠️ {model} yanıt vermedi ({}), sonraki model deneniyor",
            status.as_u16()
        );
    }
    let Some(resp) = ok else {
        return Err(last_err);
    };

    let json_val: Value = resp
        .json()
        .map_err(|e| format!("Gemini JSON yanıtı ayrıştırma hatası: {}", e))?;

    let text_output = gemini_answer(&json_val)?;

    let mut segments: Vec<TranscriptSegment> = Vec::new();

    // The schema asks for bare JSON; older models may still wrap it in a
    // code block. Anything unparseable is an error, never a transcript line.
    let cleaned_json = text_output
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let parsed_segs = serde_json::from_str::<Vec<Value>>(cleaned_json)
        .map_err(|e| format!("Gemini yanıtı okunamadı: {e}"))?;
    for (idx, seg) in parsed_segs.iter().enumerate() {
        let start = seg.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let end = seg
            .get("end")
            .and_then(|v| v.as_f64())
            .unwrap_or(start + 5.0);
        let speaker = seg
            .get("speaker")
            .and_then(|v| v.as_str())
            .unwrap_or("Konuşmacı 1")
            .to_string();
        let text = seg
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        if text.is_empty() {
            continue;
        }

        let start_ms = (start * 1000.0) as u64;
        let end_ms = (end * 1000.0) as u64;

        let start_min = start_ms / 60000;
        let start_sec = (start_ms % 60000) / 1000;
        let end_min = end_ms / 60000;
        let end_sec = (end_ms % 60000) / 1000;

        let timestamp_formatted = format!(
            "{:02}:{:02} -> {:02}:{:02}",
            start_min, start_sec, end_min, end_sec
        );

        segments.push(TranscriptSegment {
            id: idx + 1,
            speaker_id: speaker.clone(),
            speaker_name: speaker,
            start_time_ms: start_ms,
            end_time_ms: end_ms,
            timestamp_formatted,
            text,
            language: language.to_string(),
            confidence: 0.99,
        });
    }

    Ok(segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cloud_transcriber_non_existent_file() {
        let path = Path::new("non_existent_audio.flac");
        let res = transcribe_audio_cloud(path, "groq", "dummy_key", "tr", None);
        assert!(res.is_err());
    }

    #[test]
    fn test_base64_encode() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_encode(b"EchoMind"), "RWNob01pbmQ=");
    }

    #[test]
    fn a_chosen_gemini_model_is_tried_alone() {
        assert_eq!(
            gemini_models(Some("gemini-3.8-flash")),
            ["gemini-3.8-flash"]
        );
        assert_eq!(gemini_models(None), GEMINI_FALLBACK_MODELS);
        assert_eq!(
            gemini_models(Some("gemini-1.5-flash")),
            GEMINI_FALLBACK_MODELS
        );
    }

    #[test]
    fn only_busy_or_failing_servers_are_retried() {
        assert!(is_transient(StatusCode::SERVICE_UNAVAILABLE));
        assert!(is_transient(StatusCode::TOO_MANY_REQUESTS));
        assert!(is_transient(StatusCode::INTERNAL_SERVER_ERROR));
        assert!(!is_transient(StatusCode::BAD_REQUEST));
        assert!(!is_transient(StatusCode::UNAUTHORIZED));
        assert!(!is_transient(StatusCode::NOT_FOUND));
    }

    #[test]
    fn thinking_is_kept_minimal_per_model_family() {
        let level = |m: &str| gemini_generation_config(m)["thinkingConfig"].clone();
        assert_eq!(
            level("gemini-3.6-flash"),
            json!({ "thinkingLevel": "minimal" })
        );
        assert_eq!(level("gemini-2.5-flash"), json!({ "thinkingBudget": 0 }));
        assert_eq!(level("gemini-2.5-pro"), Value::Null);
    }

    #[test]
    fn a_cut_off_gemini_answer_is_an_error() {
        let answer = |reason: &str| {
            gemini_answer(&json!({ "candidates": [{
                "finishReason": reason,
                "content": { "parts": [
                    { "text": "plan", "thought": true },
                    { "text": "[]" }
                ] }
            }] }))
        };
        assert_eq!(answer("STOP").unwrap(), "[]");
        assert!(answer("MAX_TOKENS").unwrap_err().contains("MAX_TOKENS"));
        assert!(gemini_answer(&json!({})).is_err());
    }

    #[test]
    fn audio_media_type_follows_the_extension() {
        assert_eq!(audio_mime(Path::new("/tmp/piece.wav")), "audio/wav");
        assert_eq!(audio_mime(Path::new("/tmp/meeting.FLAC")), "audio/flac");
        assert_eq!(audio_mime(Path::new("/tmp/call.m4a")), "audio/mp4");
        assert_eq!(audio_mime(Path::new("/tmp/voice.mp3")), "audio/mpeg");
    }

    #[test]
    fn retired_gemini_models_fall_back_to_the_defaults() {
        for saved in [
            None,
            Some(""),
            Some("gemini-1.5-flash"),
            Some("gemini-2.0-flash-lite"),
        ] {
            assert_eq!(gemini_models(saved), GEMINI_FALLBACK_MODELS);
        }
        assert_eq!(gemini_models(Some(" gemini-2.5-pro ")), ["gemini-2.5-pro"]);
    }
}
