//! QA helper: import one audio file and print segments to stdout.
fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: qa_print_import <audio-path>");
    let meeting = tauri::async_runtime::block_on(async {
        echomind_lib::importer::import_audio_file(
            path,
            Some("QA print import".into()),
            Some("auto".into()),
            None,
            None,
            None,
        )
        .await
    })
    .expect("import failed");
    println!(
        "ID={} title={} dur={} segs={}",
        meeting.id,
        meeting.title,
        meeting.duration_seconds,
        meeting.segments.len()
    );
    for s in &meeting.segments {
        println!(
            "[{}] {} | lang={} | conf={:.2} | {}",
            s.timestamp_formatted, s.speaker_name, s.language, s.confidence, s.text
        );
    }
}
