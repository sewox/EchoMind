//! Dev tool: removes the echo from a two-channel recording (mic left,
//! system right) and writes the cleaned mic, the aligned system track and
//! their mix as 16 kHz WAV files.
//!
//! cargo run --release --example echo_check -- <recording> <out dir>
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (input, out) = (std::path::Path::new(&a[1]), std::path::Path::new(&a[2]));
    let channels = echomind_lib::importer::decode_audio_file_channels_16k(input).expect("decode");
    let [mic, system] = channels.as_slice() else {
        panic!("needs two channels (mic, system)");
    };
    let t = std::time::Instant::now();
    let cleaned = echomind_lib::echo::remove_echo(mic, system);
    let secs = mic.len() as f32 / 16000.0;
    let took = t.elapsed().as_secs_f32();
    println!(
        "lag {:?} ms, {:.0}s of audio in {:.1}s (rtf {:.3})",
        cleaned.lag_ms,
        secs,
        took,
        took / secs
    );
    let write = |name: &str, x: &[f32]| {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(out.join(name), spec).expect("wav");
        for &s in x {
            w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16)
                .unwrap();
        }
        w.finalize().unwrap();
    };
    write("rust_mic.wav", &cleaned.mic);
    write("rust_system.wav", &cleaned.system);
    let mix: Vec<f32> = cleaned
        .mic
        .iter()
        .zip(&cleaned.system)
        .map(|(m, s)| (m + s).clamp(-1.0, 1.0))
        .collect();
    write("rust_mix.wav", &mix);
}
