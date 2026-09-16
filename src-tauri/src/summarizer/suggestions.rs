use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LiveSuggestionItem {
    pub id: String,
    pub category: String, // "question", "objection", "action", "insight"
    pub text: String,
    pub rationale: String,
    pub timestamp_ms: u64,
}

pub struct LiveSuggestionEngine;

impl LiveSuggestionEngine {
    /// Offline / Rule-based heuristic pattern extractor for live speech segments
    pub fn extract_heuristic_suggestions(
        recent_texts: &[String],
        lang_code: Option<&str>,
    ) -> Vec<LiveSuggestionItem> {
        let mut suggestions = Vec::new();
        let lang = lang_code.unwrap_or("tr").to_lowercase();
        let joined_text = recent_texts.join(" ").to_lowercase();

        if joined_text.trim().is_empty() {
            return suggestions;
        }

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        // Pattern 1: Budget / Cost Uncertainty (Bütçe / Fiyat Belirsizliği)
        if joined_text.contains("bütçe")
            || joined_text.contains("maliyet")
            || joined_text.contains("fiyat")
            || joined_text.contains("pahalı")
            || joined_text.contains("budget")
            || joined_text.contains("cost")
            || joined_text.contains("expensive")
            || joined_text.contains("preis")
            || joined_text.contains("kosten")
            || joined_text.contains("coût")
            || joined_text.contains("precio")
        {
            if lang.starts_with("tr") {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-cost-{}", now_ms),
                    category: "question".to_string(),
                    text: "Bu proje/hizmet için belirlenmiş tavan bütçeniz veya ödeme vadeniz nedir?".to_string(),
                    rationale: "Konuşmada maliyet/bütçe konusu geçti. Net limitleri öğrenmek süreci hızlandırır.".to_string(),
                    timestamp_ms: now_ms,
                });
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-obj-cost-{}", now_ms),
                    category: "objection".to_string(),
                    text: "Yatırımın geri dönüş süresi (ROI) ve fazlara bölerek faturalandırma modelimizi sunabilirsiniz.".to_string(),
                    rationale: "Fiyat/maliyet itirazını esnek ödeme veya getiri odaklı karşılayın.".to_string(),
                    timestamp_ms: now_ms,
                });
            } else if lang.starts_with("de") {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-cost-{}", now_ms),
                    category: "question".to_string(),
                    text: "Wie hoch ist das geplante Budget bzw. der Zahlungsrahmen?".to_string(),
                    rationale: "Kostenrahmen wurde erwähnt. Budgetgrenzen klären.".to_string(),
                    timestamp_ms: now_ms,
                });
            } else {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-cost-{}", now_ms),
                    category: "question".to_string(),
                    text: "What is the allocated budget ceiling or payment timeframe for this scope?".to_string(),
                    rationale: "Budget/cost discussed. Clarifying limits prevents scope friction.".to_string(),
                    timestamp_ms: now_ms,
                });
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-obj-cost-{}", now_ms),
                    category: "objection".to_string(),
                    text: "Highlight estimated ROI and phased milestone invoicing.".to_string(),
                    rationale: "Overcome price objection with phased delivery value.".to_string(),
                    timestamp_ms: now_ms,
                });
            }
        }

        // Pattern 2: Deadline / Timeline Vagueness (Termin / Takvim Belirsizliği)
        if joined_text.contains("ne zaman")
            || joined_text.contains("termin")
            || joined_text.contains("yetişir")
            || joined_text.contains("tarih")
            || joined_text.contains("deadline")
            || joined_text.contains("timeline")
            || joined_text.contains("zeitplan")
            || joined_text.contains("frist")
            || joined_text.contains("délai")
            || joined_text.contains("plazo")
        {
            if lang.starts_with("tr") {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-timeline-{}", now_ms),
                    category: "action".to_string(),
                    text: "Canlıya çıkış (Go-Live) için hedef kesin tarihi ve ara kilometre taşlarını (Milestones) sabitleyelim.".to_string(),
                    rationale: "Takvim belirsizliğini önlemek için net teslim tarihi talep edin.".to_string(),
                    timestamp_ms: now_ms,
                });
            } else if lang.starts_with("de") {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-timeline-{}", now_ms),
                    category: "action".to_string(),
                    text: "Zieldatum und Meilensteine verbindlich festlegen.".to_string(),
                    rationale: "Fristen und Zwischenschritte absichern.".to_string(),
                    timestamp_ms: now_ms,
                });
            } else {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-timeline-{}", now_ms),
                    category: "action".to_string(),
                    text: "Lock down the hard Go-Live deadline and phase-1 milestone dates.".to_string(),
                    rationale: "Prevent deadline ambiguity by pinning concrete target dates.".to_string(),
                    timestamp_ms: now_ms,
                });
            }
        }

        // Pattern 3: Decision Maker / Approver (Karar Verici & Yetki)
        if joined_text.contains("onay")
            || joined_text.contains("yönetim")
            || joined_text.contains("müdür")
            || joined_text.contains("soralım")
            || joined_text.contains("approval")
            || joined_text.contains("decision")
            || joined_text.contains("management")
            || joined_text.contains("genehmigung")
            || joined_text.contains("décision")
        {
            if lang.starts_with("tr") {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-decision-{}", now_ms),
                    category: "question".to_string(),
                    text: "Son onay sürecinde başka hangi paydaşlar veya departmanlar yer alacak?".to_string(),
                    rationale: "Gizli karar vericileri ve onay basamaklarını erkenden tespit edin.".to_string(),
                    timestamp_ms: now_ms,
                });
            } else {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-decision-{}", now_ms),
                    category: "question".to_string(),
                    text: "Who else needs to sign off on the final decision, and what is their approval criteria?".to_string(),
                    rationale: "Identify all key stakeholders and gatekeepers early.".to_string(),
                    timestamp_ms: now_ms,
                });
            }
        }

        // Pattern 4: Postponement / Hesitation (Erteleme / Kararsızlık)
        if joined_text.contains("sonra bakarız")
            || joined_text.contains("düşünelim")
            || joined_text.contains("haftaya")
            || joined_text.contains("later")
            || joined_text.contains("think about it")
            || joined_text.contains("später")
            || joined_text.contains("plus tard")
        {
            if lang.starts_with("tr") {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-postpone-{}", now_ms),
                    category: "insight".to_string(),
                    text: "Konuyu ertelememek için 'Gelecek Salı 15:00'te 15 dakikalık karar toplantısı yapalım mı?' şeklinde net bir randevu sabitleyin.".to_string(),
                    rationale: "Belirsiz ertelemeleri somut takvim randevusuna dönüştürün.".to_string(),
                    timestamp_ms: now_ms,
                });
            } else {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-postpone-{}", now_ms),
                    category: "insight".to_string(),
                    text: "Suggest a brief 15-minute follow-up checkpoint on a specific day/time rather than leaving it open-ended.".to_string(),
                    rationale: "Convert passive postponement into a scheduled action item.".to_string(),
                    timestamp_ms: now_ms,
                });
            }
        }

        // Fallback default suggestion if conversation is active but no specific pattern triggered
        if suggestions.is_empty() && recent_texts.len() >= 2 {
            if lang.starts_with("tr") {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-general-{}", now_ms),
                    category: "insight".to_string(),
                    text: "Konuşulan maddelerin sorumlusunu ve sonraki adımı netleştirmeyi unutmayın.".to_string(),
                    rationale: "Toplantı verimliliğini artırmak için aksiyon sahiplerini belirleyin.".to_string(),
                    timestamp_ms: now_ms,
                });
            } else {
                suggestions.push(LiveSuggestionItem {
                    id: format!("sug-general-{}", now_ms),
                    category: "insight".to_string(),
                    text: "Clarify assignee ownership and the next immediate step for this topic.".to_string(),
                    rationale: "Keep alignment strong by assigning owners to discussed items.".to_string(),
                    timestamp_ms: now_ms,
                });
            }
        }

        suggestions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_budget_suggestions_turkish() {
        let segments = vec![
            "Bu proje için bütçe biraz kısıtlı olabilir.".to_string(),
            "Maliyetleri kısmamız gerekiyor.".to_string(),
        ];
        let res = LiveSuggestionEngine::extract_heuristic_suggestions(&segments, Some("tr"));
        assert!(!res.is_empty());
        assert!(res.iter().any(|s| s.category == "question" && s.text.contains("bütçeniz")));
        assert!(res.iter().any(|s| s.category == "objection" && s.text.contains("ROI")));
    }

    #[test]
    fn test_extract_timeline_and_decision_suggestions_english() {
        let segments = vec![
            "What is the final deadline for the release?".to_string(),
            "We need management approval first.".to_string(),
        ];
        let res = LiveSuggestionEngine::extract_heuristic_suggestions(&segments, Some("en"));
        assert!(!res.is_empty());
        assert!(res.iter().any(|s| s.category == "action" && s.text.contains("deadline")));
        assert!(res.iter().any(|s| s.category == "question" && s.text.contains("sign off")));
    }

    #[test]
    fn test_extract_empty_and_fallback_suggestions() {
        let empty_res = LiveSuggestionEngine::extract_heuristic_suggestions(&[], Some("tr"));
        assert!(empty_res.is_empty());

        let generic_segments = vec![
            "Bugün hava çok güzel.".to_string(),
            "Evet gerçekten öyle.".to_string(),
        ];
        let gen_res = LiveSuggestionEngine::extract_heuristic_suggestions(&generic_segments, Some("tr"));
        assert!(!gen_res.is_empty());
        assert_eq!(gen_res[0].category, "insight");
    }
}
