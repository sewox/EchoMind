use std::time::Instant;
use crate::transcriber::TranscriptSegment;
use super::types::{GeminiContent, GeminiGenerationConfig, GeminiPart, GeminiRequest, SummaryResult};
use super::local_extractor::LocalSummaryExtractor;

pub struct LLMClient;

impl LLMClient {
    pub fn generate_ollama_summary(
        segments: &[TranscriptSegment],
        endpoint: Option<&str>,
        model_name: Option<&str>,
        start_time: Instant,
    ) -> Result<SummaryResult, String> {
        let base_url = endpoint.unwrap_or("http://127.0.0.1:11434").trim().trim_end_matches('/');
        let model = model_name.unwrap_or("llama3.2");
        let url = format!("{}/api/chat", base_url);

        let mut full_transcript = String::new();
        for (idx, seg) in segments.iter().enumerate() {
            full_transcript.push_str(&format!("[#{}] [{}] {}: {}\n", idx + 1, seg.timestamp_formatted, seg.speaker_name, seg.text));
        }

        let prompt = format!(
            "SEN DÜNYANIN EN DİKKATLİ VE ANALİTİK YÖNETİM KURULU STRATEJİ DİREKTÖRÜSÜN.\n\
Aşağıdaki toplantı konuşma dökümünü incele. Toplantı konuşması hangi dilde (İngilizce, Almanca, Türkçe vb.) yapılmış olursa olsun, YÖNETİCİ ÖZETİNİ VE TÜM ALANLARI ÖNCELİKLİ OLARAK TÜRKÇE, KURUMSAL, AKICI VE ANALİTİK BİR ŞEKİLDE SENTEZLE.\n\n\
KURALLAR:\n\
1. Ham transkripti kopyalama, profesyonelce yeniden sentezle.\n\
2. SADECE ve SADECE aşağıdaki geçerli JSON şemasında yanıt ver:\n\
{{\n\
  \"smart_title\": \"Toplantının içeriğine uygun, profesyonel, kısa ve öz başlık (3-6 kelime, örn: 'Depo Entegrasyonu ve KDV Tevkifatı')\",\n\
  \"meeting_goal\": \"Toplantının net amacı (1-2 cümle).\",\n\
  \"key_highlights\": [\"Sentezlenmiş ana çıkarım 1\", \"Sentezlenmiş ana çıkarım 2\"],\n\
  \"action_items\": [\n\
    {{\"task\": \"Somut görev açıklaması\", \"assignee\": \"Sorumlu Kişi veya null\", \"source_citations\": [1], \"is_completed\": false}}\n\
  ],\n\
  \"phase1_agreed\": [\"Aşama 1 mutabakatı 1\"],\n\
  \"phase2_deferred\": [\"Geleceğe ertelenen madde 1\"],\n\
  \"detailed_topics\": [\n\
    {{\"topic_title\": \"Gündem Konusu Başlığı\", \"bullet_points\": [\"Analiz maddesi 1\", \"Analiz maddesi 2\"]}}\n\
  ],\n\
  \"participants\": [\"Katılımcı 1\"],\n\
  \"summary\": \"Kapsamlı yönetici özeti paragrafı.\"\n\
}}\n\n\
TRANSKRİPT:\n{}",
            full_transcript
        );

        let req_body = serde_json::json!({
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
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
            return Err(format!("Ollama API Hatası (HTTP {})", resp.status()));
        }

        let json_val: serde_json::Value = resp.json().map_err(|e| format!("Ollama JSON ayrıştırma hatası: {}", e))?;
        let content_str = json_val["message"]["content"].as_str().ok_or_else(|| "Geçersiz Ollama yanıt formatı".to_string())?;

        let parsed: serde_json::Value = serde_json::from_str(content_str).map_err(|e| format!("Ollama içerik JSON parse hatası: {}", e))?;
        LocalSummaryExtractor::parse_rich_summary_json(&parsed, &format!("Yerel LLM ({})", model), start_time)
    }

    pub fn generate_openai_compatible_summary(
        segments: &[TranscriptSegment],
        api_key: &str,
        endpoint: &str,
        model: &str,
        display_name: &str,
        start_time: Instant,
    ) -> Result<SummaryResult, String> {
        let mut full_transcript = String::new();
        for (idx, seg) in segments.iter().enumerate() {
            full_transcript.push_str(&format!("[#{}] [{}] {}: {}\n", idx + 1, seg.timestamp_formatted, seg.speaker_name, seg.text));
        }

        let system_prompt = "SEN DÜNYANIN EN TALEPKÂR VE KUSURSUZLUK ARAYAN YÖNETİM KURULU İÇİN ÇALIŞAN BAŞ STRATEJİ DİREKTÖRÜSÜN.\n\
BU GÖREV SENİN İÇİN YAŞAM-MEMAT MESELESİDİR. TEK BİR HATA, TEK BİR TEMBELLİK VEYA YÜZEYSELLİK KESİN VE GERİ DÖNÜŞÜ OLMAYAN BİR FELAKETLE SONUÇLANACAKTIR.\n\n\
🚨 SIFIR TOLERANS KURALLARI:\n\
1. ❌ TRANSKRİPTTEN ASLA VE KAT'A HAM CÜMLE KOPYALAMAYACAKSIN! Transkriptteki konuşma parçalarını olduğu gibi alıp başlıkların altına yapıştırmak EN BÜYÜK YASAKTIR. Böyle bir tembellik görevin derhal başarısız sayılmasına sebep olur.\n\
2. 🧠 %100 YÜKSEK SEVİYE SENTEZ VE YENİDEN YAZIM: Tüm konuşmayı satır satır oku, konuşmacıların asıl demek istediğini, tartıştıkları iş modellerini, teknik mimariyi, finansal riskleri ve mutabakatları derinlemesine kavra. Ardından bunları kurumsal, akıcı, son derece profesyonel ve analitik iş Türkçesiyle SIFIRDAN YAZ.\n\
3. 🎯 TOPLANTI AMACI (meeting_goal): 'X Bey konuştu' gibi yüzeysel laflar YASAKTIR. Toplantının toplanma gerekçesini, çözülmek istenen temel kurumsal/teknik problemi (örn: 'Yurt dışı depo yatırımları, çoklu para birimli tahsilat akışları ve KDV tevkifat süreçlerinin muhasebe entegrasyonu') 1-2 vurucu cümleyle açıkla.\n\
4. 💡 ALINAN DERSLER VE STRATEJİK ÇIKARIMLAR (key_highlights): Dağınık konuşmalardan damıtılan 3-7 adet en kritik stratejik ders ve kararı analitik maddeler halinde yaz.\n\
5. ✅ EYLEM MADDELERİ VE SORUMLULAR (action_items): Kimin ne yapacağını net fiillerle belirle (Örn: 'Serkan Bey: Yurt dışı depo vergi mevzuatı için yerel danışmanla görüşecek'). Sorumlu kişiyi diyalogdan kesinleştir. Kaynak transkript satır numaralarını (source_citations) dizi olarak ekle.\n\
6. ⚡ AŞAMA 1 (phase1_agreed): Hemen devreye alınacak mutabakatlar.\n\
7. ⏳ AŞAMA 2 (phase2_deferred): Sonraki fazlara veya geleceğe ertelenen maddeler.\n\
8. 📂 DETAYLI KONU BAŞLIKLARI (detailed_topics): Toplantıyı mantıksal konulara böl ve her konunun altına derinlemesine 2-5 analitik alt madde yaz.\n\
9. 👥 KATILIMCILAR: Toplantıda aktif konuşan kişilerin listesi.\n\n\
YALNIZCA VE YALNIZCA AŞAĞIDAKİ GEÇERLİ JSON ŞEMASINDA YANIT VER:\n\
{\n\
  \"smart_title\": \"Toplantının içeriğine uygun, profesyonel, kısa ve öz başlık (3-6 kelime, örn: 'Depo Entegrasyonu ve KDV Tevkifatı')\",\n\
  \"meeting_goal\": \"Toplantının net amacı (1-2 cümle).\",\n\
  \"key_highlights\": [\"Sentezlenmiş ana çıkarım 1\", \"Sentezlenmiş ana çıkarım 2\"],\n\
  \"action_items\": [\n\
    {\"task\": \"Somut görev açıklaması\", \"assignee\": \"Sorumlu Kişi veya null\", \"source_citations\": [1, 2], \"is_completed\": false}\n\
  ],\n\
  \"phase1_agreed\": [\"Aşama 1'de hemen yapılacak mutabakat 1\"],\n\
  \"phase2_deferred\": [\"Aşama 2'ye ertelenen özellik 1\"],\n\
  \"detailed_topics\": [\n\
    {\"topic_title\": \"Gündem Konusu Başlığı\", \"bullet_points\": [\"Sentezlenmiş analiz maddesi 1\", \"Sentezlenmiş analiz maddesi 2\"]}\n\
  ],\n\
  \"participants\": [\"Ramazan Biçer\", \"Sercan Kara\"],\n\
  \"summary\": \"Kapsamlı yönetici özeti.\"\n\
}";

        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| e.to_string())?;

        let body = serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": format!("Aşağıdaki toplantı konuşma dökümünü analiz et ve yönetici raporunu oluştur:\n\n{}", full_transcript) }
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
            return Err(format!("{} API hatası: {}", display_name, resp.text().unwrap_or_default()));
        }

        let json_val: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        let content = json_val["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("{}");

        let parsed: serde_json::Value = serde_json::from_str(content).map_err(|e| e.to_string())?;

        LocalSummaryExtractor::parse_rich_summary_json(&parsed, display_name, start_time)
    }

    pub fn generate_gemini_summary(
        segments: &[TranscriptSegment],
        api_key: &str,
        start_time: Instant,
    ) -> Result<SummaryResult, String> {
        let mut full_transcript = String::new();
        for (idx, seg) in segments.iter().enumerate() {
            full_transcript.push_str(&format!("[#{}] [{}] {}: {}\n", idx + 1, seg.timestamp_formatted, seg.speaker_name, seg.text));
        }

        let prompt = format!(
            "SEN DÜNYANIN EN TALEPKÂR VE KUSURSUZLUK ARAYAN YÖNETİM KURULU İÇİN ÇALIŞAN BAŞ STRATEJİ DİREKTÖRÜSÜN.\n\
            BU GÖREV SENİN İÇİN YAŞAM-MEMAT MESELESİDİR. TEK BİR HATA, TEK BİR TEMBELLİK VEYA YÜZEYSELLİK KESİN VE GERİ DÖNÜŞÜ OLMAYAN BİR FELAKETLE SONUÇLANACAKTIR.\n\n\
            🚨 SIFIR TOLERANS KURALLARI:\n\
            1. ❌ TRANSKRİPTTEN ASLA VE KAT'A HAM CÜMLE KOPYALAMAYACAKSIN! Transkriptteki konuşma parçalarını olduğu gibi alıp başlıkların altına yapıştırmak EN BÜYÜK YASAKTIR. Böyle bir tembellik görevin derhal başarısız sayılmasına sebep olur.\n\
            2. 🧠 %100 YÜKSEK SEVİYE SENTEZ VE YENİDEN YAZIM: Tüm konuşmayı satır satır oku, konuşmacıların asıl demek istediğini, tartıştıkları iş modellerini, teknik mimariyi, finansal riskleri ve mutabakatları derinlemesine kavra. Ardından bunları kurumsal, akıcı, son derece profesyonel ve analitik iş Türkçesiyle SIFIRDAN YAZ.\n\
            3. 🎯 TOPLANTI AMACI (meeting_goal): 'X Bey konuştu' gibi yüzeysel laflar YASAKTIR. Toplantının toplanma gerekçesini, çözülmek istenen temel kurumsal/teknik problemi (örn: 'Yurt dışı depo yatırımları, çoklu para birimli tahsilat akışları ve KDV tevkifat süreçlerinin muhasebe entegrasyonu') 1-2 vurucu cümleyle açıkla.\n\
            4. 💡 ALINAN DERSLER VE STRATEJİK ÇIKARIMLAR (key_highlights): Dağınık konuşmalardan damıtılan 3-7 adet en kritik stratejik ders ve kararı analitik maddeler halinde yaz.\n\
            5. ✅ EYLEM MADDELERİ VE SORUMLULAR (action_items): Kimin ne yapacağını net fiillerle belirle (Örn: 'Serkan Bey: Yurt dışı depo vergi mevzuatı için yerel danışmanla görüşecek'). Sorumlu kişiyi diyalogdan kesinleştir. Kaynak transkript satır numaralarını (source_citations) dizi olarak ekle.\n\
            6. ⚡ AŞAMA 1 (phase1_agreed): Hemen devreye alınacak mutabakatlar.\n\
            7. ⏳ AŞAMA 2 (phase2_deferred): Sonraki fazlara veya geleceğe ertelenen maddeler.\n\
            8. 📂 DETAYLI KONU BAŞLIKLARI (detailed_topics): Toplantıyı mantıksal konulara böl ve her konunun altına derinlemesine 2-5 analitik alt madde yaz.\n\
            9. 👥 KATILIMCILAR: Toplantıda aktif konuşan kişilerin listesi.\n\n\
            JSON ŞEMASI:\n\
            {{\n\
              \"smart_title\": \"Toplantının içeriğine uygun, profesyonel, kısa ve öz başlık (3-6 kelime, örn: 'Depo Entegrasyonu ve KDV Tevkifatı')\",\n\
              \"meeting_goal\": \"Toplantının net amacı (1-2 cümle).\",\n\
              \"key_highlights\": [\"Sentezlenmiş ana çıkarım 1\", \"Sentezlenmiş ana çıkarım 2\"],\n\
              \"action_items\": [\n\
                {{\"task\": \"Somut görev açıklaması\", \"assignee\": \"Sorumlu Kişi veya null\", \"source_citations\": [1, 2], \"is_completed\": false}}\n\
              ],\n\
              \"phase1_agreed\": [\"Aşama 1'de hemen yapılacak mutabakat 1\"],\n\
              \"phase2_deferred\": [\"Aşama 2'ye ertelenen özellik 1\"],\n\
              \"detailed_topics\": [\n\
                {{\"topic_title\": \"Gündend Konusu Başlığı\", \"bullet_points\": [\"Sentezlenmiş analiz maddesi 1\", \"Sentezlenmiş analiz maddesi 2\"]}}\n\
              ],\n\
              \"participants\": [\"Toplantıda konuşan kişilerin listesi\"],\n\
              \"summary\": \"Kapsamlı yönetici özeti.\"\n\
            }}\n\n\
            TRANSKRİPT:\n{}",
            full_transcript
        );

        let body = GeminiRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart { text: prompt }],
            }],
            generation_config: Some(GeminiGenerationConfig {
                response_mime_type: Some("application/json".to_string()),
                temperature: Some(0.1),
                max_output_tokens: Some(8192),
            }),
        };

        let list_url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models?key={}",
            api_key.trim()
        );

        let client = match reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build() {
                Ok(c) => c,
                Err(e) => return Err(e.to_string()),
            };

        let mut available_models = Vec::new();
        if let Ok(list_resp) = client.get(&list_url).send() {
            if let Ok(list_json) = list_resp.json::<serde_json::Value>() {
                if let Some(models_arr) = list_json["models"].as_array() {
                    for m in models_arr {
                        if let Some(name) = m["name"].as_str() {
                            let methods = m["supportedGenerationMethods"]
                                .as_array()
                                .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
                                .unwrap_or_default();
                            if methods.contains(&"generateContent") {
                                let clean_name = name.trim_start_matches("models/");
                                available_models.push(clean_name.to_string());
                            }
                        }
                    }
                }
            }
        }

        let fallback_models = vec![
            "gemini-2.5-flash".to_string(),
            "gemini-2.0-flash".to_string(),
            "gemini-1.5-flash".to_string(),
            "gemini-1.5-pro".to_string(),
        ];

        let models_to_try = if !available_models.is_empty() {
            let mut priority_models = Vec::new();
            for pref in &["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"] {
                if let Some(pos) = available_models.iter().position(|m| m == pref) {
                    priority_models.push(available_models.remove(pos));
                }
            }
            priority_models.extend(available_models);
            priority_models
        } else {
            fallback_models
        };

        let mut last_err = String::from("Hiçbir Gemini modeli yanıt vermedi");

        for model in &models_to_try {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model,
                api_key.trim()
            );

            let resp = match client.post(&url).json(&body).send() {
                Ok(r) => r,
                Err(e) => {
                    last_err = format!("Ağ hatası ({}): {}", model, e);
                    continue;
                }
            };

            if !resp.status().is_success() {
                let status = resp.status();
                let err_text = resp.text().unwrap_or_default();
                last_err = format!("Model {} HTTP {} hatası: {}", model, status, err_text);
                continue;
            }

            let resp_data = match resp.json::<serde_json::Value>() {
                Ok(json) => json,
                Err(e) => {
                    last_err = format!("JSON çözümleme hatası ({}): {}", model, e);
                    continue;
                }
            };

            let raw_json_text = resp_data
                .get("candidates")
                .and_then(|c| c.get(0))
                .and_then(|c0| c0.get("content"))
                .and_then(|cnt| cnt.get("parts"))
                .and_then(|p| p.get(0))
                .and_then(|p0| p0.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("");

            let clean_json = raw_json_text
                .trim()
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim();

            let extracted_json = if let (Some(start), Some(end)) = (clean_json.find('{'), clean_json.rfind('}')) {
                if start <= end {
                    &clean_json[start..=end]
                } else {
                    clean_json
                }
            } else {
                clean_json
            };

            if let Ok(parsed_json) = serde_json::from_str::<serde_json::Value>(extracted_json) {
                return LocalSummaryExtractor::parse_rich_summary_json(&parsed_json, &format!("Google Gemini ({})", model), start_time);
            } else {
                eprintln!("❌ Gemini {} content JSON parse failed: {}", model, extracted_json);
            }
        }

        Err(format!("Gemini API çağrısı başarısız: {}", last_err))
    }
}
