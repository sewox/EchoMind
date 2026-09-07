pub mod types;
pub mod redaction;
pub mod local_extractor;
pub mod llm_client;
pub mod translator;
pub mod exporter;
pub mod rag;
pub mod cleaner;

pub use types::*;
pub use redaction::*;
pub use local_extractor::*;
pub use llm_client::*;
pub use translator::*;
pub use exporter::*;
pub use rag::*;
pub use cleaner::*;

use std::time::Instant;
use crate::storage::{MeetingRecord, StorageEngine, get_storage_dir};
use crate::transcriber::TranscriptSegment;

pub struct SummarizerEngine;

impl SummarizerEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn generate_summary(
        segments: &[TranscriptSegment],
        provider: &str,
        api_key: Option<&str>,
        custom_endpoint: Option<&str>,
        custom_model: Option<&str>,
        template_id: Option<&str>,
        custom_prompt: Option<&str>,
    ) -> SummaryResult {
        let start_time = Instant::now();

        if segments.is_empty() {
            return SummaryResult {
                meeting_goal: "Toplantı kaydında henüz transkript metni bulunmuyor.".to_string(),
                key_highlights: Vec::new(),
                action_items: Vec::new(),
                phase1_agreed: Vec::new(),
                phase2_deferred: Vec::new(),
                detailed_topics: Vec::new(),
                participants: Vec::new(),
                summary: "Toplantı kaydında henüz transkript metni bulunmuyor.".to_string(),
                key_decisions: Vec::new(),
                agenda_topics: Vec::new(),
                smart_title: None,
                provider_used: "Yok".to_string(),
                generation_time_ms: start_time.elapsed().as_millis() as u64,
            };
        }

        let prov_norm = provider.to_lowercase();

        // 1. Try Online Cloud APIs if requested and API key is provided
        if let Some(key) = api_key {
            let clean_key = key.trim();
            if !clean_key.is_empty() {
                if prov_norm.contains("gemini") {
                    match LLMClient::generate_gemini_summary(segments, clean_key, template_id, custom_prompt, start_time) {
                        Ok(res) => return res,
                        Err(e) => eprintln!("❌ Gemini summary generation error: {}", e),
                    }
                } else if prov_norm.contains("openai") {
                    match LLMClient::generate_openai_compatible_summary(
                        segments,
                        clean_key,
                        "https://api.openai.com/v1/chat/completions",
                        "gpt-4o-mini",
                        "OpenAI GPT-4o-mini",
                        template_id,
                        custom_prompt,
                        start_time,
                    ) {
                        Ok(res) => return res,
                        Err(e) => eprintln!("❌ OpenAI summary generation error: {}", e),
                    }
                } else if prov_norm.contains("groq") {
                    match LLMClient::generate_openai_compatible_summary(
                        segments,
                        clean_key,
                        "https://api.groq.com/openai/v1/chat/completions",
                        "llama-3.3-70b-versatile",
                        "Groq Llama-3.3-70B",
                        template_id,
                        custom_prompt,
                        start_time,
                    ) {
                        Ok(res) => return res,
                        Err(e) => eprintln!("❌ Groq summary generation error: {}", e),
                    }
                }
            }
        }

        // 2. Try Local LLM Server (Ollama / Local Server)
        if let Ok(ollama_res) = LLMClient::generate_ollama_summary(segments, custom_endpoint, custom_model, template_id, custom_prompt, start_time) {
            return ollama_res;
        }

        // 3. Fallback to Multi-lingual Smart Heuristic Extractor (Zero-RAM, Offline)
        LocalSummaryExtractor::generate_local_heuristic_summary(segments, start_time)
    }

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
        SummaryTranslator::translate_summary(
            summary,
            target_language,
            target_lang_code,
            provider,
            api_key,
            custom_endpoint,
            custom_model,
            start_time,
        )
    }

    pub fn export_notes_markdown(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
        lang_code: Option<&str>,
    ) -> String {
        MeetingExporter::export_notes_markdown(record, custom_summary, lang_code)
    }

    pub fn export_notes_html(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
        lang_code: Option<&str>,
    ) -> String {
        MeetingExporter::export_notes_html(record, custom_summary, lang_code)
    }

    pub fn export_notes_email_digest(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
        lang_code: Option<&str>,
    ) -> String {
        MeetingExporter::export_notes_email_digest(record, custom_summary, lang_code)
    }

    pub fn export_notes_slack_markdown(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
        lang_code: Option<&str>,
    ) -> String {
        MeetingExporter::export_notes_slack_markdown(record, custom_summary, lang_code)
    }

    pub fn export_action_items_csv(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
    ) -> String {
        MeetingExporter::export_action_items_csv(record, custom_summary)
    }

    pub fn export_action_items_markdown(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
    ) -> String {
        MeetingExporter::export_action_items_markdown(record, custom_summary)
    }

    pub fn export_followup_email(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
        lang_code: Option<&str>,
    ) -> FollowupEmailResult {
        let (subject, body) = MeetingExporter::export_followup_email(record, custom_summary, lang_code);
        let encoded_subject = urlencoding::encode(&subject);
        let encoded_body = urlencoding::encode(&body);
        let mailto_url = format!("mailto:?subject={}&body={}", encoded_subject, encoded_body);
        FollowupEmailResult {
            subject,
            body,
            mailto_url,
        }
    }
}

#[tauri::command]
pub async fn generate_meeting_summary(
    meeting_id: String,
    provider: Option<String>,
    api_key: Option<String>,
    custom_endpoint: Option<String>,
    custom_model: Option<String>,
    template_id: Option<String>,
    custom_prompt: Option<String>,
) -> Result<SummaryResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let storage_dir = get_storage_dir();
        let history_file = storage_dir.join("meetings_history.json");

        if !history_file.exists() {
            return Err("Toplantı geçmişi bulunamadı.".to_string());
        }

        let storage = StorageEngine::new();
        let mut meetings_lock = storage.meetings.lock().unwrap();

        let target_meeting = meetings_lock
            .iter_mut()
            .find(|m| m.id == meeting_id)
            .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;

        let prov = provider.unwrap_or_else(|| "local".to_string());
        let result = SummarizerEngine::generate_summary(
            &target_meeting.segments,
            &prov,
            api_key.as_deref(),
            custom_endpoint.as_deref(),
            custom_model.as_deref(),
            template_id.as_deref(),
            custom_prompt.as_deref(),
        );

        // Update meeting record with rich intelligence
        target_meeting.summary = result.summary.clone();
        target_meeting.key_decisions = result.key_decisions.clone();
        target_meeting.meeting_goal = Some(result.meeting_goal.clone());
        target_meeting.key_highlights = Some(result.key_highlights.clone());
        target_meeting.action_items = Some(result.action_items.clone());
        target_meeting.phase1_agreed = Some(result.phase1_agreed.clone());
        target_meeting.phase2_deferred = Some(result.phase2_deferred.clone());
        target_meeting.detailed_topics = Some(result.detailed_topics.clone());
        target_meeting.participants = Some(result.participants.clone());
        target_meeting.summary_provider = Some(result.provider_used.clone());

        // Persist to disk
        let json_data = serde_json::to_string_pretty(&*meetings_lock).map_err(|e| e.to_string())?;
        std::fs::write(&storage.file_path, json_data).map_err(|e| e.to_string())?;

        Ok(result)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

#[tauri::command]
pub async fn translate_meeting_summary(
    summary: SummaryResult,
    target_language: String,
    target_lang_code: String,
    provider: Option<String>,
    api_key: Option<String>,
    custom_endpoint: Option<String>,
    custom_model: Option<String>,
) -> Result<SummaryResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let start_time = Instant::now();
        let prov = provider.unwrap_or_else(|| "local".to_string());
        SummarizerEngine::translate_summary(
            &summary,
            &target_language,
            &target_lang_code,
            &prov,
            api_key.as_deref(),
            custom_endpoint.as_deref(),
            custom_model.as_deref(),
            start_time,
        )
    })
    .await
    .map_err(|e| format!("Çeviri iş parçacığı hatası: {}", e))?
}

#[tauri::command]
pub fn export_meeting_notes(
    meeting_id: String,
    custom_summary: Option<SummaryResult>,
    lang_code: Option<String>,
) -> Result<String, String> {
    let storage = StorageEngine::new();
    let meetings_lock = storage.meetings.lock().unwrap();

    let target_meeting = meetings_lock
        .iter()
        .find(|m| m.id == meeting_id)
        .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;

    Ok(SummarizerEngine::export_notes_markdown(target_meeting, custom_summary.as_ref(), lang_code.as_deref()))
}

#[tauri::command]
pub fn export_meeting_notes_html(
    meeting_id: String,
    custom_summary: Option<SummaryResult>,
    lang_code: Option<String>,
) -> Result<String, String> {
    let storage = StorageEngine::new();
    let meetings_lock = storage.meetings.lock().unwrap();

    let target_meeting = meetings_lock
        .iter()
        .find(|m| m.id == meeting_id)
        .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;

    Ok(SummarizerEngine::export_notes_html(target_meeting, custom_summary.as_ref(), lang_code.as_deref()))
}

#[tauri::command]
pub fn export_meeting_email_digest(
    meeting_id: String,
    custom_summary: Option<SummaryResult>,
    lang_code: Option<String>,
) -> Result<String, String> {
    let storage = StorageEngine::new();
    let meetings_lock = storage.meetings.lock().unwrap();

    let target_meeting = meetings_lock
        .iter()
        .find(|m| m.id == meeting_id)
        .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;

    Ok(SummarizerEngine::export_notes_email_digest(target_meeting, custom_summary.as_ref(), lang_code.as_deref()))
}

#[tauri::command]
pub fn export_meeting_notes_slack(
    meeting_id: String,
    custom_summary: Option<SummaryResult>,
    lang_code: Option<String>,
) -> Result<String, String> {
    let storage = StorageEngine::new();
    let meetings_lock = storage.meetings.lock().unwrap();

    let target_meeting = meetings_lock
        .iter()
        .find(|m| m.id == meeting_id)
        .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;

    Ok(SummarizerEngine::export_notes_slack_markdown(target_meeting, custom_summary.as_ref(), lang_code.as_deref()))
}

#[tauri::command]
pub fn export_meeting_action_items_csv(
    meeting_id: String,
    custom_summary: Option<SummaryResult>,
) -> Result<String, String> {
    let storage = StorageEngine::new();
    let meetings_lock = storage.meetings.lock().unwrap();

    let target_meeting = meetings_lock
        .iter()
        .find(|m| m.id == meeting_id)
        .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;

    Ok(SummarizerEngine::export_action_items_csv(target_meeting, custom_summary.as_ref()))
}

#[tauri::command]
pub fn export_meeting_action_items_markdown(
    meeting_id: String,
    custom_summary: Option<SummaryResult>,
) -> Result<String, String> {
    let storage = StorageEngine::new();
    let meetings_lock = storage.meetings.lock().unwrap();

    let target_meeting = meetings_lock
        .iter()
        .find(|m| m.id == meeting_id)
        .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;

    Ok(SummarizerEngine::export_action_items_markdown(target_meeting, custom_summary.as_ref()))
}

#[tauri::command]
pub fn export_meeting_followup_email(
    meeting_id: String,
    custom_summary: Option<SummaryResult>,
    lang_code: Option<String>,
) -> Result<FollowupEmailResult, String> {
    let storage = StorageEngine::new();
    let meetings_lock = storage.meetings.lock().unwrap();

    let target_meeting = meetings_lock
        .iter()
        .find(|m| m.id == meeting_id)
        .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;

    Ok(SummarizerEngine::export_followup_email(target_meeting, custom_summary.as_ref(), lang_code.as_deref()))
}

#[tauri::command]
pub fn filter_meeting_filler_words(
    meeting_id: String,
    lang_code: Option<String>,
) -> Result<CleanedTranscriptResult, String> {
    let storage = StorageEngine::new();
    let meetings_lock = storage.meetings.lock().unwrap();

    let target_meeting = meetings_lock
        .iter()
        .find(|m| m.id == meeting_id)
        .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;

    Ok(SpeechCleaner::clean_segments(&target_meeting.segments, lang_code.as_deref()))
}

#[tauri::command]
pub fn clean_transcript_text(
    raw_text: String,
    lang_code: Option<String>,
) -> (String, usize) {
    SpeechCleaner::clean_text(&raw_text, lang_code.as_deref())
}

#[tauri::command]
pub fn open_meeting_html_report(
    meeting_id: String,
    custom_summary: Option<SummaryResult>,
    lang_code: Option<String>,
) -> Result<String, String> {
    let storage = StorageEngine::new();
    let meetings_lock = storage.meetings.lock().unwrap();
    let target = meetings_lock
        .iter()
        .find(|m| m.id == meeting_id)
        .ok_or_else(|| format!("Toplantı bulunamadı: {}", meeting_id))?;

    let html_content = SummarizerEngine::export_notes_html(target, custom_summary.as_ref(), lang_code.as_deref());
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("EchoMind_Rapor_{}.html", meeting_id));
    std::fs::write(&temp_file, html_content.as_bytes())
        .map_err(|e| format!("Geçici rapor dosyası oluşturulamadı: {}", e))?;

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(&temp_file)
            .spawn()
            .map_err(|e| format!("Tarayıcı açılamadı: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", &temp_file.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Tarayıcı açılamadı: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(&temp_file)
            .spawn()
            .map_err(|e| format!("Tarayıcı açılamadı: {}", e))?;
    }

    Ok(temp_file.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn save_meeting_export_file(
    meeting_id: String,
    export_type: String,
    custom_summary: Option<SummaryResult>,
    lang_code: Option<String>,
) -> Result<String, String> {
    let (content, default_ext, file_filter_name) = {
        let storage = StorageEngine::new();
        let meetings_lock = storage.meetings.lock().unwrap();
        let target = meetings_lock
            .iter()
            .find(|m| m.id == meeting_id)
            .ok_or_else(|| format!("Toplantı bulunamadı: {}", meeting_id))?;

        let lang_ref = lang_code.as_deref();
        let summary_ref = custom_summary.as_ref();

        match export_type.to_lowercase().as_str() {
            "html" => (SummarizerEngine::export_notes_html(target, summary_ref, lang_ref), "html", "HTML Raporu (*.html)"),
            "md" | "markdown" => (SummarizerEngine::export_notes_markdown(target, summary_ref, lang_ref), "md", "Markdown Dosyası (*.md)"),
            "slack" => (SummarizerEngine::export_notes_slack_markdown(target, summary_ref, lang_ref), "txt", "Slack / Teams Metni (*.txt)"),
            "csv" | "tasks_csv" => (SummarizerEngine::export_action_items_csv(target, summary_ref), "csv", "CSV Görev Listesi (*.csv)"),
            "tasks_md" => (SummarizerEngine::export_action_items_markdown(target, summary_ref), "md", "Markdown Görev Listesi (*.md)"),
            "email" | "digest" => (SummarizerEngine::export_notes_email_digest(target, summary_ref, lang_ref), "txt", "E-Posta Özeti (*.txt)"),
            "json" => (serde_json::to_string_pretty(target).map_err(|e| e.to_string())?, "json", "JSON Verisi (*.json)"),
            _ => (
                target.segments.iter().map(|s| format!("[{}] {}: {}", s.timestamp_formatted, s.speaker_name, s.text)).collect::<Vec<_>>().join("\n"),
                "txt",
                "Transkript Metni (*.txt)"
            ),
        }
    };

    let dialog = rfd::AsyncFileDialog::new()
        .set_file_name(&format!("EchoMind_Rapor_{}.{}", meeting_id, default_ext))
        .add_filter(file_filter_name, &[default_ext]);

    if let Some(file_handle) = dialog.save_file().await {
        let path = file_handle.path();
        std::fs::write(&path, content.as_bytes()).map_err(|e| format!("Dosya kaydedilemedi: {}", e))?;
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Kaydetme işlemi iptal edildi.".to_string())
    }
}

#[tauri::command]
pub async fn enhance_meeting_transcript(
    meeting_id: String,
    provider: Option<String>,
    api_key: Option<String>,
) -> Result<MeetingRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let storage = StorageEngine::new();
        let mut meetings_lock = storage.meetings.lock().unwrap();

        let target_meeting = meetings_lock
            .iter_mut()
            .find(|m| m.id == meeting_id)
            .ok_or_else(|| format!("Toplantı kaydı bulunamadı: {}", meeting_id))?;

        TranscriptRedactor::redact_segments(&mut target_meeting.segments, provider.as_deref(), api_key.as_deref());

        let updated_record = target_meeting.clone();
        let json_data = serde_json::to_string_pretty(&*meetings_lock).map_err(|e| e.to_string())?;
        std::fs::write(&storage.file_path, json_data).map_err(|e| e.to_string())?;

        Ok(updated_record)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

#[tauri::command]
pub fn global_search_meetings(query: String) -> Result<Vec<GlobalSearchResult>, String> {
    Ok(RAGEngine::global_search(&query))
}

#[tauri::command]
pub async fn ask_global_assistant(
    query: String,
    provider: Option<String>,
    api_key: Option<String>,
    custom_endpoint: Option<String>,
    custom_model: Option<String>,
) -> Result<GlobalAssistantResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let storage = StorageEngine::new();
        let meetings_lock = storage.meetings.lock().unwrap();

        let q = query.trim();
        if q.is_empty() {
            return Err("Lütfen bir soru veya arama terimi giriniz.".to_string());
        }

        if meetings_lock.is_empty() {
            return Ok(GlobalAssistantResponse {
                answer: "Henüz sistemde kayıtlı toplantı bulunmuyor. Sol menüden ses dosyası içe aktarabilir veya yeni bir kayıt başlatabilirsiniz.".to_string(),
                cited_meeting_ids: Vec::new(),
                provider_used: "EchoMind Sistem".to_string(),
            });
        }

        // Build rich enterprise RAG context across meetings
        let mut context = String::new();
        for m in meetings_lock.iter() {
            context.push_str(&format!("\n=== TOPLANTI: {} ({}) [ID: {}] ===\n", m.title, m.date_formatted, m.id));
            if let Some(ref goal) = m.meeting_goal {
                context.push_str(&format!("Amaç: {}\n", goal));
            }
            if !m.key_decisions.is_empty() {
                context.push_str(&format!("Alınan Kararlar:\n- {}\n", m.key_decisions.join("\n- ")));
            }
            if let Some(ref acts) = m.action_items {
                let act_str = acts
                    .iter()
                    .map(|a| {
                        format!(
                            "- Görev: {} (Sorumlu: {}, Durum: {})",
                            a.task,
                            a.assignee.as_deref().unwrap_or("Belirtilmemiş"),
                            if a.is_completed { "Tamamlandı" } else { "Bekliyor" }
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                context.push_str(&format!("Eylem Maddeleri:\n{}\n", act_str));
            }
        }

        let prov = provider.unwrap_or_else(|| "local".to_string()).to_lowercase();
        let key = api_key.as_deref().unwrap_or("").trim();

        if !key.is_empty() && (prov.contains("gemini") || prov.contains("openai") || prov.contains("groq")) {
            if prov.contains("gemini") {
                if let Ok(ans) = RAGEngine::call_gemini_global_assistant(&context, q, key) {
                    let cited = RAGEngine::find_referenced_meeting_ids(&meetings_lock, q);
                    return Ok(GlobalAssistantResponse {
                        answer: ans,
                        cited_meeting_ids: cited,
                        provider_used: "Google Gemini 2.0 Flash".to_string(),
                    });
                }
            } else if prov.contains("openai") {
                if let Ok(ans) = RAGEngine::call_openai_compatible_global_assistant(&context, q, key, "https://api.openai.com/v1/chat/completions", "gpt-4o-mini") {
                    let cited = RAGEngine::find_referenced_meeting_ids(&meetings_lock, q);
                    return Ok(GlobalAssistantResponse {
                        answer: ans,
                        cited_meeting_ids: cited,
                        provider_used: "OpenAI GPT-4o-mini".to_string(),
                    });
                }
            } else if prov.contains("groq") {
                if let Ok(ans) = RAGEngine::call_openai_compatible_global_assistant(&context, q, key, "https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile") {
                    let cited = RAGEngine::find_referenced_meeting_ids(&meetings_lock, q);
                    return Ok(GlobalAssistantResponse {
                        answer: ans,
                        cited_meeting_ids: cited,
                        provider_used: "Groq Llama-3.3-70B".to_string(),
                    });
                }
            }
        }

        // 2. Try Local LLM (Ollama / Local Server)
        let custom_endpoint_ref = custom_endpoint.as_deref();
        let custom_model_ref = custom_model.as_deref();
        if let Ok(ollama_ans) = RAGEngine::call_ollama_local_assistant(&context, q, custom_endpoint_ref, custom_model_ref) {
            let cited = RAGEngine::find_referenced_meeting_ids(&meetings_lock, q);
            let model_label = custom_model_ref.unwrap_or("Llama-3.2");
            return Ok(GlobalAssistantResponse {
                answer: ollama_ans,
                cited_meeting_ids: cited,
                provider_used: format!("Yerel LLM ({} / Çevrimdışı)", model_label),
            });
        }

        // 3. Deterministic Local RAG Knowledge Retrieval Engine (Zero-RAM, Offline)
        let local_answer = RAGEngine::synthesize_local_multi_meeting_answer(&meetings_lock, q);
        let cited = if local_answer.contains("bulunamadı") {
            Vec::new()
        } else {
            RAGEngine::find_referenced_meeting_ids(&meetings_lock, q)
        };

        Ok(GlobalAssistantResponse {
            answer: local_answer,
            cited_meeting_ids: cited,
            provider_used: "EchoMind Yerel RAG Bilgi Çıkarım Motoru (Zero-RAM)".to_string(),
        })
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

#[tauri::command]
pub async fn test_ollama_connection(
    endpoint: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    let base = endpoint.as_deref().unwrap_or("http://127.0.0.1:11434").trim().trim_end_matches('/');
    let target_model = model.as_deref().unwrap_or("llama3.2");
    let test_url = format!("{}/api/tags", base);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&test_url)
        .send()
        .await
        .map_err(|e| format!("Ollama sunucusuna bağlanılamadı ({}): {}", base, e))?;

    if resp.status().is_success() {
        let json_val: serde_json::Value = resp.json().await.unwrap_or_default();
        let models: Vec<String> = json_val["models"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        if models.iter().any(|m| m.contains(target_model)) {
            Ok(format!("Bağlantı Başarılı! Sunucu aktif ve '{}' modeli hazır.", target_model))
        } else if !models.is_empty() {
            Ok(format!("Bağlantı Başarılı! Sunucu aktif (Mevcut modeller: {}).", models.join(", ")))
        } else {
            Ok("Bağlantı Başarılı! Sunucu aktif.".to_string())
        }
    } else {
        Err(format!("Sunucu yanıt verdi ancak hata kodu döndü: HTTP {}", resp.status()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{ActionItem, TopicBreakdown};

    #[test]
    fn test_phonetic_error_cleaning() {
        let raw = "Bizim yurt dışında yapmayı planladığımız bir depoy atarımı var. kdv ye ve fatu rayı bakalım.";
        let cleaned = TranscriptRedactor::clean_phonetic_errors_offline(raw);
        assert_eq!(cleaned, "Bizim yurt dışında yapmayı planladığımız bir depo yatırımı var. KDV'ye ve faturayı bakalım.");
    }

    #[test]
    fn test_local_summary_extractor() {
        let segments = vec![
            TranscriptSegment {
                id: 1,
                speaker_id: "spk1".to_string(),
                speaker_name: "Ramazan".to_string(),
                start_time_ms: 0,
                end_time_ms: 5000,
                timestamp_formatted: "00:00 -> 00:05".to_string(),
                text: "Tahsilat ve ödeme modülündeki sorunları çözmek için toplandık.".to_string(),
                language: "tr".to_string(),
                confidence: 0.99,
            },
            TranscriptSegment {
                id: 2,
                speaker_id: "spk2".to_string(),
                speaker_name: "Sercan".to_string(),
                start_time_ms: 5000,
                end_time_ms: 10000,
                timestamp_formatted: "00:05 -> 00:10".to_string(),
                text: "KDV ayrımı yapılması için sistemde düzenleme yapılacak.".to_string(),
                language: "tr".to_string(),
                confidence: 0.98,
            },
        ];

        let result = SummarizerEngine::generate_summary(&segments, "local", None, None, None, None, None);
        assert!(!result.summary.is_empty());
        assert!(!result.meeting_goal.is_empty());
        assert!(!result.action_items.is_empty());
        assert_eq!(result.provider_used, "🔒 Cihaz İçi Hızlı Özet (Çevrimdışı)");
    }

    #[test]
    fn test_build_system_prompt_templates() {
        let one_on_one = LLMClient::build_system_prompt(Some("one_on_one"), None);
        assert!(one_on_one.contains("1-on-1"));

        let sprint = LLMClient::build_system_prompt(Some("sprint_planning"), None);
        assert!(sprint.contains("Sprint Planlama"));

        let sales = LLMClient::build_system_prompt(Some("sales_bant"), None);
        assert!(sales.contains("BANT/MEDDIC"));

        let brain = LLMClient::build_system_prompt(Some("brainstorming"), None);
        assert!(brain.contains("Beyin Fırtınası"));

        let custom = LLMClient::build_system_prompt(Some("custom"), Some("ÖZEL TALİMAT"));
        assert!(custom.contains("ÖZEL TALİMAT"));
    }

    #[test]
    fn test_export_meeting_notes_markdown() {
        let record = MeetingRecord {
            id: "test-123".to_string(),
            title: "Test Toplantısı".to_string(),
            date_formatted: "22.08.2026".to_string(),
            duration_seconds: 120,
            duration_formatted: "02:00".to_string(),
            audio_file_path: None,
            segments: vec![],
            summary: "Test özeti".to_string(),
            key_decisions: vec!["Karar 1".to_string()],
            meeting_goal: Some("Test Amacı".to_string()),
            key_highlights: Some(vec!["Ders 1".to_string()]),
            action_items: Some(vec![ActionItem {
                task: "KDV ayrımı yapılacak".to_string(),
                assignee: Some("Sercan".to_string()),
                source_citations: vec![1],
                is_completed: false,
            }]),
            phase1_agreed: Some(vec!["Faz 1".to_string()]),
            phase2_deferred: Some(vec!["Faz 2".to_string()]),
            detailed_topics: Some(vec![TopicBreakdown {
                topic_title: "Modül Sorunları".to_string(),
                bullet_points: vec!["KDV ayrımı".to_string()],
            }]),
            participants: Some(vec!["Sercan".to_string(), "Ramazan".to_string()]),
            engine_used: Some("Cihazda (Whisper Small)".to_string()),
            summary_provider: Some("EchoMind Özet".to_string()),
        };

        let markdown = SummarizerEngine::export_notes_markdown(&record, None, None);
        assert!(markdown.contains("# Toplantı Raporu: Test Toplantısı"));
        assert!(markdown.contains("### 🎯 Toplantı Amacı"));
        assert!(markdown.contains("### ✅ Eylem Maddeleri & Sorumlular"));
        assert!(markdown.contains("KDV ayrımı yapılacak"));
    }

    #[test]
    fn test_synthesize_local_multi_meeting_answer() {
        let record = MeetingRecord {
            id: "mtg-001".to_string(),
            title: "Q3 Bütçe ve Depo Planlama".to_string(),
            date_formatted: "15.08.2026".to_string(),
            duration_seconds: 300,
            duration_formatted: "05:00".to_string(),
            audio_file_path: None,
            segments: vec![],
            summary: "Depo bütçesi konuşuldu.".to_string(),
            key_decisions: vec!["Yurt dışı depo yatırımı onaylandı.".to_string()],
            meeting_goal: Some("Depo açılışını planlamak".to_string()),
            key_highlights: Some(vec!["Maliyetler düşecek".to_string()]),
            action_items: Some(vec![ActionItem {
                task: "Kira kontratı imzalanacak".to_string(),
                assignee: Some("Ahmet".to_string()),
                source_citations: vec![],
                is_completed: false,
            }]),
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: Some(vec!["Ahmet".to_string(), "Mehmet".to_string()]),
            engine_used: None,
            summary_provider: None,
        };

        let meetings = vec![record];
        let ans = RAGEngine::synthesize_local_multi_meeting_answer(&meetings, "depo bütçe");
        assert!(ans.contains("Bilgi Bankası Analizi"));
        assert!(ans.contains("Yurt dışı depo yatırımı onaylandı"));
        assert!(ans.contains("Kira kontratı imzalanacak"));

        let actions_ans = RAGEngine::synthesize_local_multi_meeting_answer(&meetings, "Tüm toplantılardaki açık eylem maddelerini, görevleri ve sorumluları listele.");
        assert!(actions_ans.contains("Eylem Maddeleri & Görev Dağılımı"));
        assert!(actions_ans.contains("Kira kontratı imzalanacak"));
    }

    #[test]
    fn test_translate_summary_turkish_identity() {
        let summary = SummaryResult {
            meeting_goal: "Hedef".to_string(),
            key_highlights: vec!["Ders 1".to_string()],
            action_items: vec![],
            phase1_agreed: vec![],
            phase2_deferred: vec![],
            detailed_topics: vec![],
            participants: vec![],
            summary: "Özet".to_string(),
            key_decisions: vec![],
            agenda_topics: vec![],
            smart_title: None,
            provider_used: "Test".to_string(),
            generation_time_ms: 10,
        };

        let res = SummarizerEngine::translate_summary(
            &summary,
            "Türkçe",
            "tr",
            "local",
            None,
            None,
            None,
            Instant::now(),
        );

        assert!(res.is_ok());
        let res_summary = res.unwrap();
        assert_eq!(res_summary.meeting_goal, "Hedef");
        assert_eq!(res_summary.summary, "Özet");
    }

    #[test]
    fn test_export_notes_html_multilingual() {
        let record = MeetingRecord {
            id: "mtg-002".to_string(),
            title: "Executive Strategy Sync".to_string(),
            date_formatted: "01.09.2026".to_string(),
            duration_seconds: 600,
            duration_formatted: "10:00".to_string(),
            audio_file_path: None,
            segments: vec![],
            summary: "Türkçe varsayılan özet".to_string(),
            key_decisions: vec![],
            meeting_goal: Some("Türkçe hedef".to_string()),
            key_highlights: None,
            action_items: None,
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: Some(vec!["Alex".to_string()]),
            engine_used: None,
            summary_provider: None,
        };

        let translated_summary = SummaryResult {
            meeting_goal: "Scale international warehouse logistics and optimize tax compliance.".to_string(),
            key_highlights: vec!["Logistics cost will drop by 22%".to_string()],
            action_items: vec![ActionItem {
                task: "Sign overseas lease contract".to_string(),
                assignee: Some("Alex".to_string()),
                source_citations: vec![1],
                is_completed: false,
            }],
            phase1_agreed: vec!["Approve Q3 budget expansion".to_string()],
            phase2_deferred: vec![],
            detailed_topics: vec![],
            participants: vec!["Alex".to_string()],
            summary: "Executive summary in English".to_string(),
            key_decisions: vec![],
            agenda_topics: vec![],
            smart_title: None,
            provider_used: "EchoMind Translation Engine".to_string(),
            generation_time_ms: 50,
        };

        let html = SummarizerEngine::export_notes_html(&record, Some(&translated_summary), Some("en"));
        assert!(html.contains("Meeting Purpose & Objectives"));
        assert!(html.contains("Key Takeaways & Strategic Insights"));
        assert!(html.contains("Action Items & Tasks"));
        assert!(html.contains("Scale international warehouse logistics"));
        assert!(html.contains("Sign overseas lease contract"));
        assert!(html.contains("Print / Save as PDF"));
    }

    #[test]
    fn test_export_notes_slack_markdown() {
        let record = MeetingRecord {
            id: "mtg-slack".to_string(),
            title: "Sprint Retrospective".to_string(),
            date_formatted: "08.09.2026".to_string(),
            duration_seconds: 1800,
            duration_formatted: "30:00".to_string(),
            audio_file_path: None,
            segments: vec![],
            summary: "Sprint tamamlandı, hedeflere ulaşıldı.".to_string(),
            key_decisions: vec!["Yeni CI/CD pipeline'ına geçilecek".to_string()],
            meeting_goal: Some("Sprint değerlendirmesi".to_string()),
            key_highlights: Some(vec!["Hız %15 arttı".to_string()]),
            action_items: Some(vec![ActionItem {
                task: "Docker image boyutunu küçült".to_string(),
                assignee: Some("Emre".to_string()),
                source_citations: vec![],
                is_completed: false,
            }]),
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: Some(vec!["Emre".to_string(), "Can".to_string()]),
            engine_used: None,
            summary_provider: None,
        };

        let slack_md = SummarizerEngine::export_notes_slack_markdown(&record, None, Some("tr"));
        assert!(slack_md.contains("*🎯 Toplantı Amacı*"));
        assert!(slack_md.contains("*✅ Eylem Maddeleri & Sorumlular*"));
        assert!(slack_md.contains("Docker image boyutunu küçült"));
        assert!(slack_md.contains("@Emre"));
    }

    #[test]
    fn test_export_action_items_csv_and_markdown() {
        let record = MeetingRecord {
            id: "mtg-tasks".to_string(),
            title: "Product Roadmap Planning".to_string(),
            date_formatted: "08.09.2026".to_string(),
            duration_seconds: 3600,
            duration_formatted: "01:00:00".to_string(),
            audio_file_path: None,
            segments: vec![],
            summary: "".to_string(),
            key_decisions: vec![],
            meeting_goal: None,
            key_highlights: None,
            action_items: Some(vec![
                ActionItem {
                    task: "API endpoint tasarla, \"v2\" desteği ekle".to_string(),
                    assignee: Some("Selin".to_string()),
                    source_citations: vec![],
                    is_completed: false,
                },
                ActionItem {
                    task: "UI wireframeleri çiz".to_string(),
                    assignee: None,
                    source_citations: vec![],
                    is_completed: true,
                },
            ]),
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: None,
            engine_used: None,
            summary_provider: None,
        };

        let csv = SummarizerEngine::export_action_items_csv(&record, None);
        assert!(csv.starts_with("\"ID\",\"Task\",\"Assignee\",\"Status\",\"Meeting Title\",\"Date\""));
        assert!(csv.contains("\"1\",\"API endpoint tasarla, \"\"v2\"\" desteği ekle\",\"Selin\",\"To Do\",\"Product Roadmap Planning\",\"08.09.2026\""));
        assert!(csv.contains("\"2\",\"UI wireframeleri çiz\",\"Unassigned\",\"Done\",\"Product Roadmap Planning\",\"08.09.2026\""));

        let tasks_md = SummarizerEngine::export_action_items_markdown(&record, None);
        assert!(tasks_md.contains("# ✅ Aksiyon Maddeleri: Product Roadmap Planning (08.09.2026)"));
        assert!(tasks_md.contains("- [ ] **API endpoint tasarla, \"v2\" desteği ekle** (@Selin)"));
        assert!(tasks_md.contains("- [x] **UI wireframeleri çiz**"));
    }

    #[test]
    fn test_export_followup_email() {
        let record = MeetingRecord {
            id: "mtg-email".to_string(),
            title: "Client Sync & Demo".to_string(),
            date_formatted: "08.09.2026".to_string(),
            duration_seconds: 1200,
            duration_formatted: "20:00".to_string(),
            audio_file_path: None,
            segments: vec![],
            summary: "Müşteri demo sunumu başarılı geçti.".to_string(),
            key_decisions: vec!["Pilot başlangıç tarihi belirlendi".to_string()],
            meeting_goal: Some("Demo sunumu ve teklif onayı".to_string()),
            key_highlights: Some(vec!["Müşteri güvenlik modülünü onayladı".to_string()]),
            action_items: Some(vec![ActionItem {
                task: "Sözleşme taslağını ilet".to_string(),
                assignee: Some("Burak".to_string()),
                source_citations: vec![],
                is_completed: false,
            }]),
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: Some(vec!["Burak".to_string(), "Zeynep".to_string()]),
            engine_used: None,
            summary_provider: None,
        };

        let email_res = SummarizerEngine::export_followup_email(&record, None, Some("tr"));
        assert!(email_res.subject.contains("Takip & Toplantı Notları: Client Sync & Demo"));
        assert!(email_res.body.contains("🎯 Toplantı Amacı:"));
        assert!(email_res.body.contains("🎯 ✅ Eylem Maddeleri & Sorumlular:"));
        assert!(email_res.body.contains("Sözleşme taslağını ilet"));
        assert!(email_res.mailto_url.starts_with("mailto:?subject="));
        assert!(email_res.mailto_url.contains("&body="));
    }
}
