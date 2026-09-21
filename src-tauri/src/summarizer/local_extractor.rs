use super::cleaner::SpeechCleaner;
use super::types::SummaryResult;
use crate::storage::{ActionItem, TopicBreakdown};
use crate::transcriber::TranscriptSegment;
use std::time::Instant;

pub struct LocalSummaryExtractor;

/// Task text longer than this (after filler cleanup) is truncated at the nearest
/// word boundary. Without a cap, a single long, rambling raw utterance becomes the
/// entire action item verbatim, which reads as a transcript fragment rather than a
/// task someone could actually act on.
const MAX_ACTION_TASK_CHARS: usize = 220;

fn truncate_at_word_boundary(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let truncated: String = text.chars().take(max_chars).collect();
    match truncated.rfind(' ') {
        Some(idx) if idx > 0 => format!("{}…", &truncated[..idx]),
        _ => format!("{}…", truncated),
    }
}

impl LocalSummaryExtractor {
    /// Cleans and sanitizes raw conversational speech fragments into clear, professional action items.
    pub fn clean_action_task(raw_text: &str, is_english: bool) -> String {
        let trimmed = raw_text.trim();
        if trimmed.is_empty() {
            return String::new();
        }

        // Strip disfluencies (stutters, "şey"/"yani"/"um"/"uh"-style fillers, noise
        // markers) before anything else — otherwise those pass straight through into
        // the final action item text, which is exactly what makes it read like a raw
        // transcript fragment instead of a task.
        let lang_hint = if is_english { "en" } else { "tr" };
        let (defillered, _) = SpeechCleaner::clean_text(trimmed, Some(lang_hint));
        let trimmed: &str = if defillered.is_empty() {
            trimmed
        } else {
            &defillered
        };

        // Remove conversational filler prefixes
        let mut cleaned = trimmed.to_string();
        let prefixes_tr = [
            "ben bunu ",
            "ben ",
            "biz bunu ",
            "biz ",
            "sen bunu ",
            "lütfen ",
            "bence ",
            "aslında ",
            "hocam ",
            "arkadaşlar ",
            "tabii ki ",
            "şöyle yapalım: ",
            "şey, ",
            "yani ",
        ];
        let prefixes_en = [
            "i will ",
            "we will ",
            "we should ",
            "i think we should ",
            "let's ",
            "please ",
            "can you ",
            "basically, ",
            "so, ",
            "you know, ",
            "i'll ",
            "we'll ",
        ];

        let prefixes = if is_english {
            &prefixes_en[..]
        } else {
            &prefixes_tr[..]
        };
        for p in prefixes {
            if cleaned.to_lowercase().starts_with(p) {
                cleaned = cleaned[p.len()..].trim().to_string();
                break;
            }
        }

        if cleaned.is_empty() {
            cleaned = trimmed.to_string();
        }

        // Ensure capitalized first letter
        let mut chars = cleaned.chars();
        let capitalized = match chars.next() {
            None => String::new(),
            Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
        };

        truncate_at_word_boundary(&capitalized, MAX_ACTION_TASK_CHARS)
    }

    /// Normalizes and cleans assignee names, stripping meaningless placeholders like @Fully, PENDING, null, TODO.
    /// Ensures only valid real names or professional roles are kept.
    pub fn clean_assignee(raw_assignee: Option<&str>, _task_text: &str) -> Option<String> {
        let raw = raw_assignee?;
        // Strip markdown, wrappers, prefixes like @, *, [, ], (, ), quotes
        let ass = raw
            .trim()
            .trim_matches(|c: char| {
                c == '@'
                    || c == '*'
                    || c == '_'
                    || c == '['
                    || c == ']'
                    || c == '('
                    || c == ')'
                    || c == '"'
                    || c == '\''
                    || c == '`'
                    || c == '#'
                    || c == ':'
                    || c == ';'
            })
            .trim();

        if ass.is_empty() {
            return None;
        }

        let lower = ass.to_lowercase();
        let invalid_assignees = [
            "fully",
            "pending",
            "todo",
            "to-do",
            "to do",
            "in progress",
            "doing",
            "done",
            "completed",
            "action",
            "task",
            "assigned",
            "unassigned",
            "null",
            "nil",
            "none",
            "tbd",
            "n/a",
            "na",
            "unknown",
            "speaker",
            "speaker 1",
            "speaker 2",
            "speaker 3",
            "speaker 4",
            "konuşmacı",
            "konuşmacı 1",
            "konuşmacı 2",
            "belirsiz",
            "yok",
            "atanmadı",
            "atanmamış",
            "all",
            "everyone",
            "team",
            "ekip",
            "herkes",
            "user",
            "attendee",
            "participant",
            "katılımcı",
            "system",
            "assistant",
            "ai",
            "bot",
            "admin",
            "host",
            "me",
            "you",
            "us",
            "them",
        ];

        if invalid_assignees.iter().any(|&inv| {
            lower == inv
                || lower.starts_with("speaker_")
                || lower.starts_with("speaker ")
                || lower.starts_with("konuşmacı_")
                || lower.starts_with("konuşmacı ")
                || lower.starts_with("participant ")
                || lower.starts_with("katılımcı ")
                || lower.starts_with("pending ")
                || lower.starts_with("todo ")
                || lower.starts_with("fully ")
        }) {
            return None;
        }

        // Must contain at least one alphabetic character and have length >= 2
        let has_alphabetic = ass.chars().any(|c| c.is_alphabetic());
        if !has_alphabetic || ass.chars().count() < 2 {
            return None;
        }

        Some(ass.to_string())
    }

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
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let mut action_items: Vec<ActionItem> = Vec::new();
        if let Some(actions_arr) = parsed["action_items"].as_array() {
            for act in actions_arr {
                let raw_task = act["task"].as_str().unwrap_or("").trim();
                let task = Self::clean_action_task(raw_task, false);
                if task.is_empty() {
                    continue;
                }
                let raw_assignee = act["assignee"].as_str();
                let assignee = Self::clean_assignee(raw_assignee, &task);
                let source_citations: Vec<usize> = act["source_citations"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_u64().map(|n| n as usize))
                            .collect()
                    })
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
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let phase2_deferred: Vec<String> = parsed["phase2_deferred"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let mut detailed_topics: Vec<TopicBreakdown> = Vec::new();
        if let Some(topics_arr) = parsed["detailed_topics"].as_array() {
            for t in topics_arr {
                let topic_title = t["topic_title"]
                    .as_str()
                    .unwrap_or("Genel Konu")
                    .trim()
                    .to_string();
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
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let key_decisions = if !phase1_agreed.is_empty() {
            phase1_agreed.clone()
        } else {
            key_highlights.clone()
        };

        let agenda_topics = if !detailed_topics.is_empty() {
            detailed_topics
                .iter()
                .map(|t| t.topic_title.clone())
                .collect()
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
                    if !title.is_empty()
                        && title != "Genel Konu"
                        && title != "Key Discussion Topics"
                    {
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
            "the", "and", "to", "of", "a", "in", "that", "is", "was", "for", "it", "with", "as",
            "on", "be", "at", "this", "have", "from", "or", "you", "all", "they", "we", "will",
            "can", "think", "said", "what", "about",
        ];
        let en_word_count: usize = segments
            .iter()
            .take(15)
            .map(|s| {
                s.text
                    .split_whitespace()
                    .filter(|w| {
                        let cleaned = w.to_lowercase();
                        let trimmed = cleaned.trim_matches(|c: char| !c.is_alphabetic());
                        en_markers.contains(&trimmed)
                    })
                    .count()
            })
            .sum();

        let is_mostly_english = segments
            .iter()
            .any(|s| s.language.eq_ignore_ascii_case("en"))
            || en_word_count >= 3;

        let action_keywords = [
            // Turkish
            "yapılacak",
            "kararlaştırıldı",
            "düzenlenecek",
            "eklenecek",
            "planlanacak",
            "görev",
            "aksiyon",
            "bütçe",
            "tarih",
            "haftaya",
            "anlaştık",
            "değişecek",
            "incelenecek",
            "düzeltilecek",
            "hazırlanacak",
            "onaylandı",
            "gönderilecek",
            "gönderecek",
            "paylaşılacak",
            "paylaşacak",
            "tamamlanacak",
            "bitirilecek",
            "teslim edilecek",
            "güncellenecek",
            "güncelleyecek",
            "sorumlu",
            "takip edilecek",
            "test edilecek",
            "yazılacak",
            "kontrol edilecek",
            "sunulacak",
            "çözülecek",
            "toplantı yapılacak",
            "organize edilecek",
            "entegre edilecek",
            // English
            "action",
            "will",
            "should",
            "agreed",
            "decided",
            "responsible",
            "deadline",
            "next step",
            "follow up",
            "task",
            "schedule",
            "assign",
            "implement",
            "review",
            "prepare",
            "submit",
            "send",
            "share",
            "complete",
            "finish",
            "deliver",
            "test",
            "update",
            "coordinate",
            "present",
            "deploy",
        ];

        let phase2_keywords = [
            // Turkish
            "ikinci aşama",
            "ikinci faz",
            "faz 2",
            "sonraya bırak",
            "ileride",
            "sonraki",
            "phase 2",
            "gelecekte",
            "opsiyonel",
            "şimdilik kalsın",
            // English
            "second phase",
            "future",
            "later",
            "next quarter",
            "deferred",
            "postpone",
            "optional",
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
                let prefix = if is_mostly_english {
                    "Deferred item: "
                } else {
                    "Gelecek aşamaya bırakılan: "
                };
                phase2_deferred.push(format!("{}{}", prefix, seg.text));
            } else if is_action {
                let cleaned_task = Self::clean_action_task(&seg.text, is_mostly_english);
                let cleaned_assignee = Self::clean_assignee(Some(&seg.speaker_name), &cleaned_task);
                action_items.push(ActionItem {
                    task: cleaned_task.clone(),
                    assignee: cleaned_assignee,
                    source_citations: vec![idx + 1],
                    is_completed: false,
                });
                phase1_agreed.push(cleaned_task);
            } else if seg.text.len() > 25 && key_highlights.len() < 8 {
                key_highlights.push(seg.text.clone());
            }
        }

        if key_highlights.is_empty() {
            for seg in segments.iter().take(4) {
                key_highlights.push(seg.text.clone());
            }
        }

        let first_text = segments
            .first()
            .map(|s| s.text.as_str())
            .unwrap_or("Genel görüşmeler");
        let meeting_goal = if is_mostly_english {
            format!(
                "Meeting agenda and key strategic points discussed: {}",
                first_text
            )
        } else {
            format!(
                "Gündem maddelerinin ve iş akışlarının incelenmesi amacıyla toplanıldı: {}",
                first_text
            )
        };

        let topic_title = if is_mostly_english {
            "Key Discussion Topics".to_string()
        } else {
            "Toplantı Değerlendirmeleri ve Görüşmeler".to_string()
        };
        let detailed_topics = vec![TopicBreakdown {
            topic_title,
            bullet_points: key_highlights.iter().take(5).cloned().collect(),
        }];

        let participants: Vec<String> = participants_set.into_iter().collect();
        let summary = if is_mostly_english {
            format!(
                "Recorded {} dialogue segments. Key focus: {}",
                segments.len(),
                first_text
            )
        } else {
            format!(
                "Toplantıda {} adet konuşma bölümü kaydedildi. Özet: {}",
                segments.len(),
                first_text
            )
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
            key_decisions: if !phase1_agreed.is_empty() {
                phase1_agreed
            } else {
                key_highlights
            },
            agenda_topics: vec![if is_mostly_english {
                "Agenda & Decisions".to_string()
            } else {
                "Gündem ve Kararlar".to_string()
            }],
            smart_title,
            provider_used: if is_mostly_english {
                "🔒 On-Device Fast Summary (Offline)".to_string()
            } else {
                "🔒 Cihaz İçi Hızlı Özet (Çevrimdışı)".to_string()
            },
            generation_time_ms: start_time.elapsed().as_millis() as u64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_action_task_prefixes() {
        assert_eq!(
            LocalSummaryExtractor::clean_action_task("ben bunu yarın hallederim", false),
            "Yarın hallederim"
        );
        assert_eq!(
            LocalSummaryExtractor::clean_action_task(
                "i think we should prepare the deployment",
                true
            ),
            "Prepare the deployment"
        );
        assert_eq!(
            LocalSummaryExtractor::clean_action_task("lütfen veritabanı yedeğini alın", false),
            "Veritabanı yedeğini alın"
        );
    }

    #[test]
    fn test_clean_action_task_strips_mid_sentence_fillers_not_just_leading_prefix() {
        // Regression: previously only a leading prefix was stripped, so filler words
        // anywhere else in the raw utterance passed straight through into the task
        // text, making it read like a pasted transcript fragment rather than a task.
        let raw = "şey, yani raporu hani müşteriye ııı yarın göndereceğim";
        let cleaned = LocalSummaryExtractor::clean_action_task(raw, false);
        assert!(
            !cleaned.to_lowercase().contains("şey")
                && !cleaned.to_lowercase().contains("yani")
                && !cleaned.to_lowercase().contains("hani"),
            "filler words must be removed from the middle of the task, got: {}",
            cleaned
        );
        assert!(cleaned.contains("raporu"));
        assert!(cleaned.contains("göndereceğim"));
    }

    #[test]
    fn test_clean_action_task_truncates_pathologically_long_raw_segments() {
        let long_ramble = "bu konuyu ele almamız lazım çünkü geçen hafta müşteri bize ulaştı ve dedi ki bu özelliği istiyoruz ama biz henüz başlamadık o yüzden ben bunu üstleneyim ve gelecek hafta bitireyim ve sonrasında ekiple paylaşayım ve herkes gözden geçirsin ondan sonra yayına alalım ve müşteriye haber verelim ki memnun olsunlar";
        let cleaned = LocalSummaryExtractor::clean_action_task(long_ramble, false);
        assert!(
            cleaned.chars().count() <= MAX_ACTION_TASK_CHARS,
            "task text must be bounded, got {} chars: {}",
            cleaned.chars().count(),
            cleaned
        );
        assert!(
            cleaned.ends_with('…'),
            "truncated task should be marked, got: {}",
            cleaned
        );
    }

    #[test]
    fn test_clean_assignee_removes_invalid() {
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("@Fully"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("PENDING"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("TODO"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("[TODO]"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("**Fully**"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("Speaker 1"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("speaker_2"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("konuşmacı 1"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("Unassigned"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("N/A"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("None"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("TBD"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("@"), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some(""), "Task"),
            None
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("@Ahmet"), "Task"),
            Some("Ahmet".to_string())
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("Sarah Connor"), "Task"),
            Some("Sarah Connor".to_string())
        );
        assert_eq!(
            LocalSummaryExtractor::clean_assignee(Some("DevOps Lead"), "Task"),
            Some("DevOps Lead".to_string())
        );
    }

    #[test]
    fn test_expanded_action_keywords_extraction() {
        let segments = vec![
            TranscriptSegment {
                id: 1,
                speaker_id: "spk-1".to_string(),
                speaker_name: "Ayşe".to_string(),
                start_time_ms: 0,
                end_time_ms: 3000,
                timestamp_formatted: "00:00 -> 00:03".to_string(),
                text: "Ahmet bey yarın sabah sunumu paylaşacak ve raporu tamamlayacak.".to_string(),
                language: "tr".to_string(),
                confidence: 0.95,
            },
            TranscriptSegment {
                id: 2,
                speaker_id: "spk-2".to_string(),
                speaker_name: "Mehmet".to_string(),
                start_time_ms: 3100,
                end_time_ms: 6000,
                timestamp_formatted: "00:03 -> 00:06".to_string(),
                text: "Ali bey de API belgelerini güncelleyecek ve ekibe gönderecek.".to_string(),
                language: "tr".to_string(),
                confidence: 0.98,
            },
        ];

        let res =
            LocalSummaryExtractor::generate_local_heuristic_summary(&segments, Instant::now());
        assert_eq!(res.action_items.len(), 2);
        assert!(res.action_items[0].task.contains("sunumu"));
        assert!(res.action_items[1].task.contains("güncelleyecek"));
    }
}
