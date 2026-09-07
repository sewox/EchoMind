use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::transcriber::TranscriptSegment;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SpeakerAnalytics {
    pub speaker_id: String,
    pub speaker_name: String,
    pub total_speech_seconds: f64,
    pub talk_percentage: f64,
    pub word_count: usize,
    pub wpm: f64,
    pub segment_count: usize,
    pub longest_monologue_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeetingAnalytics {
    pub total_duration_seconds: f64,
    pub total_speech_seconds: f64,
    pub total_silence_seconds: f64,
    pub silence_percentage: f64,
    pub total_words: usize,
    pub average_wpm: f64,
    pub meeting_balance_score: u32, // 0 - 100
    pub speaker_stats: Vec<SpeakerAnalytics>,
    pub dominant_speaker: Option<String>,
    pub dominant_speaker_percentage: f64,
    pub meeting_pace_label: String, // "Fast", "Moderate", "Calm"
    pub key_insights: Vec<String>,
}

pub struct AnalyticsEngine;

impl AnalyticsEngine {
    pub fn calculate(segments: &[TranscriptSegment], total_duration_seconds: Option<f64>) -> MeetingAnalytics {
        if segments.is_empty() {
            let dur = total_duration_seconds.unwrap_or(0.0);
            return MeetingAnalytics {
                total_duration_seconds: dur,
                total_speech_seconds: 0.0,
                total_silence_seconds: dur,
                silence_percentage: if dur > 0.0 { 100.0 } else { 0.0 },
                total_words: 0,
                average_wpm: 0.0,
                meeting_balance_score: 0,
                speaker_stats: Vec::new(),
                dominant_speaker: None,
                dominant_speaker_percentage: 0.0,
                meeting_pace_label: "Calm".to_string(),
                key_insights: vec!["Toplantıda kayıtlı konuşma segmenti bulunamadı.".to_string()],
            };
        }

        // 1. Group by speaker
        struct SpeakerAccumulator {
            speaker_id: String,
            speaker_name: String,
            speech_ms: u64,
            words: usize,
            segment_count: usize,
            longest_monologue_ms: u64,
        }

        let mut speaker_map: HashMap<String, SpeakerAccumulator> = HashMap::new();
        let mut total_words = 0;
        let mut total_speech_ms = 0u64;
        let mut max_end_ms = 0u64;

        for seg in segments {
            let seg_dur_ms = if seg.end_time_ms > seg.start_time_ms {
                seg.end_time_ms - seg.start_time_ms
            } else {
                1000 // default fallback 1s if timestamps are equal or malformed
            };

            total_speech_ms += seg_dur_ms;
            if seg.end_time_ms > max_end_ms {
                max_end_ms = seg.end_time_ms;
            }

            let word_count = seg.text.split_whitespace().count();
            total_words += word_count;

            let key = if !seg.speaker_id.trim().is_empty() {
                seg.speaker_id.clone()
            } else {
                "speaker_unknown".to_string()
            };

            let entry = speaker_map.entry(key.clone()).or_insert_with(|| SpeakerAccumulator {
                speaker_id: seg.speaker_id.clone(),
                speaker_name: if !seg.speaker_name.trim().is_empty() {
                    seg.speaker_name.clone()
                } else {
                    seg.speaker_id.clone()
                },
                speech_ms: 0,
                words: 0,
                segment_count: 0,
                longest_monologue_ms: 0,
            });

            entry.speech_ms += seg_dur_ms;
            entry.words += word_count;
            entry.segment_count += 1;
            if seg_dur_ms > entry.longest_monologue_ms {
                entry.longest_monologue_ms = seg_dur_ms;
            }
        }

        let total_speech_seconds = (total_speech_ms as f64) / 1000.0;
        let effective_total_duration = match total_duration_seconds {
            Some(dur) if dur >= total_speech_seconds => dur,
            _ => {
                let end_secs = (max_end_ms as f64) / 1000.0;
                if end_secs >= total_speech_seconds {
                    end_secs
                } else {
                    total_speech_seconds
                }
            }
        };

        let total_silence_seconds = (effective_total_duration - total_speech_seconds).max(0.0);
        let silence_percentage = if effective_total_duration > 0.0 {
            (total_silence_seconds / effective_total_duration) * 100.0
        } else {
            0.0
        };

        // 2. Compute speaker stats
        let mut speaker_stats: Vec<SpeakerAnalytics> = Vec::new();
        let mut dominant_speaker: Option<String> = None;
        let mut dominant_speaker_percentage = 0.0;
        let mut max_speech_sec = 0.0;

        for acc in speaker_map.values() {
            let speech_sec = (acc.speech_ms as f64) / 1000.0;
            let talk_percentage = if total_speech_seconds > 0.0 {
                (speech_sec / total_speech_seconds) * 100.0
            } else {
                0.0
            };

            let wpm = if speech_sec > 0.0 {
                (acc.words as f64 / speech_sec) * 60.0
            } else {
                0.0
            };

            let longest_monologue_seconds = (acc.longest_monologue_ms as f64) / 1000.0;

            if speech_sec > max_speech_sec {
                max_speech_sec = speech_sec;
                dominant_speaker = Some(acc.speaker_name.clone());
                dominant_speaker_percentage = talk_percentage;
            }

            speaker_stats.push(SpeakerAnalytics {
                speaker_id: acc.speaker_id.clone(),
                speaker_name: acc.speaker_name.clone(),
                total_speech_seconds: (speech_sec * 10.0).round() / 10.0,
                talk_percentage: (talk_percentage * 10.0).round() / 10.0,
                word_count: acc.words,
                wpm: (wpm * 10.0).round() / 10.0,
                segment_count: acc.segment_count,
                longest_monologue_seconds: (longest_monologue_seconds * 10.0).round() / 10.0,
            });
        }

        // Sort speakers descending by total speech
        speaker_stats.sort_by(|a, b| b.total_speech_seconds.partial_cmp(&a.total_speech_seconds).unwrap_or(std::cmp::Ordering::Equal));

        // 3. Meeting Pace & Average WPM
        let average_wpm = if total_speech_seconds > 0.0 {
            (total_words as f64 / (total_speech_seconds / 60.0)).round()
        } else {
            0.0
        };

        let meeting_pace_label = if average_wpm > 155.0 {
            "Fast".to_string()
        } else if average_wpm >= 110.0 {
            "Moderate".to_string()
        } else {
            "Calm".to_string()
        };

        // 4. Meeting Balance Score (Shannon Entropy Normalized)
        let num_speakers = speaker_stats.len();
        let meeting_balance_score: u32 = if num_speakers <= 1 {
            // Single speaker: if it's a solo presentation / monologue
            50
        } else {
            let mut entropy = 0.0;
            for s in &speaker_stats {
                let p = s.talk_percentage / 100.0;
                if p > 0.0 {
                    entropy -= p * p.ln();
                }
            }
            let max_entropy = (num_speakers as f64).ln();
            if max_entropy > 0.0 {
                let normalized = (entropy / max_entropy) * 100.0;
                (normalized.round() as u32).min(100)
            } else {
                50
            }
        };

        // 5. Key Insights
        let mut key_insights = Vec::new();
        if num_speakers >= 2 {
            if meeting_balance_score >= 80 {
                key_insights.push(format!("Toplantıda konuşma süreleri dengeli dağılmış (Denge Skoru: %{}).", meeting_balance_score));
            } else if meeting_balance_score < 50 {
                if let Some(ref dom) = dominant_speaker {
                    key_insights.push(format!("{} toplantının %{:.1}'ini domine etti. Katılım dengesini artırmak için diğer konuşmacılara daha fazla söz verilebilir.", dom, dominant_speaker_percentage));
                }
            }
        } else {
            key_insights.push("Tek konuşmacılı sunum veya monolog toplantısı.".to_string());
        }

        if silence_percentage > 35.0 {
            key_insights.push(format!("Toplantının %{:.1}'i sessizlik/düşünme payı ile geçti.", silence_percentage));
        }

        for s in &speaker_stats {
            if s.longest_monologue_seconds >= 180.0 {
                key_insights.push(format!("{} tek seferde {:.0} saniyelik uzun bir monolog gerçekleştirdi.", s.speaker_name, s.longest_monologue_seconds));
                break;
            }
        }

        MeetingAnalytics {
            total_duration_seconds: (effective_total_duration * 10.0).round() / 10.0,
            total_speech_seconds: (total_speech_seconds * 10.0).round() / 10.0,
            total_silence_seconds: (total_silence_seconds * 10.0).round() / 10.0,
            silence_percentage: (silence_percentage * 10.0).round() / 10.0,
            total_words,
            average_wpm,
            meeting_balance_score,
            speaker_stats,
            dominant_speaker,
            dominant_speaker_percentage: (dominant_speaker_percentage * 10.0).round() / 10.0,
            meeting_pace_label,
            key_insights,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_dummy_segment(id: usize, speaker_id: &str, speaker_name: &str, start_ms: u64, end_ms: u64, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            id,
            speaker_id: speaker_id.to_string(),
            speaker_name: speaker_name.to_string(),
            start_time_ms: start_ms,
            end_time_ms: end_ms,
            timestamp_formatted: format!("{}:00", start_ms / 1000),
            text: text.to_string(),
            language: "tr".to_string(),
            confidence: 0.95,
        }
    }

    #[test]
    fn test_empty_segments() {
        let analytics = AnalyticsEngine::calculate(&[], Some(60.0));
        assert_eq!(analytics.total_duration_seconds, 60.0);
        assert_eq!(analytics.total_speech_seconds, 0.0);
        assert_eq!(analytics.total_words, 0);
        assert_eq!(analytics.meeting_balance_score, 0);
    }

    #[test]
    fn test_single_speaker() {
        let segments = vec![
            create_dummy_segment(1, "spk1", "Ahmet", 0, 10000, "Bugün toplantımızda yeni özellikleri değerlendiriyoruz."),
        ];
        let analytics = AnalyticsEngine::calculate(&segments, Some(20.0));
        assert_eq!(analytics.speaker_stats.len(), 1);
        assert_eq!(analytics.total_speech_seconds, 10.0);
        assert_eq!(analytics.total_silence_seconds, 10.0);
        assert_eq!(analytics.silence_percentage, 50.0);
        assert_eq!(analytics.speaker_stats[0].talk_percentage, 100.0);
        assert_eq!(analytics.dominant_speaker.as_deref(), Some("Ahmet"));
        assert_eq!(analytics.meeting_balance_score, 50);
    }

    #[test]
    fn test_two_equal_speakers_high_balance() {
        let segments = vec![
            create_dummy_segment(1, "spk1", "Ahmet", 0, 30000, "İlk 30 saniye Ahmet konuştu ve projeyi detaylandırdı."),
            create_dummy_segment(2, "spk2", "Mehmet", 30000, 60000, "İkinci 30 saniye Mehmet konuştu ve mimariyi anlattı."),
        ];
        let analytics = AnalyticsEngine::calculate(&segments, Some(60.0));
        assert_eq!(analytics.speaker_stats.len(), 2);
        assert_eq!(analytics.speaker_stats[0].talk_percentage, 50.0);
        assert_eq!(analytics.speaker_stats[1].talk_percentage, 50.0);
        assert_eq!(analytics.meeting_balance_score, 100);
        assert!(analytics.key_insights[0].contains("dengeli"));
    }

    #[test]
    fn test_unbalanced_speakers() {
        let segments = vec![
            create_dummy_segment(1, "spk1", "Ahmet", 0, 90000, "Ahmet sürekli konuştu ve neredeyse tüm toplantıyı anlattı uzunca devam etti."),
            create_dummy_segment(2, "spk2", "Mehmet", 90000, 100000, "Tamam anladım."),
        ];
        let analytics = AnalyticsEngine::calculate(&segments, Some(100.0));
        assert_eq!(analytics.speaker_stats.len(), 2);
        assert!(analytics.speaker_stats[0].talk_percentage >= 89.0);
        assert!(analytics.meeting_balance_score < 50);
        assert_eq!(analytics.dominant_speaker.as_deref(), Some("Ahmet"));
    }
}
