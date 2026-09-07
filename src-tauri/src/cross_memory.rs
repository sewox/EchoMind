use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use crate::storage::MeetingRecord;
use crate::summarizer::rag::{GlobalSearchResult, SearchMatch};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryQueryOptions {
    pub query: String,
    pub speaker_filter: Option<String>,
    pub min_score: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStats {
    pub total_meetings: usize,
    pub total_segments: usize,
    pub total_words: usize,
    pub unique_speakers: Vec<String>,
}

pub struct CrossMeetingMemoryEngine;

impl CrossMeetingMemoryEngine {
    /// Cleans and extracts search tokens
    pub fn tokenize(text: &str) -> Vec<String> {
        let stop_words: HashSet<&str> = [
            "ve", "ile", "için", "icin", "ne", "neler", "bir", "bu", "şu", "su",
            "da", "de", "mi", "mu", "mi?", "mu?", "var", "yok", "the", "and", "or",
            "is", "are", "to", "in", "at", "for", "with", "a", "an", "on"
        ].into_iter().collect();

        text.to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| w.len() >= 2 && !stop_words.contains(w))
            .map(|w| w.to_string())
            .collect()
    }

    /// Performs deep cross-meeting semantic and keyword search
    pub fn search(meetings: &[MeetingRecord], options: MemoryQueryOptions) -> Vec<GlobalSearchResult> {
        let tokens = Self::tokenize(&options.query);
        let q_lower = options.query.to_lowercase();
        let speaker_filter = options.speaker_filter.as_ref().map(|s| s.to_lowercase());
        let min_score = options.min_score.unwrap_or(5);

        let mut results = Vec::new();

        for meeting in meetings {
            let mut matches = Vec::new();
            let mut score: u32 = 0;

            // Optional speaker filter
            if let Some(ref target_speaker) = speaker_filter {
                let has_speaker = meeting.segments.iter().any(|s| {
                    s.speaker_name.to_lowercase().contains(target_speaker)
                        || s.speaker_id.to_lowercase().contains(target_speaker)
                });
                if !has_speaker {
                    continue;
                }
            }

            // 1. Title Search (High Weight: 50 pts)
            let title_lower = meeting.title.to_lowercase();
            if title_lower.contains(&q_lower) && !q_lower.is_empty() {
                score += 50;
                matches.push(SearchMatch {
                    match_type: "title".to_string(),
                    matched_text: meeting.title.clone(),
                    snippet: meeting.title.clone(),
                    timestamp_formatted: None,
                    start_time_ms: None,
                    speaker_name: None,
                });
            } else {
                for token in &tokens {
                    if title_lower.contains(token) {
                        score += 30;
                        matches.push(SearchMatch {
                            match_type: "title".to_string(),
                            matched_text: meeting.title.clone(),
                            snippet: meeting.title.clone(),
                            timestamp_formatted: None,
                            start_time_ms: None,
                            speaker_name: None,
                        });
                        break;
                    }
                }
            }

            // 2. Meeting Goal Search (Weight: 30 pts)
            if let Some(ref goal) = meeting.meeting_goal {
                let goal_lower = goal.to_lowercase();
                if goal_lower.contains(&q_lower) && !q_lower.is_empty() {
                    score += 35;
                    matches.push(SearchMatch {
                        match_type: "goal".to_string(),
                        matched_text: goal.clone(),
                        snippet: goal.clone(),
                        timestamp_formatted: None,
                        start_time_ms: None,
                        speaker_name: None,
                    });
                }
            }

            // 3. Key Decisions Search (Weight: 30 pts per match)
            for decision in &meeting.key_decisions {
                let dec_lower = decision.to_lowercase();
                if dec_lower.contains(&q_lower) && !q_lower.is_empty() {
                    score += 30;
                    matches.push(SearchMatch {
                        match_type: "decision".to_string(),
                        matched_text: decision.clone(),
                        snippet: decision.clone(),
                        timestamp_formatted: None,
                        start_time_ms: None,
                        speaker_name: None,
                    });
                } else {
                    for token in &tokens {
                        if dec_lower.contains(token) {
                            score += 15;
                            matches.push(SearchMatch {
                                match_type: "decision".to_string(),
                                matched_text: decision.clone(),
                                snippet: decision.clone(),
                                timestamp_formatted: None,
                                start_time_ms: None,
                                speaker_name: None,
                            });
                            break;
                        }
                    }
                }
            }

            // 4. Action Items Search (Weight: 25 pts per match)
            if let Some(ref actions) = meeting.action_items {
                for action in actions {
                    let task_lower = action.task.to_lowercase();
                    let assignee_match = action.assignee.as_ref().map(|a| a.to_lowercase().contains(&q_lower)).unwrap_or(false);

                    if task_lower.contains(&q_lower) || assignee_match {
                        score += 25;
                        matches.push(SearchMatch {
                            match_type: "action_item".to_string(),
                            matched_text: action.task.clone(),
                            snippet: format!("{}: {}", action.assignee.as_deref().unwrap_or("Atanmamış"), action.task),
                            timestamp_formatted: None,
                            start_time_ms: None,
                            speaker_name: action.assignee.clone(),
                        });
                    }
                }
            }

            // 5. Transcript Segments Search (Weight: 10 pts per segment)
            for seg in &meeting.segments {
                let text_lower = seg.text.to_lowercase();
                let is_match = if !q_lower.is_empty() && text_lower.contains(&q_lower) {
                    true
                } else {
                    tokens.iter().any(|t| text_lower.contains(t))
                };

                if is_match {
                    score += 10;
                    matches.push(SearchMatch {
                        match_type: "transcript".to_string(),
                        matched_text: seg.text.clone(),
                        snippet: seg.text.clone(),
                        timestamp_formatted: Some(seg.timestamp_formatted.clone()),
                        start_time_ms: Some(seg.start_time_ms),
                        speaker_name: Some(seg.speaker_name.clone()),
                    });
                }
            }

            if score >= min_score {
                results.push(GlobalSearchResult {
                    meeting_id: meeting.id.clone(),
                    meeting_title: meeting.title.clone(),
                    date_formatted: meeting.date_formatted.clone(),
                    duration_formatted: meeting.duration_formatted.clone(),
                    matches,
                    score,
                });
            }
        }

        // Sort results by score descending
        results.sort_by(|a, b| b.score.cmp(&a.score));
        results
    }

    /// Computes memory statistics over all stored meetings
    pub fn get_statistics(meetings: &[MeetingRecord]) -> MemoryStats {
        let total_meetings = meetings.len();
        let mut total_segments = 0;
        let mut total_words = 0;
        let mut speakers_set = HashSet::new();

        for m in meetings {
            total_segments += m.segments.len();
            for seg in &m.segments {
                total_words += seg.text.split_whitespace().count();
                if !seg.speaker_name.trim().is_empty() {
                    speakers_set.insert(seg.speaker_name.clone());
                }
            }
        }

        let mut unique_speakers: Vec<String> = speakers_set.into_iter().collect();
        unique_speakers.sort();

        MemoryStats {
            total_meetings,
            total_segments,
            total_words,
            unique_speakers,
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri Command Handlers
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn search_cross_meeting_memory(options: MemoryQueryOptions) -> Result<Vec<GlobalSearchResult>, String> {
    let storage = crate::storage::get_global_storage();
    let meetings = storage.get_all();
    let results = CrossMeetingMemoryEngine::search(&meetings, options);
    Ok(results)
}

#[tauri::command]
pub async fn get_cross_meeting_memory_stats() -> Result<MemoryStats, String> {
    let storage = crate::storage::get_global_storage();
    let meetings = storage.get_all();
    let stats = CrossMeetingMemoryEngine::get_statistics(&meetings);
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcriber::TranscriptSegment;
    use crate::storage::ActionItem;

    fn create_mock_meetings() -> Vec<MeetingRecord> {
        vec![
            MeetingRecord {
                id: "m-1".to_string(),
                title: "Q3 Bütçe ve Strateji Planlama".to_string(),
                date_formatted: "01.09.2026".to_string(),
                duration_seconds: 600,
                duration_formatted: "10:00".to_string(),
                audio_file_path: None,
                segments: vec![
                    TranscriptSegment {
                        id: 1,
                        speaker_id: "spk1".to_string(),
                        speaker_name: "Ahmet".to_string(),
                        start_time_ms: 0,
                        end_time_ms: 5000,
                        timestamp_formatted: "00:00 -> 00:05".to_string(),
                        text: "Bulut sunucu maliyetlerini düşürmemiz gerekiyor.".to_string(),
                        language: "tr".to_string(),
                        confidence: 0.95,
                    },
                ],
                summary: "Bütçe kısıtlamaları ele alındı.".to_string(),
                key_decisions: vec!["AWS yerine Hetzner sunucularına geçilecek.".to_string()],
                meeting_goal: Some("Bulut maliyetlerini %30 optimize etmek".to_string()),
                key_highlights: None,
                action_items: Some(vec![
                    ActionItem {
                        task: "Hetzner benchmark testlerini yap".to_string(),
                        assignee: Some("Ahmet".to_string()),
                        source_citations: vec![1],
                        is_completed: false,
                    }
                ]),
                phase1_agreed: None,
                phase2_deferred: None,
                detailed_topics: None,
                participants: Some(vec!["Ahmet".to_string()]),
                engine_used: None,
                summary_provider: None,
            },
            MeetingRecord {
                id: "m-2".to_string(),
                title: "Tasarım Sistemi İncelemesi".to_string(),
                date_formatted: "02.09.2026".to_string(),
                duration_seconds: 300,
                duration_formatted: "05:00".to_string(),
                audio_file_path: None,
                segments: vec![
                    TranscriptSegment {
                        id: 1,
                        speaker_id: "spk2".to_string(),
                        speaker_name: "Zeynep".to_string(),
                        start_time_ms: 0,
                        end_time_ms: 4000,
                        timestamp_formatted: "00:00 -> 00:04".to_string(),
                        text: "Figma bileşenlerini Tailwind tokenlarına bağladık.".to_string(),
                        language: "tr".to_string(),
                        confidence: 0.98,
                    },
                ],
                summary: "Yeni tasarım sistemi incelendi.".to_string(),
                key_decisions: vec!["Dark mode varsayılan tema olacak.".to_string()],
                meeting_goal: None,
                key_highlights: None,
                action_items: None,
                phase1_agreed: None,
                phase2_deferred: None,
                detailed_topics: None,
                participants: Some(vec!["Zeynep".to_string()]),
                engine_used: None,
                summary_provider: None,
            },
        ]
    }

    #[test]
    fn test_memory_tokenize() {
        let tokens = CrossMeetingMemoryEngine::tokenize("Bulut sunucu maliyetleri ve Hetzner!");
        assert!(tokens.contains(&"bulut".to_string()));
        assert!(tokens.contains(&"sunucu".to_string()));
        assert!(tokens.contains(&"maliyetleri".to_string()));
        assert!(tokens.contains(&"hetzner".to_string()));
        assert!(!tokens.contains(&"ve".to_string())); // Stopword
    }

    #[test]
    fn test_search_cross_meeting_memory() {
        let meetings = create_mock_meetings();
        let results = CrossMeetingMemoryEngine::search(&meetings, MemoryQueryOptions {
            query: "Hetzner".to_string(),
            speaker_filter: None,
            min_score: Some(10),
        });

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].meeting_id, "m-1");
        assert!(results[0].score > 30);
    }

    #[test]
    fn test_search_with_speaker_filter() {
        let meetings = create_mock_meetings();
        let results = CrossMeetingMemoryEngine::search(&meetings, MemoryQueryOptions {
            query: "bileşen".to_string(),
            speaker_filter: Some("Zeynep".to_string()),
            min_score: Some(5),
        });

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].meeting_id, "m-2");

        // Filter for a non-existent speaker
        let empty_results = CrossMeetingMemoryEngine::search(&meetings, MemoryQueryOptions {
            query: "bileşen".to_string(),
            speaker_filter: Some("Mehmet".to_string()),
            min_score: Some(5),
        });
        assert_eq!(empty_results.len(), 0);
    }

    #[test]
    fn test_memory_statistics() {
        let meetings = create_mock_meetings();
        let stats = CrossMeetingMemoryEngine::get_statistics(&meetings);

        assert_eq!(stats.total_meetings, 2);
        assert_eq!(stats.total_segments, 2);
        assert!(stats.total_words > 5);
        assert_eq!(stats.unique_speakers.len(), 2);
        assert!(stats.unique_speakers.contains(&"Ahmet".to_string()));
        assert!(stats.unique_speakers.contains(&"Zeynep".to_string()));
    }
}
