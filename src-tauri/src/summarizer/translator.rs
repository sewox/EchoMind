use std::time::Instant;
use super::types::{GeminiContent, GeminiGenerationConfig, GeminiPart, GeminiRequest, SummaryResult};
use super::local_extractor::LocalSummaryExtractor;

pub struct SummaryTranslator;

impl SummaryTranslator {
    pub fn translate_summary(
        summary: &SummaryResult,
        target_language: &str,
        target_lang_code: &str,
        provider: &str,
        api_key: Option<&str>,
        custom_endpoint: Option<&str>,
        custom_model: Option<&str>,
        start_time: Instant,
    ) -> Result<SummaryResult, String> {
        let clean_target = target_language.trim();
        let target_code = target_lang_code.trim().to_lowercase();

        if target_code == "tr" || clean_target.eq_ignore_ascii_case("turkish") || clean_target.eq_ignore_ascii_case("türkçe") {
            return Ok(summary.clone());
        }

        let summary_json_str = serde_json::to_string_pretty(summary).map_err(|e| e.to_string())?;

        let system_prompt = format!(
            "YOU ARE A MASTER EXECUTIVE TRANSLATOR AND ENTERPRISE INTELLIGENCE SPECIALIST.\n\
Your task is to translate the provided structured executive meeting summary JSON into **{}** (Language code: '{}').\n\n\
STRICT CONTEXT & INTEGRITY PRESERVATION RULES:\n\
1. 🧠 CONTEXTUAL BUSINESS FLUENCY: Translate with executive precision and high-level corporate tone. Do not translate word-by-word; preserve true strategic business nuance, decisions, and goals.\n\
2. 🔒 NAMES, NUMBERS & DATES: Keep person names (e.g., 'John Doe', 'Ahmet Bey'), company names, dates, numerical values, currencies, and percentages exactly accurate.\n\
3. 💼 DOMAIN TERMS & ACRONYMS: Maintain appropriate business/technical terminology (e.g., ROI, KPI, PRD, API, SQL, KDV, EBITDA).\n\
4. 📋 EXACT JSON SCHEMA: Return ONLY a valid JSON object strictly preserving all schema keys:\n\
   - 'meeting_goal': string\n\
   - 'key_highlights': array of strings\n\
   - 'action_items': array of objects {{ 'task': string, 'assignee': string|null, 'source_citations': array of numbers, 'is_completed': boolean }}\n\
   - 'phase1_agreed': array of strings\n\
   - 'phase2_deferred': array of strings\n\
   - 'detailed_topics': array of objects {{ 'topic_title': string, 'bullet_points': array of strings }}\n\
   - 'participants': array of strings\n\
   - 'summary': string\n\
   - 'key_decisions': array of strings\n\
   - 'agenda_topics': array of strings\n\
5. ⚡ RETURN ONLY RAW JSON OBJECT. No markdown backticks, no explanatory comments.",
            clean_target, target_code
        );

        let user_prompt = format!(
            "Please translate this meeting summary JSON into {}:\n\n{}",
            clean_target, summary_json_str
        );

        let prov_norm = provider.to_lowercase();

        // 1. Try Cloud Providers if API key is provided
        if let Some(key) = api_key {
            let clean_key = key.trim();
            if !clean_key.is_empty() {
                if prov_norm.contains("gemini") {
                    if let Ok(res) = Self::translate_with_gemini(&system_prompt, &user_prompt, clean_key, clean_target, start_time) {
                        return Ok(res);
                    }
                } else if prov_norm.contains("openai") || prov_norm.contains("groq") {
                    let (endpoint, model, disp) = if prov_norm.contains("groq") {
                        ("https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile", "Groq Llama-3.3-70B")
                    } else {
                        ("https://api.openai.com/v1/chat/completions", "gpt-4o-mini", "OpenAI GPT-4o-mini")
                    };

                    if let Ok(res) = Self::translate_with_openai_compatible(
                        &system_prompt,
                        &user_prompt,
                        clean_key,
                        endpoint,
                        model,
                        disp,
                        clean_target,
                        start_time,
                    ) {
                        return Ok(res);
                    }
                }
            }
        }

        // 2. Try Local LLM (Ollama)
        if let Ok(res) = Self::translate_with_ollama(
            &system_prompt,
            &user_prompt,
            custom_endpoint,
            custom_model,
            clean_target,
            start_time,
        ) {
            return Ok(res);
        }

        // 3. Fallback: Return summary marked as original
        let mut fallback = summary.clone();
        fallback.provider_used = format!("{} (Orijinal)", summary.provider_used);
        Ok(fallback)
    }

    fn translate_with_gemini(
        system_prompt: &str,
        user_prompt: &str,
        api_key: &str,
        target_lang: &str,
        start_time: Instant,
    ) -> Result<SummaryResult, String> {
        let full_prompt = format!("{}\n\n{}", system_prompt, user_prompt);
        let body = GeminiRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart { text: full_prompt }],
            }],
            generation_config: Some(GeminiGenerationConfig {
                response_mime_type: Some("application/json".to_string()),
                temperature: Some(0.1),
                max_output_tokens: Some(8192),
            }),
        };

        let candidate_models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;

        for model in &candidate_models {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, api_key.trim()
            );

            if let Ok(resp) = client.post(&url).json(&body).send() {
                if resp.status().is_success() {
                    if let Ok(resp_data) = resp.json::<serde_json::Value>() {
                        let raw_text = resp_data
                            .get("candidates")
                            .and_then(|c| c.get(0))
                            .and_then(|c0| c0.get("content"))
                            .and_then(|cnt| cnt.get("parts"))
                            .and_then(|p| p.get(0))
                            .and_then(|p0| p0.get("text"))
                            .and_then(|t| t.as_str())
                            .unwrap_or("");

                        let clean_json = raw_text.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(clean_json) {
                            return LocalSummaryExtractor::parse_rich_summary_json(&parsed, &format!("Google Gemini ({}) Çeviri", target_lang), start_time);
                        }
                    }
                }
            }
        }

        Err("Gemini çeviri isteği başarısız oldu".to_string())
    }

    fn translate_with_openai_compatible(
        system_prompt: &str,
        user_prompt: &str,
        api_key: &str,
        endpoint: &str,
        model: &str,
        display_name: &str,
        target_lang: &str,
        start_time: Instant,
    ) -> Result<SummaryResult, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;

        let body = serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.1
        });

        let resp = client
            .post(endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&body)
            .send()
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Çeviri API Hatası (HTTP {})", resp.status()));
        }

        let json_val: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        let content = json_val["choices"][0]["message"]["content"].as_str().unwrap_or("{}");
        let parsed: serde_json::Value = serde_json::from_str(content).map_err(|e| e.to_string())?;

        LocalSummaryExtractor::parse_rich_summary_json(&parsed, &format!("{} ({}) Çeviri", display_name, target_lang), start_time)
    }

    fn translate_with_ollama(
        system_prompt: &str,
        user_prompt: &str,
        endpoint: Option<&str>,
        model_name: Option<&str>,
        target_lang: &str,
        start_time: Instant,
    ) -> Result<SummaryResult, String> {
        let base_url = endpoint.unwrap_or("http://127.0.0.1:11434").trim().trim_end_matches('/');
        let model = model_name.unwrap_or("llama3.2");
        let url = format!("{}/api/chat", base_url);

        let req_body = serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ],
            "stream": false,
            "format": "json"
        });

        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client.post(&url).json(&req_body).send().map_err(|e| format!("Ollama bağlantı hatası: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Ollama Çeviri Hatası (HTTP {})", resp.status()));
        }

        let json_val: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        let content_str = json_val["message"]["content"].as_str().ok_or_else(|| "Geçersiz yanıt".to_string())?;
        let parsed: serde_json::Value = serde_json::from_str(content_str).map_err(|e| e.to_string())?;

        LocalSummaryExtractor::parse_rich_summary_json(&parsed, &format!("Yerel LLM ({}) [{}] Çeviri", model, target_lang), start_time)
    }
}
