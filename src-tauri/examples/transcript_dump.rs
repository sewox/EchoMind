//! Dev tool: transcribes a recording with Apple dictation + speaker
//! clustering and writes "[id] [mm:ss] Speaker: text" lines (one per segment)
//! to the output file, for offline LLM evaluation (macOS 26+).
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (input, output) = (std::path::Path::new(&a[1]), &a[2]);
    let (pcm, _) = echomind_lib::importer::decode_audio_file_to_pcm16k(input).expect("decode");
    let mut segs =
        echomind_lib::offline_engines::transcribe_apple_pcm(&pcm, "auto").expect("dictation");
    echomind_lib::diarization::cluster_speakers(&mut segs, &pcm, 16000, 6);
    let lines: Vec<String> = segs
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let t = s.start_time_ms / 1000;
            format!("[{}] [{:02}:{:02}] {}: {}", i + 1, t / 60, t % 60, s.speaker_name, s.text.trim())
        })
        .collect();
    std::fs::write(output, lines.join("\n") + "\n").expect("write");
    println!("{} segments", lines.len());
}
