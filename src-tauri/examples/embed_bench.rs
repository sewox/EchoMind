//! Speaker-embedding sanity check on a labelled set: mean cosine similarity
//! for same-speaker vs different-speaker turns (dev tool).
use echomind_lib::speaker_embedding::*;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (pcm, _) =
        echomind_lib::importer::decode_audio_file_to_pcm16k(std::path::Path::new(&a[2])).unwrap();
    let gt: Vec<serde_json::Value> =
        serde_json::from_str(&std::fs::read_to_string(&a[3]).unwrap()).unwrap();
    let win: usize = a.get(4).and_then(|v| v.parse().ok()).unwrap_or(150);
    let fb = kaldi_fbank(&pcm, 16000);
    let emb = SpeakerEmbedder::load(std::path::Path::new(&a[1]), win).unwrap();
    let mut e: Vec<(String, Vec<f32>)> = Vec::new();
    for g in &gt {
        let s = (g["start"].as_f64().unwrap() * 100.0) as usize;
        let t = (g["end"].as_f64().unwrap() * 100.0) as usize;
        if t - s < win {
            continue;
        }
        let mid = (s + t) / 2 - win / 2;
        let mut w = fb[mid..mid + win].to_vec();
        mean_normalise(&mut w);
        e.push((
            g["speaker"].as_str().unwrap().to_string(),
            emb.embed(&w).unwrap(),
        ));
    }
    let (mut ss, mut sn, mut ds, mut dn) = (0f32, 0, 0f32, 0);
    let mut dmax = -1f32;
    let mut smin = 2f32;
    for i in 0..e.len() {
        for j in i + 1..e.len() {
            let c = cosine(&e[i].1, &e[j].1);
            if e[i].0 == e[j].0 {
                ss += c;
                sn += 1;
                smin = smin.min(c);
            } else {
                ds += c;
                dn += 1;
                dmax = dmax.max(c);
            }
        }
    }
    println!(
        "turns={} same mean={:.3} min={:.3} | diff mean={:.3} max={:.3}",
        e.len(),
        ss / sn as f32,
        smin,
        ds / dn.max(1) as f32,
        dmax
    );
    // per pair of speakers
    let mut spk: Vec<String> = e.iter().map(|x| x.0.clone()).collect();
    spk.sort();
    spk.dedup();
    for x in &spk {
        for y in &spk {
            if x <= y {
                let v: Vec<f32> = (0..e.len())
                    .flat_map(|i| (i + 1..e.len()).map(move |j| (i, j)))
                    .filter(|&(i, j)| {
                        (e[i].0 == *x && e[j].0 == *y) || (e[i].0 == *y && e[j].0 == *x)
                    })
                    .map(|(i, j)| cosine(&e[i].1, &e[j].1))
                    .collect();
                if !v.is_empty() {
                    print!("{}{}={:.2} ", x, y, v.iter().sum::<f32>() / v.len() as f32);
                }
            }
        }
    }
    println!();
}
