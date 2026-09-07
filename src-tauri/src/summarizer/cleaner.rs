use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use crate::transcriber::TranscriptSegment;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CleanedSegment {
    pub id: usize,
    pub original_text: String,
    pub cleaned_text: String,
    pub removed_fillers_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CleanedTranscriptResult {
    pub segments: Vec<CleanedSegment>,
    pub total_fillers_removed: usize,
    pub original_word_count: usize,
    pub cleaned_word_count: usize,
}

pub struct SpeechCleaner;

static TR_FILLER_REGEX: OnceLock<Regex> = OnceLock::new();
static EN_FILLER_REGEX: OnceLock<Regex> = OnceLock::new();
static DE_FILLER_REGEX: OnceLock<Regex> = OnceLock::new();
static FR_FILLER_REGEX: OnceLock<Regex> = OnceLock::new();
static ES_FILLER_REGEX: OnceLock<Regex> = OnceLock::new();
static UNIVERSAL_NOISE_REGEX: OnceLock<Regex> = OnceLock::new();
static MULTI_SPACE_REGEX: OnceLock<Regex> = OnceLock::new();
static PUNCTUATION_SPACE_REGEX: OnceLock<Regex> = OnceLock::new();

impl SpeechCleaner {
    fn get_tr_filler_regex() -> &'static Regex {
        TR_FILLER_REGEX.get_or_init(|| {
            Regex::new(r"(?i)\b(ııı+|ımm+|ıı+|ııh+|eee+|ee+|aa+|şey|şeyler|yani|hani|falan|filan|açıkçası|tabiri\s+caizse)\b").unwrap()
        })
    }

    fn get_en_filler_regex() -> &'static Regex {
        EN_FILLER_REGEX.get_or_init(|| {
            Regex::new(r"(?i)\b(um+|uh+|uhm+|er+|ah+|you\s+know|sort\s+of|kind\s+of|i\s+mean|literally|honestly|basically)\b").unwrap()
        })
    }

    fn get_de_filler_regex() -> &'static Regex {
        DE_FILLER_REGEX.get_or_init(|| {
            Regex::new(r"(?i)\b(äh+|ähm+|halt|sozusagen|quasi|eigentlich|weisst\s+du|weißt\s+du)\b").unwrap()
        })
    }

    fn get_fr_filler_regex() -> &'static Regex {
        FR_FILLER_REGEX.get_or_init(|| {
            Regex::new(r"(?i)\b(euh+|bah+|enfin|genre|tu\s+sais|du\s+coup|en\s+fait)\b").unwrap()
        })
    }

    fn get_es_filler_regex() -> &'static Regex {
        ES_FILLER_REGEX.get_or_init(|| {
            Regex::new(r"(?i)\b(este+|eh+|em+|o\s+sea|pues|bueno|sabes|es\s+decir)\b").unwrap()
        })
    }

    fn get_universal_noise_regex() -> &'static Regex {
        UNIVERSAL_NOISE_REGEX.get_or_init(|| {
            Regex::new(r"\[(?i:müzik|muzik|music|alkış|alkis|applause|kahkaha|laughter|gülüşmeler|gulusmeler|öksürük|oksuruk|inaudible)\]|\((?i:müzik|muzik|music|alkış|alkis|applause|kahkaha|laughter|gülüşmeler|gulusmeler|öksürük|oksuruk|inaudible)\)|\.{4,}|-{3,}").unwrap()
        })
    }

    fn get_multi_space_regex() -> &'static Regex {
        MULTI_SPACE_REGEX.get_or_init(|| Regex::new(r"\s{2,}").unwrap())
    }

    fn get_punct_space_regex() -> &'static Regex {
        PUNCTUATION_SPACE_REGEX.get_or_init(|| Regex::new(r"\s+([,.:;?!])").unwrap())
    }

    fn remove_consecutive_repeated_words(text: &str) -> (String, usize) {
        let mut words = Vec::new();
        let mut removed_count = 0;
        let mut prev_word_clean = String::new();

        for w in text.split_whitespace() {
            let clean: String = w.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase();
            if !clean.is_empty() && clean == prev_word_clean {
                removed_count += 1;
                continue;
            }
            prev_word_clean = clean;
            words.push(w);
        }

        (words.join(" "), removed_count)
    }

    pub fn clean_text(raw_text: &str, lang_code: Option<&str>) -> (String, usize) {
        if raw_text.trim().is_empty() {
            return (String::new(), 0);
        }

        let mut text = raw_text.to_string();
        let mut removed_count = 0;

        // 1. Remove universal audio tags / Whisper noise
        let noise_regex = Self::get_universal_noise_regex();
        let noise_matches = noise_regex.find_iter(&text).count();
        if noise_matches > 0 {
            removed_count += noise_matches;
            text = noise_regex.replace_all(&text, " ").to_string();
        }

        // 2. Remove stutters / consecutive word repetitions (e.g. "ben ben bugün" -> "ben bugün")
        let (no_stutter_text, stutters_removed) = Self::remove_consecutive_repeated_words(&text);
        removed_count += stutters_removed;
        text = no_stutter_text;

        // 3. Language-specific filler words removal
        let lang = lang_code.unwrap_or("tr").to_lowercase();
        let prefix = if lang.len() >= 2 { &lang[..2] } else { "tr" };

        let filler_regex = match prefix {
            "en" => Self::get_en_filler_regex(),
            "de" => Self::get_de_filler_regex(),
            "fr" => Self::get_fr_filler_regex(),
            "es" => Self::get_es_filler_regex(),
            _ => Self::get_tr_filler_regex(),
        };

        let filler_matches = filler_regex.find_iter(&text).count();
        if filler_matches > 0 {
            removed_count += filler_matches;
            text = filler_regex.replace_all(&text, " ").to_string();
        }

        // Also clean universal "um/uh" if not english
        if prefix != "en" {
            let en_fillers = Self::get_en_filler_regex();
            let en_matches = en_fillers.find_iter(&text).count();
            if en_matches > 0 {
                removed_count += en_matches;
                text = en_fillers.replace_all(&text, " ").to_string();
            }
        }

        // 4. Clean punctuation spaces & multiple spaces
        text = Self::get_punct_space_regex().replace_all(&text, "$1").to_string();
        text = Self::get_multi_space_regex().replace_all(&text, " ").to_string();
        text = text.trim().to_string();

        // 5. Capitalize first letter if needed
        if !text.is_empty() {
            let mut chars = text.chars();
            if let Some(first) = chars.next() {
                if first.is_lowercase() {
                    let capitalized: String = first.to_uppercase().collect();
                    text = format!("{}{}", capitalized, chars.as_str());
                }
            }
        }

        (text, removed_count)
    }

    pub fn clean_segments(
        segments: &[TranscriptSegment],
        lang_code: Option<&str>,
    ) -> CleanedTranscriptResult {
        let mut cleaned_segments = Vec::with_capacity(segments.len());
        let mut total_removed = 0;
        let mut orig_words = 0;
        let mut cleaned_words = 0;

        for seg in segments {
            let seg_orig_words = seg.text.split_whitespace().count();
            orig_words += seg_orig_words;

            let (cleaned_text, removed) = Self::clean_text(&seg.text, lang_code.or(Some(&seg.language)));
            total_removed += removed;

            let seg_cleaned_words = cleaned_text.split_whitespace().count();
            cleaned_words += seg_cleaned_words;

            cleaned_segments.push(CleanedSegment {
                id: seg.id,
                original_text: seg.text.clone(),
                cleaned_text: if cleaned_text.is_empty() { seg.text.clone() } else { cleaned_text },
                removed_fillers_count: removed,
            });
        }

        CleanedTranscriptResult {
            segments: cleaned_segments,
            total_fillers_removed: total_removed,
            original_word_count: orig_words,
            cleaned_word_count: cleaned_words,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_turkish_fillers_and_stutters() {
        let raw = "ııı Merhaba arkadaşlar, yani şey bugün bütçeyi bütçeyi onaylayacağız [müzik] hani.";
        let (cleaned, count) = SpeechCleaner::clean_text(raw, Some("tr"));
        assert!(!cleaned.contains("ııı"));
        assert!(!cleaned.contains("şey"));
        assert!(!cleaned.contains("yani"));
        assert!(!cleaned.contains("hani"));
        assert!(!cleaned.contains("[müzik]"));
        assert!(!cleaned.contains("bütçeyi bütçeyi"));
        assert!(cleaned.contains("bütçeyi onaylayacağız"));
        assert!(count >= 5);
    }

    #[test]
    fn test_clean_english_fillers() {
        let raw = "Um, so basically we we need to, you know, deploy the server [applause].";
        let (cleaned, count) = SpeechCleaner::clean_text(raw, Some("en"));
        assert!(!cleaned.contains("Um"));
        assert!(!cleaned.contains("basically"));
        assert!(!cleaned.contains("you know"));
        assert!(!cleaned.contains("[applause]"));
        assert!(!cleaned.contains("we we"));
        assert!(cleaned.contains("deploy the server"));
        assert!(count >= 4);
    }

    #[test]
    fn test_clean_segments_batch() {
        let segs = vec![
            TranscriptSegment {
                id: 1,
                speaker_id: "spk1".to_string(),
                speaker_name: "Ali".to_string(),
                start_time_ms: 0,
                end_time_ms: 1000,
                timestamp_formatted: "00:00 -> 00:01".to_string(),
                text: "ııı Proje takvimini konuştuk.".to_string(),
                language: "tr".to_string(),
                confidence: 0.95,
            },
            TranscriptSegment {
                id: 2,
                speaker_id: "spk2".to_string(),
                speaker_name: "Veli".to_string(),
                start_time_ms: 1000,
                end_time_ms: 2000,
                timestamp_formatted: "00:01 -> 00:02".to_string(),
                text: "Aynen yani katılıyorum.".to_string(),
                language: "tr".to_string(),
                confidence: 0.92,
            },
        ];

        let res = SpeechCleaner::clean_segments(&segs, Some("tr"));
        assert_eq!(res.segments.len(), 2);
        assert!(res.total_fillers_removed >= 2);
        assert_eq!(res.segments[0].cleaned_text, "Proje takvimini konuştuk.");
        assert_eq!(res.segments[1].cleaned_text, "Aynen katılıyorum.");
    }
}
