//! Transcribes a file with Apple on-device dictation through the Swift bridge
//! and prints timing, speaker counts (same diarization as the background
//! queue) and the first segments (dev tool, macOS 26+).
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let path = std::path::Path::new(&a[1]);
    let lang = a.get(2).map(String::as_str).unwrap_or("tr");
    let show: usize = a.get(3).and_then(|v| v.parse().ok()).unwrap_or(5);
    println!(
        "available({lang}): {}",
        echomind_lib::offline_engines::apple_dictation_available(lang)
    );
    let t = std::time::Instant::now();
    let pcm = match echomind_lib::importer::decode_audio_file_to_pcm16k(path) {
        Ok((pcm, _)) => pcm,
        Err(e) => return println!("decode error: {e}"),
    };
    match echomind_lib::offline_engines::transcribe_apple_pcm(&pcm, lang) {
        Ok(mut segs) => {
            let words: usize = segs.iter().map(|s| s.text.split_whitespace().count()).sum();
            println!(
                "{} segments, {} words in {:.1}s",
                segs.len(),
                words,
                t.elapsed().as_secs_f32()
            );
            let t = std::time::Instant::now();
            echomind_lib::diarization::cluster_speakers(&mut segs, &pcm, 16000, 6);
            let mut speakers = std::collections::BTreeMap::new();
            for s in &segs {
                *speakers.entry(s.speaker_id.clone()).or_insert(0usize) += 1;
            }
            println!(
                "speakers {:?} in {:.1}s",
                speakers,
                t.elapsed().as_secs_f32()
            );
            for s in segs.iter().take(show) {
                println!("[{}] {}: {}", s.timestamp_formatted, s.speaker_id, s.text);
            }
        }
        Err(e) => println!("error: {e}"),
    }
}
