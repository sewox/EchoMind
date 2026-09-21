use super::types::SummaryResult;
use crate::storage::MeetingRecord;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

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

/// Safely escapes HTML special characters to prevent Stored XSS attacks in exported reports.
pub fn escape_html(input: &str) -> String {
    let mut escaped = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(c),
        }
    }
    escaped
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
        md.push_str(&format!(
            "# {}: {}\n",
            labels.report_title_prefix, record.title
        ));
        md.push_str(&format!(
            "**{}:** {} • **{}:** {}\n\n",
            labels.date_label,
            record.date_formatted,
            labels.duration_label,
            record.duration_formatted
        ));

        let goal_opt = custom_summary
            .map(|s| &s.meeting_goal)
            .or(record.meeting_goal.as_ref());
        let highlights_opt = custom_summary
            .map(|s| &s.key_highlights)
            .or(record.key_highlights.as_ref());
        let actions_opt = custom_summary
            .map(|s| &s.action_items)
            .or(record.action_items.as_ref());
        let phase1_opt = custom_summary
            .map(|s| &s.phase1_agreed)
            .or(record.phase1_agreed.as_ref());
        let phase2_opt = custom_summary
            .map(|s| &s.phase2_deferred)
            .or(record.phase2_deferred.as_ref());
        let topics_opt = custom_summary
            .map(|s| &s.detailed_topics)
            .or(record.detailed_topics.as_ref());
        let parts_opt = custom_summary
            .map(|s| &s.participants)
            .or(record.participants.as_ref());

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
                md.push('\n');
            }
        }

        // 3. Eylem Maddeleri / Action Items
        if let Some(actions) = actions_opt {
            if !actions.is_empty() {
                md.push_str(&format!("### {}\n", labels.action_items_title));
                for a in actions {
                    let check = if a.is_completed { "[x]" } else { "[ ]" };
                    let clean_ass = a.assignee.as_deref().and_then(|p| {
                        crate::summarizer::local_extractor::LocalSummaryExtractor::clean_assignee(
                            Some(p),
                            &a.task,
                        )
                    });
                    let assignee_str = clean_ass
                        .map(|p| format!(" ➔ **{}**", p))
                        .unwrap_or_default();
                    let cite_str = if !a.source_citations.is_empty() {
                        format!(
                            " ({})",
                            a.source_citations
                                .iter()
                                .map(|c| c.to_string())
                                .collect::<Vec<_>>()
                                .join(", ")
                        )
                    } else {
                        "".to_string()
                    };
                    md.push_str(&format!(
                        "- {} {}{}{}\n",
                        check, a.task, assignee_str, cite_str
                    ));
                }
                md.push('\n');
            }
        }

        // 4. Aşama 1 Mutabakat / Phase 1
        if let Some(phase1) = phase1_opt {
            if !phase1.is_empty() {
                md.push_str(&format!("### {}\n", labels.phase1_title));
                for p in phase1 {
                    md.push_str(&format!("- {}\n", p));
                }
                md.push('\n');
            }
        }

        // 5. Aşama 2 Ertelenenler / Phase 2
        if let Some(phase2) = phase2_opt {
            if !phase2.is_empty() {
                md.push_str(&format!("### {}\n", labels.phase2_title));
                for p in phase2 {
                    md.push_str(&format!("- {}\n", p));
                }
                md.push('\n');
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
                    md.push('\n');
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
            md.push_str(&format!(
                "**[{}] {}**: {}\n",
                seg.timestamp_formatted, seg.speaker_name, seg.text
            ));
        }

        md
    }

    pub fn export_notes_html(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
        lang_code: Option<&str>,
    ) -> String {
        let labels = ReportLabels::for_lang(lang_code);
        let goal_opt = custom_summary
            .map(|s| &s.meeting_goal)
            .or(record.meeting_goal.as_ref());
        let highlights_opt = custom_summary
            .map(|s| &s.key_highlights)
            .or(record.key_highlights.as_ref());
        let actions_opt = custom_summary
            .map(|s| &s.action_items)
            .or(record.action_items.as_ref());
        let phase1_opt = custom_summary
            .map(|s| &s.phase1_agreed)
            .or(record.phase1_agreed.as_ref());
        let phase2_opt = custom_summary
            .map(|s| &s.phase2_deferred)
            .or(record.phase2_deferred.as_ref());
        let topics_opt = custom_summary
            .map(|s| &s.detailed_topics)
            .or(record.detailed_topics.as_ref());
        let parts_opt = custom_summary
            .map(|s| &s.participants)
            .or(record.participants.as_ref());
        let provider_str = custom_summary
            .map(|s| s.provider_used.as_str())
            .or(record.summary_provider.as_deref());

        let mut html = String::new();
        html.push_str(&format!(
            "<!DOCTYPE html>\n<html lang=\"{}\">\n<head>\n",
            labels.html_lang
        ));
        html.push_str("<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n");
        html.push_str(&format!(
            "<title>{} - {}</title>\n",
            labels.report_title_prefix, record.title
        ));
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
        html.push_str(&format!("<h1>{}</h1>\n", escape_html(&record.title)));
        html.push_str("<div class=\"meta-row\">\n");
        html.push_str(&format!(
            "<div class=\"meta-item\">{}: <strong>{}</strong></div>\n",
            labels.date_label,
            escape_html(&record.date_formatted)
        ));
        html.push_str(&format!(
            "<div class=\"meta-item\">{}: <strong>{}</strong></div>\n",
            labels.duration_label,
            escape_html(&record.duration_formatted)
        ));
        if let Some(prov) = provider_str {
            html.push_str(&format!(
                "<div class=\"meta-item\">{}: <strong>{}</strong></div>\n",
                labels.model_label,
                escape_html(prov)
            ));
        }
        html.push_str("</div>\n</div>\n");

        // Goal
        if let Some(goal) = goal_opt {
            html.push_str(&format!(
                "<div class=\"card\">\n<div class=\"card-title\">{}</div>\n",
                labels.meeting_goal_title
            ));
            html.push_str(&format!(
                "<div class=\"goal-text\">{}</div>\n</div>\n",
                escape_html(goal)
            ));
        }

        // Highlights
        if let Some(highlights) = highlights_opt {
            if !highlights.is_empty() {
                html.push_str(&format!("<div class=\"card\">\n<div class=\"card-title\">{}</div>\n<ul class=\"highlight-list\">\n", labels.highlights_title));
                for h in highlights {
                    html.push_str(&format!("<li>{}</li>\n", escape_html(h)));
                }
                html.push_str("</ul>\n</div>\n");
            }
        }

        // Action items
        if let Some(actions) = actions_opt {
            if !actions.is_empty() {
                html.push_str(&format!(
                    "<div class=\"card\">\n<div class=\"card-title\">{}</div>\n",
                    labels.action_items_title
                ));
                for a in actions {
                    let completed_cls = if a.is_completed { " completed" } else { "" };
                    html.push_str(&format!("<div class=\"action-item{}\">\n", completed_cls));
                    html.push_str("<div class=\"checkbox\"></div>\n");
                    html.push_str("<div class=\"action-content\">\n");
                    html.push_str(&format!("<div>{}</div>\n", escape_html(&a.task)));
                    let clean_ass = a.assignee.as_deref().and_then(|p| {
                        crate::summarizer::local_extractor::LocalSummaryExtractor::clean_assignee(
                            Some(p),
                            &a.task,
                        )
                    });
                    if let Some(ref ass) = clean_ass {
                        html.push_str(&format!(
                            "<span class=\"assignee-badge\">{}: {}</span>\n",
                            labels.assignee_label,
                            escape_html(ass)
                        ));
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
                    html.push_str(&format!("<li>{}</li>\n", escape_html(p)));
                }
                html.push_str("</ul>\n</div>\n");
            }
        }

        // Phase 2 Deferred
        if let Some(phase2) = phase2_opt {
            if !phase2.is_empty() {
                html.push_str(&format!("<div class=\"card\">\n<div class=\"card-title\">{}</div>\n<ul class=\"decision-list\">\n", labels.phase2_title));
                for p in phase2 {
                    html.push_str(&format!("<li>{}</li>\n", escape_html(p)));
                }
                html.push_str("</ul>\n</div>\n");
            }
        }

        // Topics
        if let Some(topics) = topics_opt {
            if !topics.is_empty() {
                html.push_str(&format!(
                    "<div class=\"card\">\n<div class=\"card-title\">{}</div>\n",
                    labels.detailed_topics_title
                ));
                for t in topics {
                    html.push_str("<div class=\"topic-card\">\n");
                    html.push_str(&format!("<div class=\"topic-title\">{}</div>\n<ul style=\"padding-left:18px; font-size:13.5px; color:#334155;\">\n", escape_html(&t.topic_title)));
                    for b in &t.bullet_points {
                        html.push_str(&format!(
                            "<li style=\"margin-bottom:6px;\">{}</li>\n",
                            escape_html(b)
                        ));
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
                    html.push_str(&format!(
                        "<span class=\"participant-tag\">{}</span>\n",
                        escape_html(p)
                    ));
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
        let goal_opt = custom_summary
            .map(|s| &s.meeting_goal)
            .or(record.meeting_goal.as_ref());
        let highlights_opt = custom_summary
            .map(|s| &s.key_highlights)
            .or(record.key_highlights.as_ref());
        let actions_opt = custom_summary
            .map(|s| &s.action_items)
            .or(record.action_items.as_ref());
        let phase1_opt = custom_summary
            .map(|s| &s.phase1_agreed)
            .or(record.phase1_agreed.as_ref());
        let phase2_opt = custom_summary
            .map(|s| &s.phase2_deferred)
            .or(record.phase2_deferred.as_ref());
        let parts_opt = custom_summary
            .map(|s| &s.participants)
            .or(record.participants.as_ref());

        let mut text = String::new();
        text.push_str(&format!(
            "📌 {}: {}\n",
            labels.report_title_prefix.to_uppercase(),
            record.title
        ));
        text.push_str(&format!(
            "{}: {} | {}: {}\n",
            labels.date_label,
            record.date_formatted,
            labels.duration_label,
            record.duration_formatted
        ));
        if let Some(parts) = parts_opt {
            if !parts.is_empty() {
                text.push_str(&format!(
                    "{}: {}\n",
                    labels.participants_title,
                    parts.join(", ")
                ));
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
                text.push('\n');
            }
        }

        if let Some(actions) = actions_opt {
            if !actions.is_empty() {
                text.push_str(&format!("{}:\n", labels.action_items_title.to_uppercase()));
                for a in actions {
                    let status = if a.is_completed {
                        "[DONE]"
                    } else {
                        "[PENDING]"
                    };
                    let assignee = a
                        .assignee
                        .as_deref()
                        .map(|p| format!(" ({}: {})", labels.assignee_label, p))
                        .unwrap_or_default();
                    text.push_str(&format!("• {} {}{}\n", status, a.task, assignee));
                }
                text.push('\n');
            }
        }

        if let Some(phase1) = phase1_opt {
            if !phase1.is_empty() {
                text.push_str(&format!("{}:\n", labels.phase1_title.to_uppercase()));
                for p in phase1 {
                    text.push_str(&format!("• {}\n", p));
                }
                text.push('\n');
            }
        }

        if let Some(phase2) = phase2_opt {
            if !phase2.is_empty() {
                text.push_str(&format!("{}:\n", labels.phase2_title.to_uppercase()));
                for p in phase2 {
                    text.push_str(&format!("• {}\n", p));
                }
                text.push('\n');
            }
        }

        text.push_str("--------------------------------------------------\n");
        text.push_str(&format!("{}\n", labels.footer_text));
        text
    }

    pub fn export_notes_slack_markdown(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
        lang_code: Option<&str>,
    ) -> String {
        let labels = ReportLabels::for_lang(lang_code);
        let goal_opt = custom_summary
            .map(|s| &s.meeting_goal)
            .or(record.meeting_goal.as_ref());
        let highlights_opt = custom_summary
            .map(|s| &s.key_highlights)
            .or(record.key_highlights.as_ref());
        let actions_opt = custom_summary
            .map(|s| &s.action_items)
            .or(record.action_items.as_ref());
        let phase1_opt = custom_summary
            .map(|s| &s.phase1_agreed)
            .or(record.phase1_agreed.as_ref());
        let phase2_opt = custom_summary
            .map(|s| &s.phase2_deferred)
            .or(record.phase2_deferred.as_ref());
        let parts_opt = custom_summary
            .map(|s| &s.participants)
            .or(record.participants.as_ref());

        let mut slack = String::new();
        slack.push_str(&format!(
            "*📋 {} — {}*\n",
            labels.report_title_prefix, record.title
        ));
        slack.push_str(&format!(
            "_{}: {} • {}: {}_\n",
            labels.date_label,
            record.date_formatted,
            labels.duration_label,
            record.duration_formatted
        ));

        if let Some(parts) = parts_opt {
            if !parts.is_empty() {
                slack.push_str(&format!(
                    "*{}:* _{}_\n",
                    labels.participants_title,
                    parts.join(", ")
                ));
            }
        }
        slack.push('\n');

        if let Some(goal) = goal_opt {
            slack.push_str(&format!("*{}*\n> {}\n\n", labels.meeting_goal_title, goal));
        }

        if let Some(highlights) = highlights_opt {
            if !highlights.is_empty() {
                slack.push_str(&format!("*{}*\n", labels.highlights_title));
                for h in highlights {
                    slack.push_str(&format!("• {}\n", h));
                }
                slack.push('\n');
            }
        }

        if let Some(actions) = actions_opt {
            if !actions.is_empty() {
                slack.push_str(&format!("*{}*\n", labels.action_items_title));
                for a in actions {
                    let box_emoji = if a.is_completed { "☑️" } else { "◻️" };
                    let assignee = a
                        .assignee
                        .as_deref()
                        .map(|p| format!(" _(@{})_", p))
                        .unwrap_or_default();
                    slack.push_str(&format!("{} *{}*{}\n", box_emoji, a.task, assignee));
                }
                slack.push('\n');
            }
        }

        if let Some(phase1) = phase1_opt {
            if !phase1.is_empty() {
                slack.push_str(&format!("*{}*\n", labels.phase1_title));
                for p in phase1 {
                    slack.push_str(&format!("• {}\n", p));
                }
                slack.push('\n');
            }
        }

        if let Some(phase2) = phase2_opt {
            if !phase2.is_empty() {
                slack.push_str(&format!("*{}*\n", labels.phase2_title));
                for p in phase2 {
                    slack.push_str(&format!("• {}\n", p));
                }
                slack.push('\n');
            }
        }

        slack.push_str("───────────────────────────────────\n");
        slack.push_str(&format!("_{}_\n", labels.footer_text));
        slack
    }

    pub fn export_action_items_csv(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
    ) -> String {
        let actions_opt = custom_summary
            .map(|s| &s.action_items)
            .or(record.action_items.as_ref());
        let mut csv = String::new();
        csv.push_str("\"ID\",\"Task\",\"Assignee\",\"Status\",\"Meeting Title\",\"Date\"\n");

        if let Some(actions) = actions_opt {
            for (idx, a) in actions.iter().enumerate() {
                let status = if a.is_completed { "Done" } else { "To Do" };
                let assignee = a.assignee.as_deref().unwrap_or("Unassigned");
                let clean_task = a.task.replace('"', "\"\"");
                let clean_title = record.title.replace('"', "\"\"");
                csv.push_str(&format!(
                    "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
                    idx + 1,
                    clean_task,
                    assignee,
                    status,
                    clean_title,
                    record.date_formatted
                ));
            }
        }
        csv
    }

    pub fn export_action_items_markdown(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
    ) -> String {
        let actions_opt = custom_summary
            .map(|s| &s.action_items)
            .or(record.action_items.as_ref());
        let mut md = String::new();
        md.push_str(&format!(
            "# ✅ Aksiyon Maddeleri: {} ({})\n\n",
            record.title, record.date_formatted
        ));

        if let Some(actions) = actions_opt {
            for a in actions {
                let check = if a.is_completed { "[x]" } else { "[ ]" };
                let assignee = a
                    .assignee
                    .as_deref()
                    .map(|p| format!(" (@{})", p))
                    .unwrap_or_default();
                md.push_str(&format!("- {} **{}**{}\n", check, a.task, assignee));
            }
        }
        md
    }

    pub fn export_followup_email(
        record: &MeetingRecord,
        custom_summary: Option<&SummaryResult>,
        lang_code: Option<&str>,
    ) -> (String, String) {
        let labels = ReportLabels::for_lang(lang_code);
        let goal_opt = custom_summary
            .map(|s| &s.meeting_goal)
            .or(record.meeting_goal.as_ref());
        let highlights_opt = custom_summary
            .map(|s| &s.key_highlights)
            .or(record.key_highlights.as_ref());
        let actions_opt = custom_summary
            .map(|s| &s.action_items)
            .or(record.action_items.as_ref());
        let phase1_opt = custom_summary
            .map(|s| &s.phase1_agreed)
            .or(record.phase1_agreed.as_ref());

        let code = lang_code.unwrap_or("tr").to_lowercase();
        let prefix = if code.len() >= 2 { &code[..2] } else { "tr" };

        let (subject_prefix, greeting, intro_template, pending_label, done_label, closing, signoff) = match prefix {
            "en" => (
                "Follow-up & Meeting Notes",
                "Hi Team,",
                format!("Thank you for attending our meeting on \"{}\" ({}). Here is the consolidated summary and actionable items:", record.title, record.date_formatted),
                "[PENDING]",
                "[DONE]",
                "Please let me know if you have any questions or additional points to cover.",
                "Best regards,"
            ),
            "de" => (
                "Follow-up & Meeting-Notizen",
                "Hallo Team,",
                format!("Vielen Dank für Ihre Teilnahme am Meeting \"{}\" ({}). Hier ist die Zusammenfassung der wichtigsten Punkte und Aufgaben:", record.title, record.date_formatted),
                "[OFFEN]",
                "[ERLEDIGT]",
                "Bei Fragen oder Ergänzungen stehen wir Ihnen gerne zur Verfügung.",
                "Mit freundlichen Grüßen,"
            ),
            "fr" => (
                "Suivi & Notes de Réunion",
                "Bonjour l'équipe,",
                format!("Merci pour votre participation à la réunion \"{}\" ({}). Voici le compte-rendu consolidé et les actions retenues :", record.title, record.date_formatted),
                "[À FAIRE]",
                "[TERMINÉ]",
                "N'hésitez pas à revenir vers moi pour toute question ou remarque.",
                "Cordialement,"
            ),
            "es" => (
                "Seguimiento y Notas de Reunión",
                "Hola a todos,",
                format!("Gracias por asistir a la reunión \"{}\" ({}). A continuación les comparto el resumen y las tareas asignadas:", record.title, record.date_formatted),
                "[PENDIENTE]",
                "[COMPLETADO]",
                "Quedo a su disposición para cualquier duda o comentario.",
                "Saludos cordiales,"
            ),
            _ => (
                "Takip & Toplantı Notları",
                "Merhaba Ekip,",
                format!("{} tarihinde gerçekleştirdiğimiz \"{}\" konulu toplantımızın özet notları ve belirlenen aksiyon maddeleri aşağıda bilginize sunulmuştur:", record.date_formatted, record.title),
                "[YAPILACAK]",
                "[TAMAMLANDI]",
                "Sorularınız veya eklemek istedikleriniz olursa lütfen iletiniz.",
                "İyi çalışmalar dilerim."
            ),
        };

        let subject = format!(
            "{}: {} ({})",
            subject_prefix, record.title, record.date_formatted
        );

        let mut body = String::new();
        body.push_str(&format!("{}\n\n", greeting));
        body.push_str(&format!("{}\n\n", intro_template));

        if let Some(goal) = goal_opt {
            body.push_str(&format!("📌 {}:\n{}\n\n", labels.meeting_goal_title, goal));
        }

        if let Some(highlights) = highlights_opt {
            if !highlights.is_empty() {
                body.push_str(&format!("💡 {}:\n", labels.highlights_title));
                for h in highlights {
                    body.push_str(&format!("• {}\n", h));
                }
                body.push('\n');
            }
        }

        if let Some(actions) = actions_opt {
            if !actions.is_empty() {
                body.push_str(&format!("🎯 {}:\n", labels.action_items_title));
                for a in actions {
                    let status = if a.is_completed {
                        done_label
                    } else {
                        pending_label
                    };
                    let clean_ass = a.assignee.as_deref().and_then(|p| {
                        crate::summarizer::local_extractor::LocalSummaryExtractor::clean_assignee(
                            Some(p),
                            &a.task,
                        )
                    });
                    let assignee_str = clean_ass
                        .map(|p| format!(" - {}: @{}", labels.assignee_label, p))
                        .unwrap_or_default();
                    body.push_str(&format!("• {} {}{}\n", status, a.task, assignee_str));
                }
                body.push('\n');
            }
        }

        if let Some(phase1) = phase1_opt {
            if !phase1.is_empty() {
                body.push_str(&format!("⚡ {}:\n", labels.phase1_title));
                for p in phase1 {
                    body.push_str(&format!("• {}\n", p));
                }
                body.push('\n');
            }
        }

        body.push_str(&format!("{}\n{}\n\n", closing, signoff));
        body.push_str(&format!("---\n{}\n", labels.footer_text));

        (subject, body)
    }

    /// Formats an ISO 8601 string into standard RFC 5545 UTC timestamp format (YYYYMMDDTHHMMSSZ).
    pub fn format_rfc5545_datetime(input: &str) -> String {
        let trimmed = input.trim();

        // 1. Try parse RFC 3339 / ISO 8601 with timezone (e.g. 2026-09-20T10:00:00+03:00 -> converts to exact UTC)
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(trimmed) {
            return dt
                .with_timezone(&chrono::Utc)
                .format("%Y%m%dT%H%M%SZ")
                .to_string();
        }

        // 2. Try parse NaiveDateTime without timezone (e.g. 2026-09-20T10:00:00 or 2026-09-20 14:30:45)
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S")
            .or_else(|_| chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S"))
        {
            return format!("{}Z", naive.format("%Y%m%dT%H%M%S"));
        }

        // 3. Try parse NaiveDate (e.g. 2026-09-20)
        if let Ok(naive_date) = chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
            return format!("{}T090000Z", naive_date.format("%Y%m%d"));
        }

        // 4. Fallback: extract digits
        let digits: String = trimmed.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.len() >= 14 {
            format!("{}T{}Z", &digits[..8], &digits[8..14])
        } else if digits.len() >= 8 {
            format!("{}T090000Z", &digits[..8])
        } else {
            chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string()
        }
    }

    /// Escapes text values according to RFC 5545 Section 3.3.11.
    pub fn escape_rfc5545_text(input: &str) -> String {
        let mut out = String::with_capacity(input.len() + 16);
        for c in input.chars() {
            match c {
                '\\' => out.push_str("\\\\"),
                ';' => out.push_str("\\;"),
                ',' => out.push_str("\\,"),
                '\n' => out.push_str("\\n"),
                '\r' => {}
                _ => out.push(c),
            }
        }
        out
    }

    /// Generates a standard RFC 5545 iCalendar (.ics) event string for follow-up meetings.
    pub fn export_calendar_ics(
        meeting_title: &str,
        start_datetime_iso: &str,
        duration_minutes: u32,
        description: &str,
        location: Option<&str>,
    ) -> String {
        let dtstart = Self::format_rfc5545_datetime(start_datetime_iso);
        let dtstamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();

        let uid_nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(1000);
        let uid = format!("echomind-{}@ai-assistant.local", uid_nanos);

        let loc = location.unwrap_or("EchoMind AI Meeting Room / Virtual");
        let clean_desc = Self::escape_rfc5545_text(description);
        let clean_summary = Self::escape_rfc5545_text(meeting_title);
        let clean_loc = Self::escape_rfc5545_text(loc);

        format!(
            "BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
PRODID:-//EchoMind AI//EchoMind Assistant v0.2.7//EN\r\n\
CALSCALE:GREGORIAN\r\n\
METHOD:REQUEST\r\n\
BEGIN:VEVENT\r\n\
UID:{uid}\r\n\
DTSTAMP:{dtstamp}\r\n\
DTSTART:{dtstart}\r\n\
DURATION:PT{dur}M\r\n\
SUMMARY:{summary}\r\n\
DESCRIPTION:{desc}\r\n\
LOCATION:{loc}\r\n\
STATUS:CONFIRMED\r\n\
BEGIN:VALARM\r\n\
TRIGGER:-PT15M\r\n\
ACTION:DISPLAY\r\n\
DESCRIPTION:Reminder: {summary}\r\n\
END:VALARM\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n",
            uid = uid,
            dtstamp = dtstamp,
            dtstart = dtstart,
            dur = duration_minutes,
            summary = clean_summary,
            desc = clean_desc,
            loc = clean_loc
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FollowUpBundle {
    pub email_subject: String,
    pub email_body: String,
    pub email_html: String,
    pub mailto_url: String,
    pub action_items_md: String,
    pub action_items_csv: String,
    pub slack_md: String,
    pub ics_content: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_html_xss_protection() {
        let xss_payload = "<script>alert('xss')</script> & \"quotes\" 'single'";
        let escaped = escape_html(xss_payload);
        assert!(!escaped.contains("<script>"));
        assert!(!escaped.contains("</script>"));
        assert!(escaped.contains("&lt;script&gt;"));
        assert!(escaped.contains("&amp;"));
        assert!(escaped.contains("&quot;"));
        assert!(escaped.contains("&#39;"));
    }

    #[test]
    fn test_export_calendar_ics() {
        let ics = MeetingExporter::export_calendar_ics(
            "Sprint Planning Follow-up, Review & Retro",
            "2026-09-20T10:00:00.123456+03:00",
            45,
            "Follow-up discussion on Q4 goals;\nNext steps.",
            Some("Zoom Room, HQ"),
        );
        assert!(ics.contains("BEGIN:VCALENDAR"));
        assert!(ics.contains("SUMMARY:Sprint Planning Follow-up\\, Review & Retro"));
        assert!(ics.contains("DTSTART:20260920T070000Z"));
        assert!(ics.contains("DURATION:PT45M"));
        assert!(ics.contains("LOCATION:Zoom Room\\, HQ"));
        assert!(ics.contains("DESCRIPTION:Follow-up discussion on Q4 goals\\;\\nNext steps."));
        assert!(ics.contains("END:VCALENDAR"));
    }

    #[test]
    fn test_format_rfc5545_datetime() {
        assert_eq!(
            MeetingExporter::format_rfc5545_datetime("2026-09-20T14:30:45Z"),
            "20260920T143045Z"
        );
        assert_eq!(
            MeetingExporter::format_rfc5545_datetime("2026-09-20 14:30:45"),
            "20260920T143045Z"
        );
        assert_eq!(
            MeetingExporter::format_rfc5545_datetime("2026-09-20"),
            "20260920T090000Z"
        );
    }

    #[test]
    fn test_export_notes_markdown_clean_assignee() {
        use crate::storage::ActionItem;

        let action1 = ActionItem {
            task: "Fix pipeline".to_string(),
            assignee: Some("PENDING".to_string()),
            source_citations: Vec::new(),
            is_completed: false,
        };
        let action2 = ActionItem {
            task: "Database migration".to_string(),
            assignee: Some("Sarah Jenkins".to_string()),
            source_citations: Vec::new(),
            is_completed: false,
        };

        let record = MeetingRecord {
            id: "test_wip".to_string(),
            title: "Sync".to_string(),
            date_formatted: "2026-09-20 10:00:00".to_string(),
            duration_seconds: 0,
            duration_formatted: "00:00".to_string(),
            audio_file_path: None,
            segments: Vec::new(),
            summary: String::new(),
            key_decisions: Vec::new(),
            meeting_goal: None,
            key_highlights: None,
            action_items: Some(vec![action1, action2]),
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: None,
            engine_used: None,
            summary_provider: None,
            tags: None,
        };

        let md = MeetingExporter::export_notes_markdown(&record, None, None);
        // "PENDING" is a meaningless placeholder assignee and must be stripped entirely.
        assert!(md.contains("- [ ] Fix pipeline\n"));
        assert!(!md.contains("PENDING"));
        // A real assignee name must still render with the ➔ marker.
        assert!(md.contains("- [ ] Database migration ➔ **Sarah Jenkins**\n"));
    }
}
