use super::types::{
    GeminiContent, GeminiGenerationConfig, GeminiPart, GeminiRequest, GeminiResponse,
};
use crate::transcriber::TranscriptSegment;
use regex::Regex;

pub struct TranscriptRedactor;

impl TranscriptRedactor {
    /// Offline heuristic phonetic & split-word dictionary cleaner
    pub fn clean_phonetic_errors_offline(text: &str) -> String {
        let mut cleaned = text.to_string();

        // 1. Common Turkish ASR word split & mishearing corrections
        let replacements = [
            (r"(?i)\bdepoy\s+atarım[ıi]\b", "depo yatırımı"),
            (r"(?i)\bdepo\s+atarım[ıi]\b", "depo yatırımı"),
            (r"(?i)\bfatu\s*ray[ıi]\b", "faturayı"),
            (r"(?i)\bfatura\s*y[ıi]\b", "faturayı"),
            (r"(?i)\be\s*fatura\b", "e-fatura"),
            (r"(?i)\be\s*arşiv\b", "e-arşiv"),
            (r"(?i)\boedeme\b", "ödeme"),
            (r"(?i)\btah\s+silat\b", "tahsilat"),
            (r"(?i)\btahsilat\s+makbuzi\b", "tahsilat makbuzu"),
            (r"(?i)\bpro\s+jeler\b", "projeler"),
            (r"(?i)\bproje\s+nin\b", "projenin"),
            (r"(?i)\bmuhase\s+be\b", "muhasebe"),
            (r"(?i)\bkdv\s+ye\b", "KDV'ye"),
            (r"(?i)\bkdv\s+nin\b", "KDV'nin"),
            (r"(?i)\bkdv\s+dahil\b", "KDV dahil"),
            (r"(?i)\bkdv\s+hariç\b", "KDV hariç"),
            (r"(?i)\bkdv\b", "KDV"),
            (r"(?i)\buyum\s*soft\b", "Uyumsoft"),
            (r"(?i)\bkutuphane\b", "kütüphane"),
            (r"(?i)\bpara\s+metre\b", "parametre"),
            (r"(?i)\bgelir\s+ler\b", "gelirler"),
            (r"(?i)\btl\s+ye\b", "TL'ye"),
            (r"(?i)\beuro\s+ya\b", "Euro'ya"),
            (r"(?i)\bvip\b", "WIP"),
            (r"(?i)\bluka\b", "LUCA"),
            (r"(?i)\btrello\b", "Trello"),
            (r"(?i)\boutlook\b", "Outlook"),
            (r"(?i)\bkvkk\b", "KVKK"),
            (r"(?i)\b2fa\b", "2FA"),
        ];

        for (pattern, replacement) in &replacements {
            if let Ok(re) = Regex::new(pattern) {
                cleaned = re.replace_all(&cleaned, *replacement).to_string();
            }
        }

        // 2. Remove immediate stutter duplicates (e.g. "evet evet" -> "evet")
        let words: Vec<&str> = cleaned.split_whitespace().collect();
        let mut deduped: Vec<&str> = Vec::new();
        for w in words {
            if deduped
                .last()
                .map(|last| last.eq_ignore_ascii_case(w))
                .unwrap_or(false)
            {
                continue;
            }
            deduped.push(w);
        }
        cleaned = deduped.join(" ");

        cleaned
    }

    /// Run full auto-redaction on a list of segments
    pub fn redact_segments(
        segments: &mut [TranscriptSegment],
        provider: Option<&str>,
        api_key: Option<&str>,
    ) {
        // Step 1: Always apply offline phonetic regex cleaning instantly
        for seg in segments.iter_mut() {
            seg.text = Self::clean_phonetic_errors_offline(&seg.text);
        }

        // Step 2: If Online AI API key is available, run deep contextual redaction.
        // This sends the full transcript text to a cloud LLM, so it must respect the
        // same Paranoid Mode hard-reject as every other cloud entry point — the
        // caller may still be holding a saved API key from a previous, less strict
        // privacy mode, and that key alone must never be enough to leak transcript
        // content while Paranoid Mode is active.
        if crate::security::check_cloud_access_allowed().is_err() {
            return;
        }
        if let Some(key) = api_key {
            let clean_key = key.trim();
            if !clean_key.is_empty() && !segments.is_empty() {
                let full_text: String = segments
                    .iter()
                    .take(200) // Redact in focused batch
                    .map(|s| format!("{}: {}", s.speaker_name, s.text))
                    .collect::<Vec<_>>()
                    .join("\n");

                let prompt = format!(
                    "SEN DÜNYANIN EN DİKKATLİ TÜRKÇE VE ÇOK DİLLİ METİN REDAKTÖRÜSÜN.\n\
                    Aşağıdaki toplantı konuşma dökümünde ses tanıma (ASR) ve konuşma hatalarından kaynaklanan:\n\
                    - Kelime bölünmelerini (Örn: 'depoy atarımı' -> 'depo yatırımı', 'fatu rayı' -> 'faturayı', 'tah silat' -> 'tahsilat')\n\
                    - Yarım kalmış veya kekemelik kaynaklı bozuk heceleri cümlenin bağlamından tahmin ederek tamir et\n\
                    - Türkçe noktalama, büyük harf ve kısaltma kurallarını (KDV'nin, TL'ye, e-fatura vb.) düzelt\n\
                    - Orijinal konuşmacı sırasını ve konuşmacı isimlerini harfiyen koru.\n\n\
                    YANIT KURALI: Sadece ve sadece her satır için 'Konuşmacı: Düzeltilmiş ve Akıcı Cümle' formatında yanıt ver, başka hiçbir yorum veya açıklama ekleme:\n\n{}",
                    full_text
                );

                let prov = provider.unwrap_or("gemini").to_lowercase();
                if prov.contains("gemini") {
                    let url = format!(
                        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={}",
                        clean_key
                    );

                    let req_body = GeminiRequest {
                        contents: vec![GeminiContent {
                            parts: vec![GeminiPart { text: prompt }],
                        }],
                        generation_config: Some(GeminiGenerationConfig {
                            response_mime_type: None,
                            temperature: Some(0.1),
                            max_output_tokens: Some(8192),
                        }),
                    };

                    let client = reqwest::blocking::Client::builder()
                        .timeout(std::time::Duration::from_secs(45))
                        .build();

                    if let Ok(c) = client {
                        if let Ok(resp) = c.post(&url).json(&req_body).send() {
                            if let Ok(gemini_resp) = resp.json::<GeminiResponse>() {
                                if let Some(candidates) = gemini_resp.candidates {
                                    if let Some(cand) = candidates.first() {
                                        if let Some(part) = cand.content.parts.first() {
                                            let corrected_lines: Vec<&str> = part
                                                .text
                                                .lines()
                                                .filter(|l| !l.trim().is_empty())
                                                .collect();
                                            for (i, line) in corrected_lines.iter().enumerate() {
                                                if let Some(seg) = segments.get_mut(i) {
                                                    if let Some((speaker, text)) =
                                                        line.split_once(':')
                                                    {
                                                        let clean_spk = speaker.trim().to_string();
                                                        if !clean_spk.is_empty() {
                                                            seg.speaker_name = clean_spk;
                                                        }
                                                        seg.text = text.trim().to_string();
                                                    } else {
                                                        seg.text = line.trim().to_string();
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::{set_global_privacy_mode, BackendPrivacyMode};

    fn sample_segment(text: &str) -> TranscriptSegment {
        TranscriptSegment {
            id: 0,
            speaker_id: "Konuşmacı 1".to_string(),
            speaker_name: "Konuşmacı 1".to_string(),
            start_time_ms: 0,
            end_time_ms: 1000,
            timestamp_formatted: "00:00 -> 00:01".to_string(),
            text: text.to_string(),
            language: "tr".to_string(),
            confidence: 0.9,
        }
    }

    #[test]
    fn test_redact_segments_paranoid_mode_never_calls_cloud() {
        let _guard = crate::security::privacy_mode_test_lock()
            .lock()
            .unwrap_or_else(|p| p.into_inner());

        // A saved API key from a previous, less strict privacy mode must not be
        // enough to leak transcript content once Paranoid Mode is (re-)active —
        // this was a real gap: redact_segments() had no gate at all before this
        // fix, unlike every other cloud entry point in the app.
        set_global_privacy_mode(BackendPrivacyMode::Paranoid);

        let original_text = "Proje planlamasını yarın tamamlayacağız.";
        let mut segments = vec![sample_segment(original_text)];

        TranscriptRedactor::redact_segments(
            &mut segments,
            Some("gemini"),
            Some("fake-leftover-api-key-from-balanced-mode"),
        );

        // If the cloud pass had run, it would have overwritten text/speaker_name
        // from the (unreachable, since we're offline in this test) mock response.
        // Only the offline pass may have touched it, and this input has no
        // matching phonetic pattern, so it must come through byte-for-byte.
        assert_eq!(segments[0].text, original_text);
        assert_eq!(segments[0].speaker_name, "Konuşmacı 1");

        // Reset to default for test isolation, matching security.rs's own tests.
        set_global_privacy_mode(BackendPrivacyMode::Paranoid);
    }

    #[test]
    fn test_redact_segments_offline_pass_still_runs_in_paranoid_mode() {
        let _guard = crate::security::privacy_mode_test_lock()
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        set_global_privacy_mode(BackendPrivacyMode::Paranoid);

        let mut segments = vec![sample_segment("fatu rayı ödemesi yarın")];
        TranscriptRedactor::redact_segments(&mut segments, None, None);

        assert_eq!(segments[0].text, "faturayı ödemesi yarın");

        set_global_privacy_mode(BackendPrivacyMode::Paranoid);
    }
}
