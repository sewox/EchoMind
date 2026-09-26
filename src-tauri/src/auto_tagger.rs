use crate::storage::MeetingRecord;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelatedMeetingItem {
    pub id: String,
    pub title: String,
    pub date_formatted: String,
    pub duration_formatted: String,
    pub similarity_score: u32,
    pub common_tags: Vec<String>,
    pub common_participants: Vec<String>,
}

pub struct AutoTagEngine;

impl AutoTagEngine {
    /// Heuristic multi-lingual category & tag extractor for meetings
    pub fn extract_tags(
        title: &str,
        summary: &str,
        goal: Option<&str>,
        decisions: &[String],
        segments_text: &[String],
    ) -> Vec<String> {
        let mut text_corpus = format!(
            "{} {} {} {}",
            title,
            summary,
            goal.unwrap_or_default(),
            decisions.join(" ")
        );

        if segments_text.len() <= 20 {
            text_corpus.push_str(&format!(" {}", segments_text.join(" ")));
        } else {
            // First 10 and last 10 segments for fast context
            let first_slice = segments_text
                .iter()
                .take(10)
                .cloned()
                .collect::<Vec<_>>()
                .join(" ");
            let last_slice = segments_text
                .iter()
                .rev()
                .take(10)
                .cloned()
                .collect::<Vec<_>>()
                .join(" ");
            text_corpus.push_str(&format!(" {} {}", first_slice, last_slice));
        }

        let lower = text_corpus.to_lowercase();
        let mut tags = Vec::new();

        // Tag Rule Definitions (Multi-lingual: TR, EN, DE, FR, ES)
        let tag_rules: Vec<(&str, Vec<&str>)> = vec![
            (
                "Finans & Bütçe",
                vec![
                    "bütçe",
                    "maliyet",
                    "fiyat",
                    "fatura",
                    "ödeme",
                    "harcama",
                    "gelir",
                    "gider",
                    "finans",
                    "budget",
                    "cost",
                    "price",
                    "invoice",
                    "payment",
                    "expense",
                    "revenue",
                    "financial",
                    "finanz",
                    "kosten",
                    "preis",
                    "rechnung",
                    "ausgaben",
                    "coût",
                    "facture",
                    "paiement",
                    "dépense",
                    "precio",
                    "factura",
                    "pago",
                    "gasto",
                ],
            ),
            (
                "Yönetim & Strateji",
                vec![
                    "yönetim",
                    "strateji",
                    "icra",
                    "vizyon",
                    "hedef",
                    "yönetim kurulu",
                    "politika",
                    "strategy",
                    "executive",
                    "board",
                    "leadership",
                    "management",
                    "vision",
                    "milestone",
                    "roadmap",
                    "führung",
                    "vorstand",
                    "stratégie",
                    "direction",
                    "estrategia",
                    "directiva",
                ],
            ),
            (
                "Yazılım & Teknoloji",
                vec![
                    "yazılım",
                    "backend",
                    "frontend",
                    "api",
                    "sunucu",
                    "kod",
                    "mimari",
                    "devops",
                    "cloud",
                    "veritabanı",
                    "database",
                    "deploy",
                    "server",
                    "code",
                    "architecture",
                    "microservice",
                    "rust",
                    "typescript",
                    "react",
                    "git",
                    "ci/cd",
                    "docker",
                    "aws",
                    "gcp",
                    "azure",
                    "software",
                    "entwicklung",
                    "logiciel",
                    "desarrollo",
                ],
            ),
            (
                "Tasarım & UI/UX",
                vec![
                    "tasarım",
                    "figma",
                    "ui",
                    "ux",
                    "arayüz",
                    "prototip",
                    "renk",
                    "tipografi",
                    "bileşen",
                    "design",
                    "interface",
                    "prototype",
                    "wireframe",
                    "typography",
                    "layout",
                    "user experience",
                    "gestaltung",
                    "conception",
                    "diseño",
                ],
            ),
            (
                "Satış & Müşteri",
                vec![
                    "satış",
                    "müşteri",
                    "teklif",
                    "sözleşme",
                    "anlaşma",
                    "pazarlık",
                    "müşteri ilişkileri",
                    "sales",
                    "client",
                    "customer",
                    "contract",
                    "deal",
                    "lead",
                    "proposal",
                    "crm",
                    "pitch",
                    "verkauf",
                    "kunde",
                    "vertrag",
                    "vente",
                    "contrat",
                    "ventas",
                    "acuerdo",
                ],
            ),
            (
                "Pazarlama & Büyüme",
                vec![
                    "pazarlama",
                    "reklam",
                    "kampanya",
                    "büyüme",
                    "seo",
                    "sosyal medya",
                    "lansman",
                    "içerik",
                    "marketing",
                    "campaign",
                    "growth",
                    "launch",
                    "content",
                    "traffic",
                    "branding",
                    "ads",
                    "werbung",
                    "croissance",
                    "publicité",
                    "mercadeo",
                    "campaña",
                ],
            ),
            (
                "İnsan Kaynakları",
                vec![
                    "işe alım",
                    "mülakat",
                    "aday",
                    "çalışan",
                    "ik",
                    "bordro",
                    "terfi",
                    "oryantasyon",
                    "recruitment",
                    "interview",
                    "candidate",
                    "employee",
                    "hr",
                    "talent",
                    "onboarding",
                    "hiring",
                    "personal",
                    "entretien",
                    "recrutement",
                    "entrevista",
                    "contratación",
                ],
            ),
            (
                "Sprint & Operasyon",
                vec![
                    "sprint",
                    "backlog",
                    "jira",
                    "retrospective",
                    "standup",
                    "operasyon",
                    "görev",
                    "takvim",
                    "scrum",
                    "agile",
                    "kanban",
                    "timeline",
                    "operations",
                    "task",
                    "milestone",
                    "aufgabe",
                    "tâche",
                    "tarea",
                ],
            ),
        ];

        for (tag_name, keywords) in tag_rules {
            let hit_count = keywords.iter().filter(|kw| lower.contains(*kw)).count();
            if hit_count >= 1 {
                tags.push(tag_name.to_string());
            }
        }

        // Default tag if no domain matches
        if tags.is_empty() {
            tags.push("Genel Toplantı".to_string());
        }

        // Limit to top 3 most relevant tags
        tags.truncate(3);
        tags
    }

    /// Calculates semantic and metadata similarity between a target meeting and past meetings
    pub fn find_related_meetings(
        target_meeting: &MeetingRecord,
        all_meetings: &[MeetingRecord],
        limit: usize,
    ) -> Vec<RelatedMeetingItem> {
        let target_tags: HashSet<String> = target_meeting
            .tags
            .as_ref()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .collect();

        let target_participants: HashSet<String> = target_meeting
            .participants
            .as_ref()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.to_lowercase())
            .collect();

        let target_tokens =
            crate::cross_memory::CrossMeetingMemoryEngine::tokenize(&target_meeting.title);
        let target_tokens_set: HashSet<String> = target_tokens.into_iter().collect();

        let mut related_list = Vec::new();

        for meeting in all_meetings {
            if meeting.id == target_meeting.id {
                continue;
            }

            let mut score: u32 = 0;
            let mut common_tags = Vec::new();
            let mut common_participants = Vec::new();

            // 1. Common Tags (40 pts per tag)
            if let Some(ref m_tags) = meeting.tags {
                for t in m_tags {
                    if target_tags.contains(t) {
                        score += 40;
                        common_tags.push(t.clone());
                    }
                }
            }

            // 2. Common Participants (25 pts per participant)
            if let Some(ref m_parts) = meeting.participants {
                for p in m_parts {
                    if target_participants.contains(&p.to_lowercase()) {
                        score += 25;
                        common_participants.push(p.clone());
                    }
                }
            }

            // 3. Title Token Overlap (20 pts per token)
            let m_tokens = crate::cross_memory::CrossMeetingMemoryEngine::tokenize(&meeting.title);
            for t in m_tokens {
                if target_tokens_set.contains(&t) {
                    score += 20;
                }
            }

            // 4. Decision keyword overlap (10 pts)
            for d in &meeting.key_decisions {
                let d_lower = d.to_lowercase();
                if target_tags
                    .iter()
                    .any(|tag| d_lower.contains(&tag.to_lowercase()))
                {
                    score += 10;
                    break;
                }
            }

            if score > 0 {
                related_list.push(RelatedMeetingItem {
                    id: meeting.id.clone(),
                    title: meeting.title.clone(),
                    date_formatted: meeting.date_formatted.clone(),
                    duration_formatted: meeting.duration_formatted.clone(),
                    similarity_score: score,
                    common_tags,
                    common_participants,
                });
            }
        }

        // Sort by similarity score descending
        related_list.sort_by_key(|r| std::cmp::Reverse(r.similarity_score));
        related_list.truncate(limit);
        related_list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_tags_finance_and_tech() {
        let title = "Q3 Bulut Altyapı ve Bütçe Planı";
        let summary = "Sunucu maliyetlerini düşürmek ve yeni rust backend mimarisine geçiş.";
        let decisions = vec!["AWS faturasını düşür".to_string()];
        let segments = vec![
            "AWS faturası çok yüksek geliyor, bütçeyi aşıyoruz.".to_string(),
            "Rust ve microservice mimarisi ile sunucu sayısını azaltabiliriz.".to_string(),
        ];

        let tags = AutoTagEngine::extract_tags(title, summary, None, &decisions, &segments);
        assert!(tags.contains(&"Finans & Bütçe".to_string()));
        assert!(tags.contains(&"Yazılım & Teknoloji".to_string()));
    }

    #[test]
    fn test_extract_tags_design_and_hr() {
        let title = "Tasarım Ekibi İşe Alım Mülakatı";
        let summary = "Figma ve UI/UX alanında kıdemli aday görüşmesi.";
        let decisions = vec!["Adaya teklif ver".to_string()];
        let segments = vec![
            "Figma portfolyosu ve mobil UI prototipleri çok başarılıydı.".to_string(),
            "İşe alım sürecinde mülakat sonucunu olumlu değerlendirdik.".to_string(),
        ];

        let tags = AutoTagEngine::extract_tags(title, summary, None, &decisions, &segments);
        assert!(tags.contains(&"Tasarım & UI/UX".to_string()));
        assert!(tags.contains(&"İnsan Kaynakları".to_string()));
    }

    #[test]
    fn test_find_related_meetings() {
        let target = MeetingRecord {
            id: "m-target".to_string(),
            title: "Q3 Bütçe ve Altyapı".to_string(),
            date_formatted: "10.09.2026".to_string(),
            duration_seconds: 300,
            duration_formatted: "05:00".to_string(),
            audio_file_path: None,
            segments: Vec::new(),
            summary: "Bütçe değerlendirmesi".to_string(),
            key_decisions: Vec::new(),
            meeting_goal: None,
            key_highlights: None,
            action_items: None,
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: Some(vec!["Ahmet".to_string(), "Zeynep".to_string()]),
            engine_used: None,
            summary_provider: None,
            tags: Some(vec![
                "Finans & Bütçe".to_string(),
                "Yazılım & Teknoloji".to_string(),
            ]),
            transcript_pending: false,
        };

        let m1 = MeetingRecord {
            id: "m-1".to_string(),
            title: "Q2 Finans Kapanışı".to_string(),
            date_formatted: "01.08.2026".to_string(),
            duration_seconds: 300,
            duration_formatted: "05:00".to_string(),
            audio_file_path: None,
            segments: Vec::new(),
            summary: "Finans raporları".to_string(),
            key_decisions: Vec::new(),
            meeting_goal: None,
            key_highlights: None,
            action_items: None,
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: Some(vec!["Ahmet".to_string()]),
            engine_used: None,
            summary_provider: None,
            tags: Some(vec!["Finans & Bütçe".to_string()]),
            transcript_pending: false,
        };

        let m2 = MeetingRecord {
            id: "m-2".to_string(),
            title: "Pazarlama Kampanyası".to_string(),
            date_formatted: "05.08.2026".to_string(),
            duration_seconds: 300,
            duration_formatted: "05:00".to_string(),
            audio_file_path: None,
            segments: Vec::new(),
            summary: "Reklam harcamaları".to_string(),
            key_decisions: Vec::new(),
            meeting_goal: None,
            key_highlights: None,
            action_items: None,
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: Some(vec!["Can".to_string()]),
            engine_used: None,
            summary_provider: None,
            tags: Some(vec!["Pazarlama & Büyüme".to_string()]),
            transcript_pending: false,
        };

        let related = AutoTagEngine::find_related_meetings(&target, &[m1.clone(), m2.clone()], 3);
        assert!(!related.is_empty());
        assert_eq!(related[0].id, "m-1");
        assert!(related[0]
            .common_tags
            .contains(&"Finans & Bütçe".to_string()));
        assert!(related[0]
            .common_participants
            .contains(&"Ahmet".to_string()));
    }
}
