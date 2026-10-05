//! Dev tool: the app's transcript correction (local_llm::correction) on a
//! transcript file ("[id] [mm:ss] Speaker: text" lines); prints what it
//! changed. Usage: correction_check <transcript.txt>
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
    let model = echomind_lib::local_llm::catalog::installed().expect("no local model");
    let t = Instant::now();
    let (_, applied) =
        echomind_lib::local_llm::correction::correct(&segments, model, None, &|_| {})
            .expect("correct");
    for c in &applied {
        println!("[{}] '{}' → '{}'", c.segment_id, c.original, c.corrected);
    }
    eprintln!(
        "{} corrections in {:.1}s",
        applied.len(),
        t.elapsed().as_secs_f32()
    );
    echomind_lib::local_llm::engine::unload();
}
