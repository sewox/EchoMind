use serde::{Deserialize, Serialize};
use crate::storage::{ActionItem, TopicBreakdown};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SummaryResult {
    pub meeting_goal: String,
    pub key_highlights: Vec<String>,
    pub action_items: Vec<ActionItem>,
    pub phase1_agreed: Vec<String>,
    pub phase2_deferred: Vec<String>,
    pub detailed_topics: Vec<TopicBreakdown>,
    pub participants: Vec<String>,
    pub summary: String,
    pub key_decisions: Vec<String>,
    pub agenda_topics: Vec<String>,
    #[serde(default)]
    pub smart_title: Option<String>,
    pub provider_used: String,
    pub generation_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossMeetingSearchResult {
    pub meeting_id: String,
    pub meeting_title: String,
    pub meeting_date: String,
    pub snippet: String,
    pub matched_type: String,
    pub relevance_score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartAdvisorRecommendation {
    pub recommended_engine: String,
    pub estimated_seconds: u64,
    pub reason: String,
    pub is_cloud_recommended: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeminiPart {
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeminiContent {
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeminiGenerationConfig {
    #[serde(rename = "responseMimeType", skip_serializing_if = "Option::is_none")]
    pub response_mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(rename = "maxOutputTokens", skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeminiRequest {
    pub contents: Vec<GeminiContent>,
    #[serde(rename = "generationConfig", skip_serializing_if = "Option::is_none")]
    pub generation_config: Option<GeminiGenerationConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeminiCandidate {
    pub content: GeminiContent,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeminiResponse {
    pub candidates: Option<Vec<GeminiCandidate>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaChatRequest {
    pub model: String,
    pub messages: Vec<OllamaChatMessage>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OllamaChatResponse {
    pub message: OllamaChatMessage,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenAIChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenAIChatRequest {
    pub model: String,
    pub messages: Vec<OpenAIChatMessage>,
    pub temperature: Option<f32>,
    #[serde(rename = "response_format", skip_serializing_if = "Option::is_none")]
    pub response_format: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenAIChoice {
    pub message: OpenAIChatMessage,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenAIChatResponse {
    pub choices: Option<Vec<OpenAIChoice>>,
}
