use crate::transcriber::TranscriptSegment;
use reqwest::blocking::multipart::{Form, Part};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::time::Duration;

fn base64_encode(data: &[u8]) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
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

    let file_part = Part::bytes(file_bytes)
        .file_name(file_name)
        .mime_str("audio/flac")
        .map_err(|e| e.to_string())?;

    let mut form = Form::new()
        .part("file", file_part)
        .text("model", model_name.to_string())
        .text("response_format", "verbose_json".to_string())
        .text(
            "prompt",
            "Multilingual business meeting recording (English, Turkish, German, French, Spanish and technical terms). Accurately transcribe exact speech, names, numbers and decisions with proper punctuation.".to_string(),
        );

    let is_auto = language.is_empty() || language.eq_ignore_ascii_case("auto");
    if !is_auto {
        form = form.text("language", language.to_string());
    }

    let resp = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .multipart(form)
        .send()
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

fn transcribe_audio_gemini(
    audio_path: &Path,
    api_key: &str,
    language: &str,
    model_version: Option<&str>,
) -> Result<Vec<TranscriptSegment>, String> {
    let file_bytes = fs::read(audio_path).map_err(|e| format!("Ses dosyası okuma hatası: {}", e))?;
    let b64_audio = base64_encode(&file_bytes);

    let client = Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let gemini_model = model_version.unwrap_or("gemini-1.5-flash");

    let endpoint = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        gemini_model,
        api_key.trim()
    );

    let prompt = "Sen profesyonel, kesin ve harfiyen (verbatim) bir ses deşifre (Speech-To-Text) motorusun.\n\
        Görevin ses kaydında konuşulan gerçek kelimeleri birebir, hiçbir şey eklemeden veya uydurmadan metne dökmektir.\n\n\
        KESİN KURALLAR:\n\
        1. SADECE VE SADECE ses dosyasında GERÇEKTE söylenen kelimeleri yaz. Asla kelime tahmin etme, cümle tamamlama veya hayali konuşma üretme.\n\
        2. Ses kalitesi düşük veya sessiz olan kısımlara kesinlikle uydurma metin yazma.\n\
        3. Konuşmacı ayrımı: Konuşmacıları 'Konuşmacı 1', 'Konuşmacı 2' şeklinde etiketle (eğer konuşma içinde açıkça bir isimle hitap ediliyorsa o ismi kullan).\n\
        4. Zaman damgaları: 'start' ve 'end' saniye cinsinden ondalıklı olsun.\n\
        5. SADECE aşağıdaki JSON dizisi formatında yanıt döndür (başka hiçbir açıklama metni ekleme):\n\
        [\n  {\"start\": 0.0, \"end\": 4.2, \"speaker\": \"Konuşmacı 1\", \"text\": \"Söylenen gerçek cümle buraya yazılacak.\"}\n]";

    let body = json!({
        "contents": [{
            "parts": [
                {
                    "inline_data": {
                        "mime_type": "audio/flac",
                        "data": b64_audio
                    }
                },
                {
                    "text": prompt
                }
            ]
        }],
        "generationConfig": {
            "temperature": 0.0
        }
    });

    let resp = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("Google Gemini sunucusuna bağlanılamadı: {}", e))?;

    if !resp.status().is_success() {
        let err_text = resp.text().unwrap_or_default();
        return Err(format!("Google Gemini ASR hatası: {}", err_text));
    }

    let json_val: Value = resp
        .json()
        .map_err(|e| format!("Gemini JSON yanıtı ayrıştırma hatası: {}", e))?;

    let text_output = json_val
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c0| c0.get("content"))
        .and_then(|cnt| cnt.get("parts"))
        .and_then(|p| p.get(0))
        .and_then(|p0| p0.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("");

    let mut segments: Vec<TranscriptSegment> = Vec::new();

    // Clean markdown code blocks if any
    let cleaned_json = text_output
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    if let Ok(parsed_segs) = serde_json::from_str::<Vec<Value>>(cleaned_json) {
        for (idx, seg) in parsed_segs.iter().enumerate() {
            let start = seg.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let end = seg.get("end").and_then(|v| v.as_f64()).unwrap_or(start + 5.0);
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
    } else if !text_output.trim().is_empty() {
        // Fallback if returned as raw formatted text lines
        segments.push(TranscriptSegment {
            id: 1,
            speaker_id: "Konuşmacı 1".to_string(),
            speaker_name: "Konuşmacı 1".to_string(),
            start_time_ms: 0,
            end_time_ms: 10000,
            timestamp_formatted: "00:00 -> 00:10".to_string(),
            text: text_output.trim().to_string(),
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
}
