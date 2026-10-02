//! Dev tool: Whisper Small through the app's transcriber on a window of a recording.
//! Usage: whisper_baseline <audio> <start_s> <len_s>
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (start, len): (usize, usize) = (a[2].parse().unwrap(), a[3].parse().unwrap());
    echomind_lib::transcriber::switch_transcription_model("small".into()).expect("whisper load");
    let (pcm, _) =
        echomind_lib::importer::decode_audio_file_to_pcm16k(std::path::Path::new(&a[1])).unwrap();
    let end = ((start + len) * 16000).min(pcm.len());
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let segs = echomind_lib::transcriber::get_global_transcriber()
        .transcribe_pcm_batch(&pcm[start * 16000..end], "tr", &cancel)
        .expect("transcribe");
    for s in segs {
        eprintln!("SEG {}: {}", s.timestamp_formatted, s.text);
    }

    // Free the Whisper context before exit: ggml-metal asserts if GPU
    // resources are still alive when its static destructors run (the app does
    // this in its quit handler).
    echomind_lib::transcriber::unload_transcription_model();
}
