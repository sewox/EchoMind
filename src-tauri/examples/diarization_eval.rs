//! Diarization evaluation harness.
//!
//! Labelled mode (accuracy against ground truth):
//!   diarization_eval <audio> <ground_truth.json>
//!   ground_truth.json: [{"start": 0.5, "end": 3.1, "speaker": "A"}, ...]
//!
//! Unlabelled mode (how many speakers are found, and how segments split):
//!   diarization_eval <audio> --segments <segments.tsv> [labels_out.tsv]
//!   segments.tsv: "<start_seconds>\t<end_seconds>" per line
//!
//! Runs `diarization::cluster_speakers` on the given segment boundaries only
//! (no ASR), so it measures speaker separation in isolation.
use echomind_lib::transcriber::TranscriptSegment;
use std::collections::HashMap;

fn seg(id: usize, start: f64, end: f64) -> TranscriptSegment {
    TranscriptSegment {
        id,
        speaker_id: String::new(),
        speaker_name: String::new(),
        start_time_ms: (start * 1000.0) as u64,
        end_time_ms: (end * 1000.0) as u64,
        timestamp_formatted: String::new(),
        text: String::new(),
        language: "auto".into(),
        confidence: 1.0,
    }
}

fn permutations(n: usize) -> Vec<Vec<usize>> {
    if n == 0 {
        return vec![vec![]];
    }
    let mut out = Vec::new();
    for p in permutations(n - 1) {
        for i in 0..=p.len() {
            let mut q = p.clone();
            q.insert(i, n - 1);
            out.push(q);
        }
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let audio = args
        .get(1)
        .expect("usage: diarization_eval <audio> <gt.json | --segments tsv>");
    let (pcm, _) = echomind_lib::importer::decode_audio_file_to_pcm16k(std::path::Path::new(audio))
        .expect("decode failed");

    if args.get(2).map(String::as_str) == Some("--segments") {
        let tsv = std::fs::read_to_string(&args[3]).expect("read tsv");
        let mut segs: Vec<TranscriptSegment> = tsv
            .lines()
            .filter_map(|l| {
                let mut it = l.split('\t');
                Some((
                    it.next()?.parse::<f64>().ok()?,
                    it.next()?.parse::<f64>().ok()?,
                ))
            })
            .enumerate()
            .map(|(i, (s, e))| seg(i + 1, s, e))
            .collect();
        let t = std::time::Instant::now();
        echomind_lib::diarization::cluster_speakers(&mut segs, &pcm, 16000, 6);
        let mut dur: HashMap<String, f64> = HashMap::new();
        let mut cnt: HashMap<String, usize> = HashMap::new();
        for s in &segs {
            *dur.entry(s.speaker_id.clone()).or_default() +=
                (s.end_time_ms - s.start_time_ms) as f64 / 1000.0;
            *cnt.entry(s.speaker_id.clone()).or_default() += 1;
        }
        let mut keys: Vec<_> = dur.keys().cloned().collect();
        keys.sort();
        println!(
            "segments={} clusters={} ({:.1}s)",
            segs.len(),
            keys.len(),
            t.elapsed().as_secs_f32()
        );
        for k in keys {
            println!("  {:<14} segments={:<5} speech={:.0}s", k, cnt[&k], dur[&k]);
        }
        let changes = segs
            .windows(2)
            .filter(|w| w[0].speaker_id != w[1].speaker_id)
            .count();
        println!(
            "  speaker changes between consecutive segments: {}",
            changes
        );
        if let Some(out) = args.get(4) {
            let lines: Vec<String> = segs
                .iter()
                .map(|s| {
                    format!(
                        "{}\t{}\t{}",
                        s.start_time_ms / 1000,
                        s.end_time_ms / 1000,
                        s.speaker_id
                    )
                })
                .collect();
            std::fs::write(out, lines.join("\n")).expect("write labels");
        }
        return;
    }

    let gt: Vec<serde_json::Value> =
        serde_json::from_str(&std::fs::read_to_string(&args[2]).expect("read gt"))
            .expect("gt json");
    let mut segs: Vec<TranscriptSegment> = gt
        .iter()
        .enumerate()
        .map(|(i, g)| {
            seg(
                i + 1,
                g["start"].as_f64().unwrap(),
                g["end"].as_f64().unwrap(),
            )
        })
        .collect();
    let truth: Vec<String> = gt
        .iter()
        .map(|g| g["speaker"].as_str().unwrap().to_string())
        .collect();

    let t = std::time::Instant::now();
    echomind_lib::diarization::cluster_speakers(&mut segs, &pcm, 16000, 6);
    let elapsed = t.elapsed();

    let mut true_ids: Vec<String> = truth.clone();
    true_ids.sort();
    true_ids.dedup();
    let mut pred_ids: Vec<String> = segs.iter().map(|s| s.speaker_id.clone()).collect();
    pred_ids.sort();
    pred_ids.dedup();

    // Best one-to-one mapping predicted → true (brute force; ≤ 8 labels).
    let n = true_ids.len().max(pred_ids.len());
    let mut best = 0usize;
    for perm in permutations(n) {
        let correct = segs
            .iter()
            .zip(&truth)
            .filter(|(s, t)| {
                let pi = pred_ids.iter().position(|p| *p == s.speaker_id).unwrap();
                perm[pi] < true_ids.len() && true_ids[perm[pi]] == **t
            })
            .count();
        best = best.max(correct);
    }

    println!(
        "true speakers={} predicted={} accuracy={}/{} ({:.0}%) in {:.2}s",
        true_ids.len(),
        pred_ids.len(),
        best,
        segs.len(),
        100.0 * best as f64 / segs.len() as f64,
        elapsed.as_secs_f32()
    );
    let mut conf: HashMap<(String, String), usize> = HashMap::new();
    for (s, t) in segs.iter().zip(&truth) {
        *conf.entry((t.clone(), s.speaker_id.clone())).or_default() += 1;
    }
    for t in &true_ids {
        let row: Vec<String> = pred_ids
            .iter()
            .map(|p| {
                format!(
                    "{}={}",
                    p.replace("Konuşmacı ", "S"),
                    conf.get(&(t.clone(), p.clone())).unwrap_or(&0)
                )
            })
            .collect();
        println!("  true {:<3} -> {}", t, row.join("  "));
    }
}
