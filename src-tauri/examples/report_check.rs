//! Dev tool: the app's on-device report (local_llm::report) on a transcript
//! file with "[id] [mm:ss] Speaker: text" lines (see examples/transcript_dump).
//! Usage: report_check <transcript.txt> <out.json>
use echomind_lib::transcriber::TranscriptSegment;
use std::time::Instant;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let text = std::fs::read_to_string(&a[1]).expect("transcript");
    let segments: Vec<TranscriptSegment> = text
        .lines()
        .filter_map(|l| {
            let (id, rest) = l.strip_prefix('[')?.split_once("] ")?;
            let rest = rest.split_once("] ").map(|(_, r)| r).unwrap_or(rest);
            let (speaker, body) = rest.split_once(": ")?;
            Some(TranscriptSegment {
                id: id.parse().ok()?,
                speaker_id: speaker.into(),
                speaker_name: speaker.into(),
                start_time_ms: 0,
                end_time_ms: 0,
                timestamp_formatted: String::new(),
                text: body.into(),
                language: "tr".into(),
                confidence: 1.0,
            })
        })
        .collect();
    let model = echomind_lib::local_llm::catalog::installed().expect("no local model installed");
    let t = Instant::now();
    let result = echomind_lib::local_llm::report::generate(&segments, model, None, None, None, &|_| {});
    let secs = t.elapsed().as_secs_f32();
    match result {
        Ok(r) => {
            eprintln!(
                "OK {secs:.1}s: {} decisions, {} tasks, {} topics, {} highlights",
                r.key_decisions.len(),
                r.action_items.len(),
                r.detailed_topics.len(),
                r.key_highlights.len()
            );
            std::fs::write(&a[2], serde_json::to_string_pretty(&r).unwrap()).unwrap();
        }
        Err(e) => eprintln!("ERR {secs:.1}s: {e}"),
    }
    echomind_lib::local_llm::engine::unload();
}
