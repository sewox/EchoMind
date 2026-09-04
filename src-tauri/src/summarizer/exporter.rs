use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use crate::storage::MeetingRecord;
use super::types::SummaryResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportLabels {
    pub html_lang: String,
    pub report_title_prefix: String,
    pub date_label: String,
    pub duration_label: String,
    pub model_label: String,
    pub meeting_goal_title: String,
    pub highlights_title: String,
    pub action_items_title: String,
    pub assignee_label: String,
    pub phase1_title: String,
    pub phase2_title: String,
    pub detailed_topics_title: String,
    pub participants_title: String,
    pub transcript_title: String,
    pub footer_text: String,
    pub print_btn: String,
}

static LABELS_MAP: OnceLock<HashMap<String, ReportLabels>> = OnceLock::new();

impl ReportLabels {
    pub fn for_lang(lang_code: Option<&str>) -> Self {
        let map = LABELS_MAP.get_or_init(|| {
            let json_str = include_str!("../../locales/report_labels.json");
            serde_json::from_str(json_str).unwrap_or_default()
        });

        let code = lang_code.unwrap_or("tr").to_lowercase();
        let prefix = if code.len() >= 2 { &code[..2] } else { "tr" };

        map.get(prefix)
            .cloned()
            .or_else(|| map.get("tr").cloned())
            .unwrap_or_else(|| ReportLabels {
                html_lang: "tr".to_string(),
                report_title_prefix: "Toplantı Raporu".to_string(),
                date_label: "📅 Tarih".to_string(),
                duration_label: "⏱️ Süre".to_string(),
                model_label: "🤖 Model".to_string(),
                meeting_goal_title: "🎯 Toplantı Amacı".to_string(),
                highlights_title: "💡 Alınan Dersler & Ana Çıkarımlar".to_string(),
                action_items_title: "✅ Eylem Maddeleri & Sorumlular".to_string(),
                assignee_label: "👤 Sorumlu".to_string(),
                phase1_title: "⚡ Aşama 1 — Mutabakat Sağlanan Değişiklikler".to_string(),
                phase2_title: "⏳ Aşama 2 — Geleceğe Ertelenen Maddeler".to_string(),
                detailed_topics_title: "📂 Konu Başlıklarına Göre Detaylı Özet".to_string(),
                participants_title: "👥 Katılımcılar".to_string(),
                transcript_title: "💬 Detaylı Transkript Dökümü".to_string(),
                footer_text: "EchoMind AI Meeting Assistant • Yönetici Toplantı Özeti".to_string(),
                print_btn: "🖨️ PDF / Yazdır".to_string(),
            })
    }
}

pub struct MeetingExporter;

impl MeetingExporter {
    pub fn export_notes_markdown(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
        lang_code: Option<&str>,
    ) -> String {
        let labels = ReportLabels::for_lang(lang_code);
        let mut md = String::new();
        md.push_str(&format!("# {}: {}\n", labels.report_title_prefix, record.title));
        md.push_str(&format!("**{}:** {} • **{}:** {}\n\n", labels.date_label, record.date_formatted, labels.duration_label, record.duration_formatted));
        
        let goal_opt = custom_summary.map(|s| &s.meeting_goal).or(record.meeting_goal.as_ref());
        let highlights_opt = custom_summary.map(|s| &s.key_highlights).or(record.key_highlights.as_ref());
        let actions_opt = custom_summary.map(|s| &s.action_items).or(record.action_items.as_ref());
        let phase1_opt = custom_summary.map(|s| &s.phase1_agreed).or(record.phase1_agreed.as_ref());
        let phase2_opt = custom_summary.map(|s| &s.phase2_deferred).or(record.phase2_deferred.as_ref());
        let topics_opt = custom_summary.map(|s| &s.detailed_topics).or(record.detailed_topics.as_ref());
        let parts_opt = custom_summary.map(|s| &s.participants).or(record.participants.as_ref());

        // 1. Amaç / Purpose
        if let Some(goal) = goal_opt {
            md.push_str(&format!("### {}\n", labels.meeting_goal_title));
            md.push_str(&format!("{}\n\n", goal));
        }

        // 2. Alınan Dersler / Key Highlights
        if let Some(highlights) = highlights_opt {
            if !highlights.is_empty() {
                md.push_str(&format!("### {}\n", labels.highlights_title));
                for h in highlights {
                    md.push_str(&format!("- {}\n", h));
                }
                md.push_str("\n");
            }
        }

        // 3. Eylem Maddeleri / Action Items
        if let Some(actions) = actions_opt {
            if !actions.is_empty() {
                md.push_str(&format!("### {}\n", labels.action_items_title));
                for a in actions {
                    let check = if a.is_completed { "[x]" } else { "[ ]" };
                    let assignee_str = a.assignee.as_deref().map(|p| format!(" ➔ **{}**", p)).unwrap_or_default();
                    let cite_str = if !a.source_citations.is_empty() {
                        format!(" ({})", a.source_citations.iter().map(|c| c.to_string()).collect::<Vec<_>>().join(", "))
                    } else {
                        "".to_string()
                    };
                    md.push_str(&format!("- {} {}{}{}\n", check, a.task, assignee_str, cite_str));
                }
                md.push_str("\n");
            }
        }

        // 4. Aşama 1 Mutabakat / Phase 1
        if let Some(phase1) = phase1_opt {
            if !phase1.is_empty() {
                md.push_str(&format!("### {}\n", labels.phase1_title));
                for p in phase1 {
                    md.push_str(&format!("- {}\n", p));
                }
                md.push_str("\n");
            }
        }

        // 5. Aşama 2 Ertelenenler / Phase 2
        if let Some(phase2) = phase2_opt {
            if !phase2.is_empty() {
                md.push_str(&format!("### {}\n", labels.phase2_title));
                for p in phase2 {
                    md.push_str(&format!("- {}\n", p));
                }
                md.push_str("\n");
            }
        }

        // 6. Detaylı Konu Başlıkları / Detailed Topics
        if let Some(topics) = topics_opt {
            if !topics.is_empty() {
                md.push_str(&format!("### {}\n", labels.detailed_topics_title));
                for t in topics {
                    md.push_str(&format!("#### {}\n", t.topic_title));
                    for b in &t.bullet_points {
                        md.push_str(&format!("- {}\n", b));
                    }
                    md.push_str("\n");
                }
            }
        }

        // 7. Katılımcılar / Participants
        if let Some(parts) = parts_opt {
            if !parts.is_empty() {
                md.push_str(&format!("### {}\n", labels.participants_title));
                md.push_str(&format!("{}\n\n", parts.join(", ")));
            }
        }

        // 8. Transkript Dökümü
        md.push_str(&format!("## {}\n", labels.transcript_title));
        for seg in &record.segments {
            md.push_str(&format!("**[{}] {}**: {}\n", seg.timestamp_formatted, seg.speaker_name, seg.text));
        }

        md
    }

    pub fn export_notes_html(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
        lang_code: Option<&str>,
    ) -> String {
        let labels = ReportLabels::for_lang(lang_code);
        let goal_opt = custom_summary.map(|s| &s.meeting_goal).or(record.meeting_goal.as_ref());
        let highlights_opt = custom_summary.map(|s| &s.key_highlights).or(record.key_highlights.as_ref());
        let actions_opt = custom_summary.map(|s| &s.action_items).or(record.action_items.as_ref());
        let phase1_opt = custom_summary.map(|s| &s.phase1_agreed).or(record.phase1_agreed.as_ref());
        let phase2_opt = custom_summary.map(|s| &s.phase2_deferred).or(record.phase2_deferred.as_ref());
        let topics_opt = custom_summary.map(|s| &s.detailed_topics).or(record.detailed_topics.as_ref());
        let parts_opt = custom_summary.map(|s| &s.participants).or(record.participants.as_ref());
        let provider_str = custom_summary.map(|s| s.provider_used.as_str()).or(record.summary_provider.as_deref());

        let mut html = String::new();
        html.push_str(&format!("<!DOCTYPE html>\n<html lang=\"{}\">\n<head>\n", labels.html_lang));
        html.push_str("<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n");
        html.push_str(&format!("<title>{} - {}</title>\n", labels.report_title_prefix, record.title));
        html.push_str(r#"<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
:root {
  --primary: #0284c7;
  --bg: #f8fafc;
  --card-bg: #ffffff;
  --text: #0f172a;
  --text-muted: #64748b;
  --border: #e2e8f0;
  --badge-bg: #f1f5f9;
  --accent: #38bdf8;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background-color: var(--bg);
  color: var(--text);
  line-height: 1.6;
  padding: 40px 20px;
}
.container { max-width: 900px; margin: 0 auto; }
.header {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
  color: #ffffff;
  padding: 32px;
  border-radius: 16px;
  margin-bottom: 24px;
  box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.1);
}
.badge-app {
  display: inline-block;
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.3);
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  margin-bottom: 12px;
  letter-spacing: 0.5px;
}
.header h1 { font-size: 26px; font-weight: 700; margin-bottom: 12px; line-height: 1.3; }
.meta-row { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: #94a3b8; }
.meta-item { display: flex; align-items: center; gap: 6px; }
.meta-item strong { color: #f1f5f9; }
.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.02);
}
.card-title {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}
.goal-text { font-size: 15px; color: #334155; line-height: 1.7; }
.highlight-list, .decision-list { list-style: none; }
.highlight-list li, .decision-list li {
  position: relative;
  padding-left: 24px;
  margin-bottom: 10px;
  font-size: 14px;
  color: #334155;
}
.highlight-list li::before {
  content: "💡";
  position: absolute;
  left: 0;
  top: 0;
  font-size: 13px;
}
.decision-list li::before {
  content: "⚡";
  position: absolute;
  left: 0;
  top: 0;
  font-size: 13px;
}
.action-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 10px;
  margin-bottom: 10px;
}
.checkbox {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 2px solid #94a3b8;
  margin-top: 2px;
  flex-shrink: 0;
}
.action-item.completed .checkbox {
  background-color: #10b981;
  border-color: #10b981;
}
.action-content { flex: 1; font-size: 14px; color: #1e293b; }
.assignee-badge {
  display: inline-block;
  background: #e0f2fe;
  color: #0369a1;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  margin-top: 4px;
}
.topic-card {
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  margin-bottom: 12px;
}
.topic-title { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
.dialogue-item {
  display: flex;
  gap: 14px;
  padding: 14px;
  border-bottom: 1px solid #f1f5f9;
}
.dialogue-item:last-child { border-bottom: none; }
.speaker-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #e2e8f0;
  color: #475569;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
}
.dialogue-content { flex: 1; }
.dialogue-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
.dialogue-speaker { font-size: 13px; font-weight: 700; color: #1e293b; }
.dialogue-time { font-size: 11px; font-family: monospace; color: #94a3b8; }
.dialogue-text { font-size: 13.5px; color: #334155; line-height: 1.6; }
.participants-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.participant-tag {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  color: #334155;
  padding: 4px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}
.print-btn {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: #0284c7;
  color: #ffffff;
  border: none;
  padding: 12px 20px;
  border-radius: 9999px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 100;
}
.print-btn:hover { background: #0369a1; }
@media print {
  body { background: #ffffff; padding: 0; }
  .print-btn { display: none; }
  .header { box-shadow: none; border-radius: 0; background: #0f172a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .card { box-shadow: none; break-inside: avoid; }
}
</style>
</head>
<body>
"#);

        html.push_str(&format!("<button class=\"print-btn\" onclick=\"window.print()\">{}</button>\n<div class=\"container\">\n", labels.print_btn));

        // Header
        html.push_str("<div class=\"header\">\n");
        html.push_str("<div class=\"badge-app\">EchoMind AI Meeting Assistant</div>\n");
        html.push_str(&format!("<h1>{}</h1>\n", record.title));
        html.push_str("<div class=\"meta-row\">\n");
        html.push_str(&format!("<div class=\"meta-item\">{}: <strong>{}</strong></div>\n", labels.date_label, record.date_formatted));
        html.push_str(&format!("<div class=\"meta-item\">{}: <strong>{}</strong></div>\n", labels.duration_label, record.duration_formatted));
        if let Some(prov) = provider_str {
            html.push_str(&format!("<div class=\"meta-item\">{}: <strong>{}</strong></div>\n", labels.model_label, prov));
        }
        html.push_str("</div>\n</div>\n");

        // Goal
        if let Some(goal) = goal_opt {
            html.push_str(&format!("<div class=\"card\">\n<div class=\"card-title\">{}</div>\n", labels.meeting_goal_title));
            html.push_str(&format!("<div class=\"goal-text\">{}</div>\n</div>\n", goal));
        }

        // Highlights
        if let Some(highlights) = highlights_opt {
            if !highlights.is_empty() {
                html.push_str(&format!("<div class=\"card\">\n<div class=\"card-title\">{}</div>\n<ul class=\"highlight-list\">\n", labels.highlights_title));
                for h in highlights {
                    html.push_str(&format!("<li>{}</li>\n", h));
                }
                html.push_str("</ul>\n</div>\n");
            }
        }

        // Action items
        if let Some(actions) = actions_opt {
            if !actions.is_empty() {
                html.push_str(&format!("<div class=\"card\">\n<div class=\"card-title\">{}</div>\n", labels.action_items_title));
                for a in actions {
                    let completed_cls = if a.is_completed { " completed" } else { "" };
                    html.push_str(&format!("<div class=\"action-item{}\">\n", completed_cls));
                    html.push_str("<div class=\"checkbox\"></div>\n");
                    html.push_str("<div class=\"action-content\">\n");
                    html.push_str(&format!("<div>{}</div>\n", a.task));
                    if let Some(ref ass) = a.assignee {
                        html.push_str(&format!("<span class=\"assignee-badge\">{}: {}</span>\n", labels.assignee_label, ass));
                    }
                    html.push_str("</div>\n</div>\n");
                }
                html.push_str("</div>\n");
            }
        }

        // Phase 1 Agreed
        if let Some(phase1) = phase1_opt {
            if !phase1.is_empty() {
                html.push_str(&format!("<div class=\"card\">\n<div class=\"card-title\">{}</div>\n<ul class=\"decision-list\">\n", labels.phase1_title));
                for p in phase1 {
                    html.push_str(&format!("<li>{}</li>\n", p));
                }
                html.push_str("</ul>\n</div>\n");
            }
        }

        // Phase 2 Deferred
        if let Some(phase2) = phase2_opt {
            if !phase2.is_empty() {
                html.push_str(&format!("<div class=\"card\">\n<div class=\"card-title\">{}</div>\n<ul class=\"decision-list\">\n", labels.phase2_title));
                for p in phase2 {
                    html.push_str(&format!("<li>{}</li>\n", p));
                }
                html.push_str("</ul>\n</div>\n");
            }
        }

        // Topics
        if let Some(topics) = topics_opt {
            if !topics.is_empty() {
                html.push_str(&format!("<div class=\"card\">\n<div class=\"card-title\">{}</div>\n", labels.detailed_topics_title));
                for t in topics {
                    html.push_str("<div class=\"topic-card\">\n");
                    html.push_str(&format!("<div class=\"topic-title\">{}</div>\n<ul style=\"padding-left:18px; font-size:13.5px; color:#334155;\">\n", t.topic_title));
                    for b in &t.bullet_points {
                        html.push_str(&format!("<li style=\"margin-bottom:6px;\">{}</li>\n", b));
                    }
                    html.push_str("</ul>\n</div>\n");
                }
                html.push_str("</div>\n");
            }
        }

        // Participants
        if let Some(parts) = parts_opt {
            if !parts.is_empty() {
                html.push_str(&format!("<div class=\"card\">\n<div class=\"card-title\">{}</div>\n<div class=\"participants-tags\">\n", labels.participants_title));
                for p in parts {
                    html.push_str(&format!("<span class=\"participant-tag\">{}</span>\n", p));
                }
                html.push_str("</div>\n</div>\n");
            }
        }

        html.push_str("<div style=\"text-align:center; padding: 24px 0 10px 0; color: #94a3b8; font-size: 12px;\">\n");
        html.push_str(&format!("{}\n", labels.footer_text));
        html.push_str("</div>\n");

        html.push_str("</div>\n</body>\n</html>");
        html
    }

    pub fn export_notes_email_digest(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
        lang_code: Option<&str>,
    ) -> String {
        let labels = ReportLabels::for_lang(lang_code);
        let goal_opt = custom_summary.map(|s| &s.meeting_goal).or(record.meeting_goal.as_ref());
        let highlights_opt = custom_summary.map(|s| &s.key_highlights).or(record.key_highlights.as_ref());
        let actions_opt = custom_summary.map(|s| &s.action_items).or(record.action_items.as_ref());
        let phase1_opt = custom_summary.map(|s| &s.phase1_agreed).or(record.phase1_agreed.as_ref());
        let phase2_opt = custom_summary.map(|s| &s.phase2_deferred).or(record.phase2_deferred.as_ref());
        let parts_opt = custom_summary.map(|s| &s.participants).or(record.participants.as_ref());

        let mut text = String::new();
        text.push_str(&format!("📌 {}: {}\n", labels.report_title_prefix.to_uppercase(), record.title));
        text.push_str(&format!("{}: {} | {}: {}\n", labels.date_label, record.date_formatted, labels.duration_label, record.duration_formatted));
        if let Some(parts) = parts_opt {
            if !parts.is_empty() {
                text.push_str(&format!("{}: {}\n", labels.participants_title, parts.join(", ")));
            }
        }
        text.push_str("--------------------------------------------------\n\n");

        if let Some(goal) = goal_opt {
            text.push_str(&format!("{}:\n", labels.meeting_goal_title.to_uppercase()));
            text.push_str(&format!("{}\n\n", goal));
        }

        if let Some(highlights) = highlights_opt {
            if !highlights.is_empty() {
                text.push_str(&format!("{}:\n", labels.highlights_title.to_uppercase()));
                for h in highlights {
                    text.push_str(&format!("• {}\n", h));
                }
                text.push_str("\n");
            }
        }

        if let Some(actions) = actions_opt {
            if !actions.is_empty() {
                text.push_str(&format!("{}:\n", labels.action_items_title.to_uppercase()));
                for a in actions {
                    let status = if a.is_completed { "[DONE]" } else { "[PENDING]" };
                    let assignee = a.assignee.as_deref().map(|p| format!(" ({}: {})", labels.assignee_label, p)).unwrap_or_default();
                    text.push_str(&format!("• {} {}{}\n", status, a.task, assignee));
                }
                text.push_str("\n");
            }
        }

        if let Some(phase1) = phase1_opt {
            if !phase1.is_empty() {
                text.push_str(&format!("{}:\n", labels.phase1_title.to_uppercase()));
                for p in phase1 {
                    text.push_str(&format!("• {}\n", p));
                }
                text.push_str("\n");
            }
        }

        if let Some(phase2) = phase2_opt {
            if !phase2.is_empty() {
                text.push_str(&format!("{}:\n", labels.phase2_title.to_uppercase()));
                for p in phase2 {
                    text.push_str(&format!("• {}\n", p));
                }
                text.push_str("\n");
            }
        }

        text.push_str("--------------------------------------------------\n");
        text.push_str(&format!("{}\n", labels.footer_text));
        text
    }
}
