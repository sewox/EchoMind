//! Dev tool: transcribes a two-channel recording (mic left, system right)
//! the way the queue does: echo removed, each track on its own, merged.
//!
//! cargo run --release --example dual_track_check -- <recording> <apple|whisper> <out.txt>
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (input, engine, output) = (std::path::Path::new(&a[1]), a[2].as_str(), &a[3]);
    let mut channels =
        echomind_lib::importer::decode_audio_file_channels_16k(input).expect("decode");
    println!(
        "echo: {:?} ms",
        echomind_lib::echo::clean_channels(&mut channels)
    );
    let [mic, system] = channels.as_slice() else {
        panic!("needs two channels (mic, system)");
    };
    if engine == "whisper" {
        echomind_lib::transcriber::switch_transcription_model("small".into()).expect("whisper");
    }
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let silence = if engine == "whisper" {
        echomind_lib::dual_track::Silence::Remove
    } else {
        echomind_lib::dual_track::Silence::Keep
    };
    let segs = echomind_lib::dual_track::transcribe(mic, system, silence, |track| {
        let mut track = track.to_vec();
        echomind_lib::audio::normalize_audio_samples(&mut track);
        if engine == "whisper" {
            echomind_lib::transcriber::get_global_transcriber()
                .transcribe_pcm_batch(&track, "tr", &cancel)
        } else {
            let mut segs = echomind_lib::offline_engines::transcribe_apple_pcm(&track, "auto")?;
            echomind_lib::diarization::cluster_speakers(&mut segs, &track, 16000, 6);
            Ok(segs)
        }
    })
    .expect("transcribe");
    let lines: Vec<String> = segs
        .iter()
        .map(|s| {
            format!(
                "[{}] [{}] {}: {}",
                s.id,
                s.timestamp_formatted,
                s.speaker_name,
                s.text.trim()
            )
        })
        .collect();
    std::fs::write(output, lines.join("\n") + "\n").expect("write");
    println!("{} segments", lines.len());
    if engine == "whisper" {
        echomind_lib::transcriber::unload_transcription_model();
    }
}
