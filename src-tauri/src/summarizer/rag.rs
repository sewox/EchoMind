use serde::{Deserialize, Serialize};
use crate::storage::{MeetingRecord, StorageEngine};
use super::types::{GeminiContent, GeminiGenerationConfig, GeminiPart, GeminiRequest};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub match_type: String, // "title", "goal", "action_item", "decision", "topic", "transcript"
    pub matched_text: String,
    pub snippet: String,
    pub timestamp_formatted: Option<String>,
    pub start_time_ms: Option<u64>,
    pub speaker_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalSearchResult {
    pub meeting_id: String,
    pub meeting_title: String,
    pub date_formatted: String,
    pub duration_formatted: String,
    pub matches: Vec<SearchMatch>,
    pub score: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalAssistantResponse {
    pub answer: String,
    pub cited_meeting_ids: Vec<String>,
    pub provider_used: String,
}

pub struct RAGEngine;

impl RAGEngine {
    pub fn clean_search_tokens(text: &str) -> Vec<String> {
        let stop_words = [
            "tüm", "tum", "toplantı", "toplanti", "toplantılardaki", "toplantilardaki",
            "hakkında", "hakkinda", "olan", "olanlar", "ve", "ile", "için", "icin", "ne",
            "neler", "var", "listele", "özetle", "ozetle", "göster", "goster", "sor",
            "ara", "nelerdir", "bir", "bu", "da", "de"
        ];
        text.to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| w.len() >= 3 && !stop_words.contains(w))
            .map(|w| w.to_string())
            .collect()
    }

    pub fn find_referenced_meeting_ids(meetings: &[MeetingRecord], query: &str) -> Vec<String> {
        let q = query.to_lowercase();
        let tokens = Self::clean_search_tokens(query);
        let mut matching_ids = Vec::new();

        let is_action_intent = q.contains("eylem") || q.contains("görev") || q.contains("gorev") || q.contains("sorumlu") || q.contains("action") || q.contains("todo");
        let is_decision_intent = q.contains("karar") || q.contains("mutabakat") || q.contains("decision");
        let is_goal_intent = q.contains("hedef") || q.contains("amaç") || q.contains("amac") || q.contains("goal");

        for m in meetings {
            let mut matched = false;

            if is_action_intent && m.action_items.as_ref().map(|a| !a.is_empty()).unwrap_or(false) {
                matched = true;
            } else if is_decision_intent && !m.key_decisions.is_empty() {
                matched = true;
            } else if is_goal_intent && m.meeting_goal.is_some() {
                matched = true;
            } else {
                for t in &tokens {
                    if m.title.to_lowercase().contains(t)
                        || m.meeting_goal.as_deref().unwrap_or("").to_lowercase().contains(t)
                        || m.key_decisions.iter().any(|d| d.to_lowercase().contains(t))
                        || m.action_items.as_ref().map(|acts| acts.iter().any(|a| a.task.to_lowercase().contains(t) || a.assignee.as_deref().unwrap_or("").to_lowercase().contains(t))).unwrap_or(false)
                        || m.detailed_topics.as_ref().map(|tops| tops.iter().any(|tp| tp.topic_title.to_lowercase().contains(t) || tp.bullet_points.iter().any(|b| b.to_lowercase().contains(t)))).unwrap_or(false)
                    {
                        matched = true;
                        break;
                    }
                }
            }

            if matched {
                matching_ids.push(m.id.clone());
            }
        }

        matching_ids
    }

    pub fn global_search(query: &str) -> Vec<GlobalSearchResult> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Vec::new();
        }

        let storage = StorageEngine::new();
        let meetings_lock = storage.meetings.lock().unwrap();
        let mut results: Vec<GlobalSearchResult> = Vec::new();

        for m in meetings_lock.iter() {
            let mut matches = Vec::new();
            let mut score = 0u32;

            // 1. Title match
            if m.title.to_lowercase().contains(&q) {
                matches.push(SearchMatch {
                    match_type: "title".to_string(),
                    matched_text: m.title.clone(),
                    snippet: format!("Toplantı Başlığı: {}", m.title),
                    timestamp_formatted: None,
                    start_time_ms: None,
                    speaker_name: None,
                });
                score += 15;
            }

            // 2. Goal match
            if let Some(ref goal) = m.meeting_goal {
                if goal.to_lowercase().contains(&q) {
                    matches.push(SearchMatch {
                        match_type: "goal".to_string(),
                        matched_text: goal.clone(),
                        snippet: format!("Hedef: {}", goal),
                        timestamp_formatted: None,
                        start_time_ms: None,
                        speaker_name: None,
                    });
                    score += 10;
                }
            }

            // 3. Key Decisions
            for d in &m.key_decisions {
                if d.to_lowercase().contains(&q) {
                    matches.push(SearchMatch {
                        match_type: "decision".to_string(),
                        matched_text: d.clone(),
                        snippet: format!("Karar: {}", d),
                        timestamp_formatted: None,
                        start_time_ms: None,
                        speaker_name: None,
                    });
                    score += 8;
                }
            }

            // 4. Action Items
            if let Some(ref actions) = m.action_items {
                for a in actions {
                    let assignee_text = a.assignee.as_deref().unwrap_or("");
                    if a.task.to_lowercase().contains(&q) || assignee_text.to_lowercase().contains(&q) {
                        matches.push(SearchMatch {
                            match_type: "action_item".to_string(),
                            matched_text: a.task.clone(),
                            snippet: format!("Görev: {} (Sorumlu: {})", a.task, if assignee_text.is_empty() { "Belirtilmemiş" } else { assignee_text }),
                            timestamp_formatted: None,
                            start_time_ms: None,
                            speaker_name: a.assignee.clone(),
                        });
                        score += 8;
                    }
                }
            }

            // 5. Topics
            if let Some(ref topics) = m.detailed_topics {
                for t in topics {
                    if t.topic_title.to_lowercase().contains(&q) {
                        matches.push(SearchMatch {
                            match_type: "topic".to_string(),
                            matched_text: t.topic_title.clone(),
                            snippet: format!("Konu Başlığı: {}", t.topic_title),
                            timestamp_formatted: None,
                            start_time_ms: None,
                            speaker_name: None,
                        });
                        score += 6;
                    }
                    for b in &t.bullet_points {
                        if b.to_lowercase().contains(&q) {
                            matches.push(SearchMatch {
                                match_type: "topic_bullet".to_string(),
                                matched_text: b.clone(),
                                snippet: format!("Detay: {}", b),
                                timestamp_formatted: None,
                                start_time_ms: None,
                                speaker_name: None,
                            });
                            score += 5;
                        }
                    }
                }
            }

            // 6. Dialogue Transcripts (first 5 matches per meeting to keep clean)
            let mut transcript_match_count = 0;
            for seg in &m.segments {
                if seg.text.to_lowercase().contains(&q) || seg.speaker_name.to_lowercase().contains(&q) {
                    if transcript_match_count < 5 {
                        matches.push(SearchMatch {
                            match_type: "transcript".to_string(),
                            matched_text: seg.text.clone(),
                            snippet: format!("[{}] {}: {}", seg.timestamp_formatted, seg.speaker_name, seg.text),
                            timestamp_formatted: Some(seg.timestamp_formatted.clone()),
                            start_time_ms: Some(seg.start_time_ms),
                            speaker_name: Some(seg.speaker_name.clone()),
                        });
                    }
                    transcript_match_count += 1;
                    score += 3;
                }
            }

            if !matches.is_empty() {
                results.push(GlobalSearchResult {
                    meeting_id: m.id.clone(),
                    meeting_title: m.title.clone(),
                    date_formatted: m.date_formatted.clone(),
                    duration_formatted: m.duration_formatted.clone(),
                    matches,
                    score,
                });
            }
        }

        results.sort_by(|a, b| b.score.cmp(&a.score));
        results
    }

    pub fn call_openai_compatible_global_assistant(
        context: &str,
        query: &str,
        api_key: &str,
        endpoint: &str,
        model: &str,
    ) -> Result<String, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;

        let system_prompt = "SEN ECHOMIND GELİŞMİŞ KURUMSAL TOPLANTI VE BİLGİ BANKASI ASİSTANISIN.\n\
Aşağıda kullanıcının şirketine ait tüm geçmiş toplantıların detaylı yönetici özetleri, alınan kararları, hedefleri ve eylem maddeleri bulunmaktadır.\n\
KULLANICININ SORUSUNU BU VERİLERDEN YOLA ÇIKARAK AKICI, PROFESYONEL VE TÜRKÇE OLARAK YANITLA.\n\n\
🚨 KURALLAR:\n\
1. Bilgi verdiğinde mutlaka toplantının adını ve tarihini referans göster (Örn: `[📅 Q3 Bütçe Planlama (12.08.2026)]`).\n\
2. Görev ve eylem maddelerinden bahsettiğinde sorumlu kişiyi ve durumunu belirt.\n\
3. Eğer aranan bilgi toplantı arşivinde yer almıyorsa açıkça 'Kayıtlı toplantılarınızda bu konuyla ilgili bir karara rastlanmadı' de.\n\
4. Yanıtı madde işaretleri ve başlıklar ile net, kolay okunabilir Markdown formatında düzenle.";

        let payload = serde_json::json!({
            "model": model,
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": format!("TOPLANTI ARŞİVİ:\n{}\n\nKULLANICI SORUSU:\n{}", context, query)}
            ]
        });

        let resp = client
            .post(endpoint)
            .header("Authorization", format!("Bearer {}", api_key.trim()))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .map_err(|e| format!("İstek hatası: {}", e))?;

        if !resp.status().is_success() {
            let err_body = resp.text().unwrap_or_default();
            return Err(format!("API Hatası: {}", err_body));
        }

        let json_val: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        let content = json_val["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| "Geçersiz API yanıtı".to_string())?;

        Ok(content.to_string())
    }

    pub fn call_gemini_global_assistant(
        context: &str,
        query: &str,
        api_key: &str,
    ) -> Result<String, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;

        let prompt = format!(
            "SEN ECHOMIND GELİŞMİŞ KURUMSAL TOPLANTI VE BİLGİ BANKASI ASİSTANISIN.\n\
Aşağıda kullanıcının şirketine ait tüm geçmiş toplantıların detaylı yönetici özetleri, alınan kararları, hedefleri ve eylem maddeleri bulunmaktadır.\n\
KULLANICININ SORUSUNU BU VERİLERDEN YOLA ÇIKARAK AKICI, PROFESYONEL VE TÜRKÇE OLARAK YANITLA.\n\n\
KURALLAR:\n\
1. Bilgi verdiğinde mutlaka toplantının adını ve tarihini referans göster (Örn: `[📅 Q3 Bütçe Planlama (12.08.2026)]`).\n\
2. Görev ve eylem maddelerinden bahsettiğinde sorumlu kişiyi ve durumunu belirt.\n\
3. Eğer aranan bilgi toplantı arşivinde yer almıyorsa açıkça 'Kayıtlı toplantılarınızda bu konuyla ilgili bir bilgiye rastlanmadı' de.\n\
4. Yanıtı madde işaretleri ve başlıklar ile net, kolay okunabilir Markdown formatında düzenle.\n\n\
TOPLANTI ARŞİVİ:\n{}\n\nKULLANICI SORUSU:\n{}",
            context, query
        );

        let body = GeminiRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart { text: prompt }],
            }],
            generation_config: Some(GeminiGenerationConfig {
                response_mime_type: None,
                temperature: Some(0.2),
                max_output_tokens: Some(4096),
            }),
        };

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={}",
            api_key.trim()
        );

        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .map_err(|e| format!("Gemini istek hatası: {}", e))?;

        if !resp.status().is_success() {
            let err_body = resp.text().unwrap_or_default();
            return Err(format!("Gemini Hatası: {}", err_body));
        }

        let json_val: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        let content = json_val["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .ok_or_else(|| "Geçersiz Gemini yanıtı".to_string())?;

        Ok(content.to_string())
    }

    pub fn call_ollama_local_assistant(
        context: &str,
        query: &str,
        endpoint: Option<&str>,
        model: Option<&str>,
    ) -> Result<String, String> {
        let base_url = endpoint.unwrap_or("http://127.0.0.1:11434").trim().trim_end_matches('/');
        let target_model = model.unwrap_or("llama3.2");
        let url = format!("{}/api/chat", base_url);

        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(45))
            .build()
            .map_err(|e| e.to_string())?;

        let system_prompt = "SEN ECHOMIND YEREL KURUMSAL TOPLANTI VE BİLGİ BANKASI ASİSTANISIN.\n\
Aşağıda kullanıcının şirketine ait tüm geçmiş toplantıların detaylı yönetici özetleri, alınan kararları, hedefleri ve eylem maddeleri bulunmaktadır.\n\
Kullanıcının sorusunu bu verilere dayanarak net, akıcı, profesyonel ve Türkçe olarak yanıtla.\n\
İlgili toplantıların başlıklarını ve tarihlerini referans ver (Örn: [Q3 Planlama (12.08.2026)]).";

        let payload = serde_json::json!({
            "model": target_model,
            "stream": false,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": format!("TOPLANTI ARŞİVİ:\n{}\n\nKULLANICI SORUSU:\n{}", context, query)}
            ]
        });

        let resp = client
            .post(&url)
            .json(&payload)
            .send()
            .map_err(|e| format!("Ollama bağlantı hatası: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Ollama API Hatası (HTTP {})", resp.status()));
        }

        let json_val: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        let content = json_val["message"]["content"]
            .as_str()
            .ok_or_else(|| "Geçersiz Ollama yanıt formatı".to_string())?;

        Ok(content.to_string())
    }

    pub fn synthesize_local_multi_meeting_answer(meetings: &[MeetingRecord], query: &str) -> String {
        let q = query.to_lowercase();
        let tokens = Self::clean_search_tokens(query);

        let is_action_intent = q.contains("eylem") || q.contains("görev") || q.contains("gorev") || q.contains("sorumlu") || q.contains("action") || q.contains("todo") || q.contains("açık") || q.contains("acik");
        let is_decision_intent = q.contains("karar") || q.contains("mutabakat") || q.contains("decision") || q.contains("anlaşma") || q.contains("anlasma");
        let is_goal_intent = q.contains("hedef") || q.contains("amaç") || q.contains("amac") || q.contains("goal");

        // Intent 1: Action Items across all meetings
        if is_action_intent && (tokens.is_empty() || q.contains("tüm") || q.contains("tum") || q.contains("bütün") || q.contains("açık")) {
            let mut total_actions = 0;
            let mut ans = String::from("### 📋 Tüm Toplantılardaki Eylem Maddeleri & Görev Dağılımı\n\n");

            for m in meetings {
                if let Some(ref actions) = m.action_items {
                    if !actions.is_empty() {
                        ans.push_str(&format!("#### 📌 {} (*{}*)\n", m.title, m.date_formatted));
                        for a in actions {
                            total_actions += 1;
                            let status_badge = if a.is_completed { "✅ [Tamamlandı]" } else { "⏳ [Bekliyor]" };
                            let assignee = a.assignee.as_deref().unwrap_or("Sorumlu Belirtilmemiş");
                            ans.push_str(&format!("• {} **{}** — Sorumlu: *{}*\n", status_badge, a.task, assignee));
                        }
                        ans.push_str("\n");
                    }
                }
            }

            if total_actions == 0 {
                return "### 📋 Eylem Maddeleri\n\nKayıtlı toplantılarınızda tanımlanmış bir eylem maddesi veya görev bulunamadı.".to_string();
            }

            ans.push_str("--------------------------------------------------\n");
            ans.push_str("*EchoMind: Kendi Belgelerinizle Güvenle Çalışan Akıllı Arama ve Yanıt Asistanı*");
            return ans;
        }

        // Intent 2: Decisions across all meetings
        if is_decision_intent && (tokens.is_empty() || q.contains("tüm") || q.contains("tum") || q.contains("bütün") || q.contains("kritik")) {
            let mut total_decisions = 0;
            let mut ans = String::from("### ⚡ Alınan Tüm Kritik Kararlar & Mutabakatlar\n\n");

            for m in meetings {
                if !m.key_decisions.is_empty() {
                    ans.push_str(&format!("#### 📌 {} (*{}*)\n", m.title, m.date_formatted));
                    for d in &m.key_decisions {
                        total_decisions += 1;
                        ans.push_str(&format!("• {}\n", d));
                    }
                    ans.push_str("\n");
                }
            }

            if total_decisions == 0 {
                return "### ⚡ Kararlar\n\nKayıtlı toplantılarınızda tanımlanmış bir karar bulunamadı.".to_string();
            }

            ans.push_str("--------------------------------------------------\n");
            ans.push_str("*EchoMind Local RAG Pipeline & Semantic Knowledge Retrieval Engine*");
            return ans;
        }

        // Intent 3: Goals across all meetings
        if is_goal_intent && (tokens.is_empty() || q.contains("tüm") || q.contains("tum") || q.contains("karşılaştır")) {
            let mut ans = String::from("### 🎯 Toplantı Hedefleri ve Süreç Analizi\n\n");
            for m in meetings {
                ans.push_str(&format!("#### 📌 {} (*{}*)\n", m.title, m.date_formatted));
                if let Some(ref goal) = m.meeting_goal {
                    ans.push_str(&format!("• **Hedef / Amaç:** {}\n", goal));
                }
                if let Some(ref p2) = m.phase2_deferred {
                    if !p2.is_empty() {
                        ans.push_str(&format!("• **Ertelenen Konular:** {}\n", p2.join(", ")));
                    }
                }
                ans.push_str("\n");
            }
            ans.push_str("--------------------------------------------------\n");
            ans.push_str("*EchoMind Local RAG Pipeline & Semantic Knowledge Retrieval Engine*");
            return ans;
        }

        // Keyword & Semantic Token Matcher
        let mut matching_meetings = Vec::new();
        let mut matching_actions = Vec::new();
        let mut matching_decisions = Vec::new();
        let mut matching_topics = Vec::new();

        for m in meetings {
            let mut hit = false;
            let mtg_matched = tokens.iter().any(|t| m.title.to_lowercase().contains(t) || m.meeting_goal.as_deref().unwrap_or("").to_lowercase().contains(t));

            if mtg_matched {
                hit = true;
            }

            // Action items check
            if let Some(ref actions) = m.action_items {
                for a in actions {
                    let assignee_text = a.assignee.as_deref().unwrap_or("");
                    if mtg_matched || tokens.iter().any(|t| a.task.to_lowercase().contains(t) || assignee_text.to_lowercase().contains(t)) {
                        matching_actions.push((m.title.clone(), m.date_formatted.clone(), a.clone()));
                        hit = true;
                    }
                }
            }

            // Decisions check
            for d in &m.key_decisions {
                if mtg_matched || tokens.iter().any(|t| d.to_lowercase().contains(t)) {
                    matching_decisions.push((m.title.clone(), m.date_formatted.clone(), d.clone()));
                    hit = true;
                }
            }

            // Topics check
            if let Some(ref topics) = m.detailed_topics {
                for t in topics {
                    if mtg_matched || tokens.iter().any(|tk| t.topic_title.to_lowercase().contains(tk) || t.bullet_points.iter().any(|b| b.to_lowercase().contains(tk))) {
                        matching_topics.push((m.title.clone(), m.date_formatted.clone(), t.clone()));
                        hit = true;
                    }
                }
            }

            if hit {
                matching_meetings.push(m);
            }
        }

        if matching_meetings.is_empty() && matching_actions.is_empty() && matching_decisions.is_empty() {
            return format!(
                "### 🔍 Arama Sonucu\n\n\
                Toplantı arşivinizde **\"{}\"** sorgusuyla doğrudan eşleşen bir karar veya eylem maddesi bulunamadı.\n\n\
                💡 **Öneri:** Farklı anahtar kelimelerle arama yapabilir veya Ayarlar bölümünden bir Bulut AI / Yerel LLM anahtarı girerek derin semantik sorgulama yapabilirsiniz.",
                query
            );
        }

        let mut ans = format!("### 📊 \"{}\" Hakkında Bilgi Bankası Analizi\n\n", query);
        ans.push_str(&format!("Arşivinizde sorgunuzla ilgili **{} toplantı** tespit edildi.\n\n", matching_meetings.len()));

        if !matching_decisions.is_empty() {
            ans.push_str("#### ⚡ İlgili Kararlar & Mutabakatlar:\n");
            for (mtg_title, mtg_date, dec) in matching_decisions.iter().take(6) {
                ans.push_str(&format!("• **{}** (*{} - {}*)\n", dec, mtg_title, mtg_date));
            }
            ans.push_str("\n");
        }

        if !matching_actions.is_empty() {
            ans.push_str("#### ✅ İlgili Eylem Maddeleri & Görevler:\n");
            for (mtg_title, mtg_date, act) in matching_actions.iter().take(6) {
                let status_badge = if act.is_completed { "✅ Tamamlandı" } else { "⏳ Bekliyor" };
                let assignee = act.assignee.as_deref().unwrap_or("Belirtilmemiş");
                ans.push_str(&format!("• **{}** — Sorumlu: *{}* [{}] (*{} - {}*)\n", act.task, assignee, status_badge, mtg_title, mtg_date));
            }
            ans.push_str("\n");
        }

        if !matching_topics.is_empty() {
            ans.push_str("#### 📂 İlgili Gündem Konuları:\n");
            for (mtg_title, mtg_date, top) in matching_topics.iter().take(4) {
                ans.push_str(&format!("• **{}** (*{} - {}*)\n", top.topic_title, mtg_title, mtg_date));
                for b in top.bullet_points.iter().take(2) {
                    ans.push_str(&format!("  - {}\n", b));
                }
            }
            ans.push_str("\n");
        }

        ans.push_str("--------------------------------------------------\n");
        ans.push_str("*EchoMind Local RAG Pipeline & Semantic Knowledge Retrieval Engine*");
        ans
    }
}
