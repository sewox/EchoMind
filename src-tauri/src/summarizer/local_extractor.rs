use std::time::Instant;
use crate::storage::{ActionItem, TopicBreakdown};
use crate::transcriber::TranscriptSegment;
use super::types::SummaryResult;

pub struct LocalSummaryExtractor;

impl LocalSummaryExtractor {
    pub fn parse_rich_summary_json(
        parsed: &serde_json::Value,
        provider_name: &str,
        start_time: Instant,
    ) -> Result<SummaryResult, String> {
        let meeting_goal = parsed["meeting_goal"]
            .as_str()
            .unwrap_or("Toplantı hedefleri ve genel değerlendirmeler görüşüldü.")
            .to_string();

        let summary = parsed["summary"]
            .as_str()
            .unwrap_or(&meeting_goal)
            .to_string();

        let key_highlights: Vec<String> = parsed["key_highlights"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let mut action_items: Vec<ActionItem> = Vec::new();
        if let Some(actions_arr) = parsed["action_items"].as_array() {
            for act in actions_arr {
                let task = act["task"].as_str().unwrap_or("").trim().to_string();
                if task.is_empty() {
                    continue;
                }
                let assignee = act["assignee"]
                    .as_str()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty() && s != "null");
                let source_citations: Vec<usize> = act["source_citations"]
                    .as_array()
                    .map(|arr| arr.iter().filter_map(|v| v.as_u64().map(|n| n as usize)).collect())
                    .unwrap_or_default();
                let is_completed = act["is_completed"].as_bool().unwrap_or(false);

                action_items.push(ActionItem {
                    task,
                    assignee,
                    source_citations,
                    is_completed,
                });
            }
        }

        let phase1_agreed: Vec<String> = parsed["phase1_agreed"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let phase2_deferred: Vec<String> = parsed["phase2_deferred"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let mut detailed_topics: Vec<TopicBreakdown> = Vec::new();
        if let Some(topics_arr) = parsed["detailed_topics"].as_array() {
            for t in topics_arr {
                let topic_title = t["topic_title"].as_str().unwrap_or("Genel Konu").trim().to_string();
                let bullet_points: Vec<String> = t["bullet_points"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
                            .filter(|s| !s.is_empty())
                            .collect()
                    })
                    .unwrap_or_default();

                if !topic_title.is_empty() && !bullet_points.is_empty() {
                    detailed_topics.push(TopicBreakdown {
                        topic_title,
                        bullet_points,
                    });
                }
            }
        }

        let participants: Vec<String> = parsed["participants"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let key_decisions = if !phase1_agreed.is_empty() {
            phase1_agreed.clone()
        } else {
            key_highlights.clone()
        };

        let agenda_topics = if !detailed_topics.is_empty() {
            detailed_topics.iter().map(|t| t.topic_title.clone()).collect()
        } else {
            vec!["Genel Toplantı Gündemi".to_string()]
        };

        let smart_title = parsed["smart_title"]
            .as_str()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                if let Some(first_topic) = detailed_topics.first() {
                    let title = first_topic.topic_title.trim();
                    if !title.is_empty() && title != "Genel Konu" && title != "Key Discussion Topics" {
                        return Some(title.to_string());
                    }
                }
                None
            });

        Ok(SummaryResult {
            meeting_goal,
            key_highlights,
            action_items,
            phase1_agreed,
            phase2_deferred,
            detailed_topics,
            participants,
            summary,
            key_decisions,
            agenda_topics,
            smart_title,
            provider_used: format!("{} (Online AI)", provider_name),
            generation_time_ms: start_time.elapsed().as_millis() as u64,
        })
    }

    pub fn generate_local_heuristic_summary(
        segments: &[TranscriptSegment],
        start_time: Instant,
    ) -> SummaryResult {
        let en_markers = [
            "the", "and", "to", "of", "a", "in", "that", "is", "was", "for", "it", "with", "as", "on", "be", "at",
            "this", "have", "from", "or", "you", "all", "they", "we", "will", "can", "think", "said", "what", "about"
        ];
        let en_word_count: usize = segments.iter().take(15).map(|s| {
            s.text.split_whitespace().filter(|w| {
                let cleaned = w.to_lowercase();
                let trimmed = cleaned.trim_matches(|c: char| !c.is_alphabetic());
                en_markers.contains(&trimmed)
            }).count()
        }).sum();

        let is_mostly_english = segments.iter().any(|s| s.language.eq_ignore_ascii_case("en")) || en_word_count >= 3;

        let action_keywords = [
            // Turkish
            "yapılacak", "kararlaştırıldı", "düzenlenecek", "eklenecek", "planlanacak",
            "görev", "aksiyon", "bütçe", "tarih", "haftaya", "anlaştık", "değişecek",
            "incelenecek", "düzeltilecek", "hazırlanacak", "onaylandı",
            // English
            "action", "will", "should", "agreed", "decided", "responsible", "deadline",
            "next step", "follow up", "task", "schedule", "assign", "implement", "review", "prepare", "submit"
        ];

        let phase2_keywords = [
            // Turkish
            "ikinci aşama", "ikinci faz", "faz 2", "sonraya bırak", "ileride", "sonraki",
            "phase 2", "gelecekte", "opsiyonel", "şimdilik kalsın",
            // English
            "second phase", "future", "later", "next quarter", "deferred", "postpone", "optional"
        ];

        let mut key_highlights = Vec::new();
        let mut action_items = Vec::new();
        let mut phase1_agreed = Vec::new();
        let mut phase2_deferred = Vec::new();
        let mut participants_set = std::collections::HashSet::new();

        for (idx, seg) in segments.iter().enumerate() {
            let lower_text = seg.text.to_lowercase();
            participants_set.insert(seg.speaker_name.clone());

            let mut is_phase2 = false;
            for kw in &phase2_keywords {
                if lower_text.contains(kw) {
                    is_phase2 = true;
                    break;
                }
            }

            let mut is_action = false;
            for kw in &action_keywords {
                if lower_text.contains(kw) {
                    is_action = true;
                    break;
                }
            }

            if is_phase2 {
                let prefix = if is_mostly_english { "Deferred item: " } else { "Gelecek aşamaya bırakılan: " };
                phase2_deferred.push(format!("{}{}", prefix, seg.text));
            } else if is_action {
                action_items.push(ActionItem {
                    task: seg.text.clone(),
                    assignee: Some(seg.speaker_name.clone()),
                    source_citations: vec![idx + 1],
                    is_completed: false,
                });
                phase1_agreed.push(seg.text.clone());
            } else if seg.text.len() > 25 && key_highlights.len() < 8 {
                key_highlights.push(seg.text.clone());
            }
        }

        if key_highlights.is_empty() {
            for seg in segments.iter().take(4) {
                key_highlights.push(seg.text.clone());
            }
        }

        let first_text = segments.first().map(|s| s.text.as_str()).unwrap_or("Genel görüşmeler");
        let meeting_goal = if is_mostly_english {
            format!("Meeting agenda and key strategic points discussed: {}", first_text)
        } else {
            format!("Gündem maddelerinin ve iş akışlarının incelenmesi amacıyla toplanıldı: {}", first_text)
        };

        let topic_title = if is_mostly_english {
            "Key Discussion Topics".to_string()
        } else {
            "Toplantı Değerlendirmeleri ve Görüşmeler".to_string()
        };
        let detailed_topics = vec![
            TopicBreakdown {
                topic_title,
                bullet_points: key_highlights.iter().take(5).cloned().collect(),
            }
        ];

        let participants: Vec<String> = participants_set.into_iter().collect();
        let summary = if is_mostly_english {
            format!("Recorded {} dialogue segments. Key focus: {}", segments.len(), first_text)
        } else {
            format!("Toplantıda {} adet konuşma bölümü kaydedildi. Özet: {}", segments.len(), first_text)
        };

        let smart_title = if !key_highlights.is_empty() && key_highlights[0].len() <= 60 {
            Some(key_highlights[0].clone())
        } else if !meeting_goal.is_empty() && meeting_goal.len() <= 60 {
            Some(meeting_goal.clone())
        } else {
            None
        };

        SummaryResult {
            meeting_goal,
            key_highlights: key_highlights.clone(),
            action_items,
            phase1_agreed: phase1_agreed.clone(),
            phase2_deferred,
            detailed_topics,
            participants,
            summary,
            key_decisions: if !phase1_agreed.is_empty() { phase1_agreed } else { key_highlights },
            agenda_topics: vec![if is_mostly_english { "Agenda & Decisions".to_string() } else { "Gündem ve Kararlar".to_string() }],
            smart_title,
            provider_used: if is_mostly_english { "🔒 On-Device Fast Summary (Offline)".to_string() } else { "🔒 Cihaz İçi Hızlı Özet (Çevrimdışı)".to_string() },
            generation_time_ms: start_time.elapsed().as_millis() as u64,
        }
    }
}
