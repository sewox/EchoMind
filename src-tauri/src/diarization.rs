use crate::transcriber::TranscriptSegment;
use regex::Regex;
use rustfft::{num_complex::Complex32, FftPlanner};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Speaker diarization.
//
// 1. MFCC front end over the whole recording (25 ms frames, 10 ms hop,
//    40 mel filters, 19 cepstra), with an energy VAD and recording-level
//    mean/variance normalisation (removes microphone / room colouring).
// 2. Each transcript segment is modelled as a diagonal Gaussian over the
//    cepstra of its speech frames.
// 3. Greedy agglomerative clustering with the Bayesian Information Criterion:
//    two clusters merge only while one speaker explains them better than two
//    (ΔBIC < 0), so the speaker count comes out of the data and a single
//    speaker is not split. O(n²) ΔBIC evaluations via nearest-neighbour tracking.
// 4. Segments too short for reliable statistics are attached to the nearest
//    speaker; silent ones inherit the previous speaker.
// ---------------------------------------------------------------------------

const FRAME_LEN: usize = 400; // 25 ms @ 16 kHz
const HOP_LEN: usize = 160; // 10 ms
const N_FFT: usize = 512;
const N_MELS: usize = 40;
const N_CEPS: usize = 19; // c1..c19 (c0 = loudness, dropped)

/// Per-frame normalised cepstra for a whole recording plus a speech mask.
pub struct FrameFeatures {
    ceps: Vec<[f32; N_CEPS]>,
    speech: Vec<bool>,
    sample_rate: u32,
}

fn hz_to_mel(f: f32) -> f32 {
    2595.0 * (1.0 + f / 700.0).log10()
}

fn mel_to_hz(m: f32) -> f32 {
    700.0 * (10f32.powf(m / 2595.0) - 1.0)
}

fn mel_filterbank(sample_rate: u32) -> Vec<Vec<(usize, f32)>> {
    let bins = N_FFT / 2 + 1;
    let f_max = (sample_rate as f32 / 2.0).min(7600.0);
    let (m_lo, m_hi) = (hz_to_mel(60.0), hz_to_mel(f_max));
    let pts: Vec<f32> = (0..N_MELS + 2)
        .map(|i| mel_to_hz(m_lo + (m_hi - m_lo) * i as f32 / (N_MELS + 1) as f32))
        .map(|hz| hz * N_FFT as f32 / sample_rate as f32)
        .collect();
    (0..N_MELS)
        .map(|m| {
            let (l, c, r) = (pts[m], pts[m + 1], pts[m + 2]);
            (0..bins)
                .filter_map(|k| {
                    let k_f = k as f32;
                    let w = if k_f > l && k_f <= c {
                        (k_f - l) / (c - l)
                    } else if k_f > c && k_f < r {
                        (r - k_f) / (r - c)
                    } else {
                        0.0
                    };
                    (w > 0.0).then_some((k, w))
                })
                .collect()
        })
        .collect()
}

/// MFCC + energy VAD + recording-level CMVN.
pub fn compute_frame_features(pcm: &[f32], sample_rate: u32) -> FrameFeatures {
    let empty = FrameFeatures {
        ceps: Vec::new(),
        speech: Vec::new(),
        sample_rate,
    };
    if pcm.len() < FRAME_LEN {
        return empty;
    }
    let n_frames = (pcm.len() - FRAME_LEN) / HOP_LEN + 1;
    let window: Vec<f32> = (0..FRAME_LEN)
        .map(|i| {
            0.54 - 0.46 * (2.0 * std::f32::consts::PI * i as f32 / (FRAME_LEN - 1) as f32).cos()
        })
        .collect();
    let fb = mel_filterbank(sample_rate);
    // DCT-II basis for c1..c19.
    let dct: Vec<[f32; N_MELS]> = (1..=N_CEPS)
        .map(|k| {
            let mut row = [0f32; N_MELS];
            for (m, v) in row.iter_mut().enumerate() {
                *v = (std::f32::consts::PI * k as f32 * (m as f32 + 0.5) / N_MELS as f32).cos();
            }
            row
        })
        .collect();

    let fft = FftPlanner::<f32>::new().plan_fft_forward(N_FFT);
    let mut buf = vec![Complex32::new(0.0, 0.0); N_FFT];
    let mut ceps = Vec::with_capacity(n_frames);
    let mut log_energy = Vec::with_capacity(n_frames);

    for f in 0..n_frames {
        let frame = &pcm[f * HOP_LEN..f * HOP_LEN + FRAME_LEN];
        let mut energy = 0f32;
        let mut prev = 0f32;
        for (i, b) in buf.iter_mut().enumerate() {
            if i < FRAME_LEN {
                // pre-emphasis + Hamming
                let x = frame[i] - 0.97 * prev;
                prev = frame[i];
                energy += frame[i] * frame[i];
                *b = Complex32::new(x * window[i], 0.0);
            } else {
                *b = Complex32::new(0.0, 0.0);
            }
        }
        fft.process(&mut buf);
        let mut mel = [0f32; N_MELS];
        for (m, filt) in fb.iter().enumerate() {
            let mut acc = 0f32;
            for &(k, w) in filt {
                acc += w * buf[k].norm_sqr();
            }
            mel[m] = (acc + 1e-10).ln();
        }
        let mut c = [0f32; N_CEPS];
        for (k, row) in dct.iter().enumerate() {
            c[k] = row.iter().zip(mel.iter()).map(|(a, b)| a * b).sum();
        }
        ceps.push(c);
        log_energy.push(10.0 * (energy / FRAME_LEN as f32 + 1e-10).log10());
    }

    // Energy VAD: speech = frames well above the recording's noise floor.
    let mut sorted = log_energy.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let noise_floor = sorted[sorted.len() / 10];
    let loud = sorted[(sorted.len() * 95) / 100];
    let threshold = (noise_floor + 9.0).max(loud - 35.0).max(-60.0);
    let speech: Vec<bool> = log_energy.iter().map(|&e| e > threshold).collect();

    // CMVN over speech frames.
    let mut mean = [0f64; N_CEPS];
    let mut sq = [0f64; N_CEPS];
    let mut n = 0f64;
    for (c, &s) in ceps.iter().zip(&speech) {
        if s {
            for k in 0..N_CEPS {
                mean[k] += c[k] as f64;
                sq[k] += (c[k] as f64).powi(2);
            }
            n += 1.0;
        }
    }
    if n < 2.0 {
        return FrameFeatures {
            ceps,
            speech,
            sample_rate,
        };
    }
    let mut std = [0f64; N_CEPS];
    for k in 0..N_CEPS {
        mean[k] /= n;
        std[k] = (sq[k] / n - mean[k] * mean[k]).max(1e-6).sqrt();
    }
    for c in ceps.iter_mut() {
        for k in 0..N_CEPS {
            c[k] = ((c[k] as f64 - mean[k]) / std[k]) as f32;
        }
    }
    FrameFeatures {
        ceps,
        speech,
        sample_rate,
    }
}

/// Sufficient statistics of a diagonal Gaussian over normalised cepstra.
#[derive(Clone)]
pub struct GaussStats {
    n: f64,
    sum: [f64; N_CEPS],
    sq: [f64; N_CEPS],
}

impl GaussStats {
    fn empty() -> Self {
        Self {
            n: 0.0,
            sum: [0.0; N_CEPS],
            sq: [0.0; N_CEPS],
        }
    }

    fn add(&mut self, o: &GaussStats) {
        self.n += o.n;
        for k in 0..N_CEPS {
            self.sum[k] += o.sum[k];
            self.sq[k] += o.sq[k];
        }
    }

    fn merged(&self, o: &GaussStats) -> GaussStats {
        let mut m = self.clone();
        m.add(o);
        m
    }

    /// log |Σ| for the diagonal covariance.
    fn log_det(&self) -> f64 {
        let n = self.n.max(1.0);
        (0..N_CEPS)
            .map(|k| {
                let mean = self.sum[k] / n;
                (self.sq[k] / n - mean * mean).max(1e-3).ln()
            })
            .sum()
    }
}

/// Speech-frame statistics for `[start_ms, end_ms)` of the recording.
pub fn segment_stats(ff: &FrameFeatures, start_ms: u64, end_ms: u64) -> GaussStats {
    let fps = ff.sample_rate as u64 / HOP_LEN as u64;
    let a = ((start_ms * fps) / 1000) as usize;
    let b = (((end_ms * fps) / 1000) as usize).min(ff.ceps.len());
    let mut st = GaussStats::empty();
    for i in a..b.max(a) {
        if ff.speech[i] {
            for k in 0..N_CEPS {
                let v = ff.ceps[i][k] as f64;
                st.sum[k] += v;
                st.sq[k] += v * v;
            }
            st.n += 1.0;
        }
    }
    st
}

/// Segments with fewer speech frames than this (~1 s) don't seed a BIC
/// cluster; they're attached to the nearest speaker afterwards.
const MIN_TURN_SPEECH: usize = 100;

/// Adjacent 10 ms frames are strongly correlated; BIC treats every sample as
/// independent, so frame counts are divided by this to get an effective count.
const FRAME_DECORRELATION: f64 = 4.0;
/// BIC model-complexity weight. Higher → fewer speakers. Calibrated with
/// `examples/diarization_eval.rs` (single-speaker, 2–4 speaker, noisy sets).
pub const BIC_LAMBDA: f64 = 2.0;

/// ΔBIC for modelling `a` and `b` with one Gaussian instead of two.
/// Negative ⇒ the two are better explained as the same speaker.
fn delta_bic(a: &GaussStats, b: &GaussStats) -> f64 {
    let (lambda, decorr) = (BIC_LAMBDA, FRAME_DECORRELATION);
    let m = a.merged(b);
    let (na, nb, nm) = (a.n / decorr, b.n / decorr, m.n / decorr);
    let gain = 0.5 * (nm * m.log_det() - na * a.log_det() - nb * b.log_det());
    let params = 2.0 * N_CEPS as f64; // diagonal mean + variance
    gain - lambda * 0.5 * params * nm.max(2.0).ln()
}

/// Greedy BIC agglomerative clustering: repeatedly merge the pair with the
/// lowest ΔBIC while it is negative (then only as needed to respect `max_k`).
/// Returns a cluster index per input.
pub fn bic_cluster(items: &[GaussStats], max_k: usize) -> Vec<usize> {
    let n = items.len();
    if n <= 1 {
        return vec![0; n];
    }
    let mut stats: Vec<GaussStats> = items.to_vec();
    let mut alive = vec![true; n];
    let mut parent: Vec<usize> = (0..n).collect();
    let nearest = |i: usize, stats: &[GaussStats], alive: &[bool]| -> (usize, f64) {
        let mut best = (usize::MAX, f64::MAX);
        for j in 0..n {
            if j != i && alive[j] {
                let d = delta_bic(&stats[i], &stats[j]);
                if d < best.1 {
                    best = (j, d);
                }
            }
        }
        best
    };
    let mut nn: Vec<(usize, f64)> = (0..n).map(|i| nearest(i, &stats, &alive)).collect();
    let mut clusters = n;
    while clusters > 1 {
        let (i, &(j, d)) = nn
            .iter()
            .enumerate()
            .filter(|(i, _)| alive[*i])
            .min_by(|a, b| {
                a.1 .1
                    .partial_cmp(&b.1 .1)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap();
        if j == usize::MAX || (d >= 0.0 && clusters <= max_k) {
            break;
        }
        let sj = stats[j].clone();
        stats[i].add(&sj);
        alive[j] = false;
        for p in parent.iter_mut() {
            if *p == j {
                *p = i;
            }
        }
        clusters -= 1;
        for k in 0..n {
            if alive[k] && (k == i || nn[k].0 == i || nn[k].0 == j) {
                nn[k] = nearest(k, &stats, &alive);
            } else if alive[k] {
                let dk = delta_bic(&stats[k], &stats[i]);
                if dk < nn[k].1 {
                    nn[k] = (i, dk);
                }
            }
        }
    }
    parent
}

/// Fallback when the neural model is unavailable: one diagonal Gaussian per
/// ASR segment, BIC-clustered; short segments join the closest speaker model
/// and silent ones inherit the previous speaker.
fn cluster_by_segments(segments: &mut [TranscriptSegment], ff: &FrameFeatures, max_k: usize) {
    let stats: Vec<GaussStats> = segments
        .iter()
        .map(|s| segment_stats(ff, s.start_time_ms, s.end_time_ms))
        .collect();
    let seeds: Vec<usize> = (0..segments.len())
        .filter(|&i| stats[i].n as usize >= MIN_TURN_SPEECH)
        .collect();
    let mut labels = vec![usize::MAX; segments.len()];
    if !seeds.is_empty() {
        let items: Vec<GaussStats> = seeds.iter().map(|&i| stats[i].clone()).collect();
        let raw = bic_cluster(&items, max_k);
        let mut models: HashMap<usize, GaussStats> = HashMap::new();
        for (k, &i) in seeds.iter().enumerate() {
            labels[i] = raw[k];
            models
                .entry(raw[k])
                .or_insert_with(GaussStats::empty)
                .add(&items[k]);
        }
        for i in 0..segments.len() {
            if labels[i] == usize::MAX && stats[i].n > 0.0 {
                labels[i] = *models
                    .iter()
                    .min_by(|a, b| {
                        delta_bic(a.1, &stats[i])
                            .partial_cmp(&delta_bic(b.1, &stats[i]))
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .unwrap()
                    .0;
            }
        }
    }
    let mut last = labels
        .iter()
        .copied()
        .find(|&l| l != usize::MAX)
        .unwrap_or(0);
    let mut remap: HashMap<usize, usize> = HashMap::new();
    for (seg, l) in segments.iter_mut().zip(labels) {
        if l != usize::MAX {
            last = l;
        }
        let next = remap.len() + 1;
        let n = *remap.entry(last).or_insert(next);
        seg.speaker_id = format!("Konuşmacı {}", n);
        seg.speaker_name = format!("Konuşmacı {}", n);
    }
}

// ---------------------------------------------------------------------------
// Neural path: CAM++ speaker embeddings on sliding windows + cosine AHC.
// ---------------------------------------------------------------------------

/// 1.5 s embedding window, 0.75 s hop (in 10 ms frames).
const NN_WIN: usize = 150;
const NN_HOP: usize = 75;
/// Cosine distance at which clusters stop merging. Calibrated with
/// `examples/diarization_eval.rs`: results are identical across 0.20–0.35 on
/// labelled 1- and 4-voice sets (clean, noisy, multi-speaker segments) and on
/// a real two-person meeting, so 0.30 sits mid-plateau.
pub const NN_MERGE_THRESHOLD: f32 = 0.30;

/// Path of the speaker model to use, if one is available.
fn neural_model_path() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("ECHOMIND_SPEAKER_MODEL") {
        let p = std::path::PathBuf::from(p);
        return p.exists().then_some(p);
    }
    let p = crate::speaker_embedding::model_path();
    p.exists().then_some(p)
}

/// Per-frame speaker label (10 ms frames) from neural embeddings, or `None`
/// when the model is unavailable or fails.
fn neural_frame_labels(pcm: &[f32], speech: &[bool], max_k: usize) -> Option<Vec<Option<usize>>> {
    use crate::speaker_embedding as se;
    let model_path = neural_model_path()?;
    let fbank = se::kaldi_fbank(pcm, 16000);
    let n = fbank.len().min(speech.len());
    if n < NN_WIN {
        return None;
    }
    // Windows with at least half speech.
    let starts: Vec<usize> = (0..=(n - NN_WIN))
        .step_by(NN_HOP)
        .filter(|&s| speech[s..s + NN_WIN].iter().filter(|&&v| v).count() * 2 >= NN_WIN)
        .collect();
    if starts.len() < 2 {
        return None;
    }

    // Embed in parallel; each thread owns a runnable plan.
    let threads = std::thread::available_parallelism()
        .map(|v| v.get())
        .unwrap_or(4)
        .clamp(1, 8);
    let chunk = starts.len().div_ceil(threads);
    let embs: Vec<Vec<f32>> = std::thread::scope(|scope| {
        let handles: Vec<_> = starts
            .chunks(chunk)
            .map(|part| {
                let fb = &fbank;
                let mp = &model_path;
                scope.spawn(move || -> Result<Vec<Vec<f32>>, String> {
                    let emb = se::SpeakerEmbedder::load(mp, NN_WIN)?;
                    part.iter()
                        .map(|&s| {
                            let mut w = fb[s..s + NN_WIN].to_vec();
                            se::mean_normalise(&mut w);
                            emb.embed(&w)
                        })
                        .collect()
                })
            })
            .collect();
        let mut all = Vec::with_capacity(starts.len());
        for h in handles {
            match h.join() {
                Ok(Ok(v)) => all.extend(v),
                Ok(Err(e)) => {
                    eprintln!("⚠️ speaker embedding failed: {e}");
                    return Vec::new();
                }
                Err(_) => return Vec::new(),
            }
        }
        all
    });
    if embs.len() != starts.len() {
        return None;
    }

    let labels = cosine_ahc(&embs, NN_MERGE_THRESHOLD, max_k);

    // Frame labels: majority vote of the windows covering each frame.
    let mut votes: Vec<HashMap<usize, u16>> = vec![HashMap::new(); n];
    for (k, &s) in starts.iter().enumerate() {
        for v in &mut votes[s..s + NN_WIN] {
            *v.entry(labels[k]).or_default() += 1;
        }
    }
    Some(
        votes
            .into_iter()
            .map(|v| {
                v.into_iter()
                    .max_by_key(|&(c, n)| (n, usize::MAX - c))
                    .map(|(c, _)| c)
            })
            .collect(),
    )
}

/// Average-linkage AHC on unit vectors with a cosine-distance stop threshold
/// (then merging further only to respect `max_k`). Clusters holding < 2% of
/// the windows are folded into their nearest large cluster.
fn cosine_ahc(embs: &[Vec<f32>], threshold: f32, max_k: usize) -> Vec<usize> {
    use crate::speaker_embedding::cosine;
    let n = embs.len();
    let mut dist = vec![0f32; n * n];
    for i in 0..n {
        for j in (i + 1)..n {
            let d = 1.0 - cosine(&embs[i], &embs[j]);
            dist[i * n + j] = d;
            dist[j * n + i] = d;
        }
    }
    let mut size = vec![1usize; n];
    let mut alive = vec![true; n];
    let mut parent: Vec<usize> = (0..n).collect();
    let nearest = |i: usize, dist: &[f32], alive: &[bool]| -> (usize, f32) {
        let mut best = (usize::MAX, f32::MAX);
        for j in 0..n {
            if j != i && alive[j] && dist[i * n + j] < best.1 {
                best = (j, dist[i * n + j]);
            }
        }
        best
    };
    let mut nn: Vec<(usize, f32)> = (0..n).map(|i| nearest(i, &dist, &alive)).collect();
    let mut clusters = n;
    while clusters > 1 {
        let (i, &(j, d)) = nn
            .iter()
            .enumerate()
            .filter(|(i, _)| alive[*i])
            .min_by(|a, b| {
                a.1 .1
                    .partial_cmp(&b.1 .1)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap();
        if j == usize::MAX || (d > threshold && clusters <= max_k) {
            break;
        }
        let (si, sj) = (size[i] as f32, size[j] as f32);
        for k in 0..n {
            if alive[k] && k != i && k != j {
                let nd = (si * dist[i * n + k] + sj * dist[j * n + k]) / (si + sj);
                dist[i * n + k] = nd;
                dist[k * n + i] = nd;
            }
        }
        size[i] += size[j];
        alive[j] = false;
        for p in parent.iter_mut() {
            if *p == j {
                *p = i;
            }
        }
        clusters -= 1;
        for k in 0..n {
            if !alive[k] {
                continue;
            }
            if k == i || nn[k].0 == i || nn[k].0 == j {
                nn[k] = nearest(k, &dist, &alive);
            } else if dist[k * n + i] < nn[k].1 {
                nn[k] = (i, dist[k * n + i]);
            }
        }
    }

    // Fold tiny clusters (stray windows: coughs, crosstalk, noise).
    let mut counts: HashMap<usize, usize> = HashMap::new();
    for &p in &parent {
        *counts.entry(p).or_default() += 1;
    }
    let min_size = (n / 50).max(2);
    let big: Vec<usize> = counts
        .iter()
        .filter(|(_, &c)| c >= min_size)
        .map(|(&k, _)| k)
        .collect();
    if !big.is_empty() && big.len() < counts.len() {
        let centroid = |c: usize| -> Vec<f32> {
            let mut acc = vec![0f32; embs[0].len()];
            for (k, &p) in parent.iter().enumerate() {
                if p == c {
                    acc.iter_mut().zip(&embs[k]).for_each(|(a, b)| *a += b);
                }
            }
            let norm = acc.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
            acc.iter_mut().for_each(|x| *x /= norm);
            acc
        };
        let cents: Vec<(usize, Vec<f32>)> = big.iter().map(|&c| (c, centroid(c))).collect();
        for k in 0..n {
            if !big.contains(&parent[k]) {
                parent[k] = cents
                    .iter()
                    .max_by(|a, b| {
                        cosine(&embs[k], &a.1)
                            .partial_cmp(&cosine(&embs[k], &b.1))
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .unwrap()
                    .0;
            }
        }
    }
    dissolve_between_clusters(embs, &mut parent);
    if std::env::var_os("ECHOMIND_DIAR_DEBUG").is_some() {
        debug_print_clusters(embs, &parent);
    }
    parent
}

/// A cluster lying *between* two others is not a person: it collects windows
/// where two voices mix (crosstalk), or where one speaker sounds different
/// (moved away from the mic, remote audio heard through the room). It is
/// "between" a and b when it is closer to each of them than they are to each
/// other and d(a,x) + d(x,b) < BETWEEN_RATIO · d(a,b). Such clusters are
/// dissolved one at a time: each window moves to the nearest other centroid.
///
/// Calibrated with examples/diarization_eval.rs: on a real two-person meeting
/// the mixed cluster scores 0.83 (0.14 + 0.20 vs 0.41); distinct voices in
/// the labelled sets score ≥ 1.11.
const BETWEEN_RATIO: f32 = 1.1;

fn dissolve_between_clusters(embs: &[Vec<f32>], parent: &mut [usize]) {
    use crate::speaker_embedding::cosine;
    loop {
        let mut ids: Vec<usize> = parent.to_vec();
        ids.sort_unstable();
        ids.dedup();
        if ids.len() < 3 {
            return;
        }
        let cents: Vec<Vec<f32>> = ids
            .iter()
            .map(|&c| cluster_centroid(embs, parent, c))
            .collect();
        let d = |i: usize, j: usize| 1.0 - cosine(&cents[i], &cents[j]);

        // Most clearly "between" cluster, if any.
        let mut worst: Option<(usize, f32)> = None;
        for x in 0..ids.len() {
            for a in 0..ids.len() {
                for b in (a + 1)..ids.len() {
                    if a == x || b == x {
                        continue;
                    }
                    let (dax, dxb, dab) = (d(a, x), d(x, b), d(a, b));
                    if dax.max(dxb) >= dab || dab <= 0.0 {
                        continue;
                    }
                    let ratio = (dax + dxb) / dab;
                    if ratio < BETWEEN_RATIO && worst.is_none_or(|(_, r)| ratio < r) {
                        worst = Some((x, ratio));
                    }
                }
            }
        }
        let Some((x, _)) = worst else {
            return;
        };
        let gone = ids[x];
        for k in 0..parent.len() {
            if parent[k] == gone {
                parent[k] = ids
                    .iter()
                    .zip(&cents)
                    .filter(|(&c, _)| c != gone)
                    .max_by(|a, b| {
                        cosine(&embs[k], a.1)
                            .partial_cmp(&cosine(&embs[k], b.1))
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .map(|(&c, _)| c)
                    .unwrap_or(gone);
            }
        }
    }
}

/// Unit-length mean embedding of cluster `c`.
fn cluster_centroid(embs: &[Vec<f32>], parent: &[usize], c: usize) -> Vec<f32> {
    let mut acc = vec![0f32; embs[0].len()];
    for (k, &p) in parent.iter().enumerate() {
        if p == c {
            acc.iter_mut().zip(&embs[k]).for_each(|(a, b)| *a += b);
        }
    }
    let norm = acc.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
    acc.iter_mut().for_each(|x| *x /= norm);
    acc
}

/// Cluster sizes and centroid cosine distances (calibration aid).
fn debug_print_clusters(embs: &[Vec<f32>], parent: &[usize]) {
    use crate::speaker_embedding::cosine;
    let mut ids: Vec<usize> = parent.to_vec();
    ids.sort_unstable();
    ids.dedup();
    let cents: Vec<Vec<f32>> = ids
        .iter()
        .map(|&c| cluster_centroid(embs, parent, c))
        .collect();
    for (i, &c) in ids.iter().enumerate() {
        let size = parent.iter().filter(|&&p| p == c).count();
        let dists: Vec<String> = (0..ids.len())
            .map(|j| format!("{:.2}", 1.0 - cosine(&cents[i], &cents[j])))
            .collect();
        eprintln!(
            "DIAR cluster {i}: {size} windows, centroid dist [{}]",
            dists.join(", ")
        );
    }
}

/// Each segment gets the speaker holding most of its speech frames; segments
/// with no labelled speech inherit the previous speaker.
fn label_segments_by_frames(
    segments: &mut [TranscriptSegment],
    frame_labels: &[Option<usize>],
    speech: &[bool],
    fps: u64,
) {
    let mut last: Option<usize> = frame_labels.iter().flatten().next().copied();
    let mut remap: HashMap<usize, usize> = HashMap::new();
    for seg in segments.iter_mut() {
        let a = ((seg.start_time_ms * fps) / 1000) as usize;
        let b = (((seg.end_time_ms * fps) / 1000) as usize).min(frame_labels.len());
        let mut votes: HashMap<usize, usize> = HashMap::new();
        for (f, label) in frame_labels.iter().enumerate().take(b.max(a)).skip(a) {
            if speech.get(f).copied().unwrap_or(false) {
                if let Some(c) = label {
                    *votes.entry(*c).or_default() += 1;
                }
            }
        }
        if let Some((c, _)) = votes.into_iter().max_by_key(|&(c, n)| (n, usize::MAX - c)) {
            last = Some(c);
        }
        let c = last.unwrap_or(0);
        let next = remap.len() + 1;
        let n = *remap.entry(c).or_insert(next);
        seg.speaker_id = format!("Konuşmacı {}", n);
        seg.speaker_name = format!("Konuşmacı {}", n);
    }
}

/// Assigns `Konuşmacı N` labels to `segments` from the audio in `full_pcm`
/// (segment times are relative to the start of `full_pcm`).
///
/// Uses neural speaker embeddings when the model is available (each segment
/// gets the speaker holding most of its speech, so segments that span two
/// speakers don't form clusters of their own); otherwise MFCC + BIC per segment.
pub fn cluster_speakers(
    segments: &mut [TranscriptSegment],
    full_pcm: &[f32],
    sample_rate: u32,
    max_speakers: usize,
) {
    if segments.is_empty() {
        return;
    }
    let max_k = max_speakers.clamp(1, 8);
    let ff = compute_frame_features(full_pcm, sample_rate);
    // `ECHOMIND_DIAR_MODE=bic` forces the fallback (evaluation tooling).
    if std::env::var("ECHOMIND_DIAR_MODE").as_deref() != Ok("bic") && sample_rate == 16000 {
        if let Some(frame_labels) = neural_frame_labels(full_pcm, &ff.speech, max_k) {
            let fps = (sample_rate as u64 / HOP_LEN as u64).max(1);
            label_segments_by_frames(segments, &frame_labels, &ff.speech, fps);
            return;
        }
    }
    cluster_by_segments(segments, &ff, max_k);
}

/// Local-user label when the microphone channel dominates a segment.
pub const LOCAL_SPEAKER_LABEL: &str = "Siz";

fn peak_normalize(samples: &[f32]) -> Vec<f32> {
    let peak = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
    if peak < 1e-8 {
        return samples.to_vec();
    }
    samples.iter().map(|s| s / peak).collect()
}

fn window_rms(pcm: &[f32], start: usize, end: usize) -> f32 {
    if start >= pcm.len() || start >= end {
        return 0.0;
    }
    let end = end.min(pcm.len());
    let slice = &pcm[start..end];
    if slice.is_empty() {
        return 0.0;
    }
    (slice.iter().map(|s| s * s).sum::<f32>() / slice.len() as f32).sqrt()
}

/// Pearson correlation over a window — used to detect speaker→mic bleed of
/// remote audio (echo). Returns 0 when either side is silent.
fn window_correlation(a: &[f32], b: &[f32], start: usize, end: usize) -> f32 {
    if start >= end {
        return 0.0;
    }
    let end = end.min(a.len()).min(b.len());
    if start >= end {
        return 0.0;
    }
    let n = (end - start) as f32;
    let mut mean_a = 0.0f32;
    let mut mean_b = 0.0f32;
    for i in start..end {
        mean_a += a[i];
        mean_b += b[i];
    }
    mean_a /= n;
    mean_b /= n;
    let mut num = 0.0f32;
    let mut den_a = 0.0f32;
    let mut den_b = 0.0f32;
    for i in start..end {
        let da = a[i] - mean_a;
        let db = b[i] - mean_b;
        num += da * db;
        den_a += da * da;
        den_b += db * db;
    }
    let den = (den_a * den_b).sqrt();
    if den < 1e-12 {
        0.0
    } else {
        (num / den).clamp(-1.0, 1.0)
    }
}

fn samples_for_ms(ms: u64, sample_rate: u32) -> usize {
    ((ms * sample_rate as u64) / 1000) as usize
}

/// Channel-based speaker assignment when both microphone and system audio were
/// captured. Mic-dominant segments → "Siz"; system-dominant segments are
/// diarized on the system track alone (remote people). Each channel is
/// peak-normalized before comparison; correlated mic energy during remote
/// speech is treated as echo/bleed and discounted.
///
/// When only a mixed mono track exists, callers keep using [`cluster_speakers`].
pub fn attribute_speakers_by_channel(
    segments: &mut [TranscriptSegment],
    mic: &[f32],
    system: &[f32],
    sample_rate: u32,
) {
    if segments.is_empty() {
        return;
    }
    let mic_n = peak_normalize(mic);
    let sys_n = peak_normalize(system);

    let mut remote_indices: Vec<usize> = Vec::new();
    for (i, seg) in segments.iter_mut().enumerate() {
        let start = samples_for_ms(seg.start_time_ms, sample_rate);
        let end = samples_for_ms(seg.end_time_ms, sample_rate).max(start + 1);
        let mut mic_e = window_rms(&mic_n, start, end);
        let sys_e = window_rms(&sys_n, start, end);

        // Speakers playing remote audio into the mic: mic correlates with
        // system. Discount the correlated portion so dominance is not flipped.
        let corr = window_correlation(&mic_n, &sys_n, start, end).abs();
        if sys_e > 0.02 && corr > 0.35 {
            mic_e = (mic_e - sys_e * corr * corr * 0.85).max(0.0);
        }

        const DOMINANCE: f32 = 1.25;
        if mic_e > sys_e * DOMINANCE && mic_e > 0.015 {
            seg.speaker_id = LOCAL_SPEAKER_LABEL.to_string();
            seg.speaker_name = LOCAL_SPEAKER_LABEL.to_string();
        } else {
            remote_indices.push(i);
        }
    }

    if remote_indices.is_empty() {
        return;
    }

    // Diarize only the remote side on the system channel.
    let mut remote_segs: Vec<TranscriptSegment> = remote_indices
        .iter()
        .map(|&i| segments[i].clone())
        .collect();
    cluster_speakers(&mut remote_segs, system, sample_rate, 6);
    resolve_speaker_names(&mut remote_segs);
    for (k, &i) in remote_indices.iter().enumerate() {
        segments[i].speaker_id = remote_segs[k].speaker_id.clone();
        segments[i].speaker_name = remote_segs[k].speaker_name.clone();
    }
}

/// Automatically extract speaker names from English & Turkish self-introductions, vocatives, and turn-taking dialogues
pub fn resolve_speaker_names(segments: &mut [TranscriptSegment]) {
    if segments.is_empty() {
        return;
    }

    // Multi-lingual Regex Patterns (English & Turkish)
    let tr_intro_regex =
        Regex::new(r"(?i)\b(benim adım|benim ismim|adım|ismim)\s+([A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,})\b")
            .unwrap();
    let en_intro_regex = Regex::new(r"(?i)\b(my name is|i am|i'm)\s+([A-Z][a-z]{2,})\b").unwrap();
    let en_this_is_regex =
        Regex::new(r"(?i)\b(this is)\s+([A-Z][a-z]{2,})\s+(speaking|here|from|calling)\b").unwrap();

    let tr_vocative_regex =
        Regex::new(r"\b([A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,})\s+(Bey|Hanım|Hocam)\b").unwrap();
    let en_vocative_regex = Regex::new(
        r"(?i)\b(hey|thanks|thank you|go ahead|over to you|what do you think)\s+([A-Z][a-z]{2,})\b",
    )
    .unwrap();
    let en_title_regex = Regex::new(r"\b(Mr\.|Dr\.|Ms\.|Mrs\.)\s+([A-Z][a-z]{2,})\b").unwrap();

    let mut speaker_names: HashMap<String, String> = HashMap::new();

    for i in 0..segments.len() {
        let text = &segments[i].text;
        let speaker_id = &segments[i].speaker_id;

        // 1. English & Turkish Self-Introductions
        if let Some(caps) = tr_intro_regex.captures(text) {
            if let Some(m) = caps.get(2) {
                let name = capitalize_first(m.as_str());
                if !is_stopword(&name) {
                    speaker_names.insert(speaker_id.clone(), name);
                }
            }
        } else if let Some(caps) = en_intro_regex.captures(text) {
            if let Some(m) = caps.get(2) {
                let name = capitalize_first(m.as_str());
                if !is_stopword(&name) {
                    speaker_names.insert(speaker_id.clone(), name);
                }
            }
        } else if let Some(caps) = en_this_is_regex.captures(text) {
            if let Some(m) = caps.get(2) {
                let name = capitalize_first(m.as_str());
                if !is_stopword(&name) {
                    speaker_names.insert(speaker_id.clone(), name);
                }
            }
        }

        // 2. Turkish Direct Vocatives ("Sercan Bey", "Şeyma Hanım")
        if let Some(caps) = tr_vocative_regex.captures(text) {
            let lower = text.to_lowercase();
            let is_3rd_person = lower.contains("görüştük")
                || lower.contains("konuştuk")
                || lower.contains("dedi")
                || lower.contains("ile");
            if !is_3rd_person {
                if let Some(name_match) = caps.get(1) {
                    let honorific = caps.get(2).map(|m| m.as_str()).unwrap_or("Bey");
                    let name = format!("{} {}", capitalize_first(name_match.as_str()), honorific);
                    if i + 1 < segments.len() {
                        let next_spk = &segments[i + 1].speaker_id;
                        if next_spk != speaker_id && !speaker_names.contains_key(next_spk) {
                            speaker_names.insert(next_spk.clone(), name);
                        }
                    }
                }
            }
        }

        // 3. English Turn-Taking & Vocatives ("Thanks Sarah", "Hey David", "Go ahead Alex")
        if let Some(caps) = en_vocative_regex.captures(text) {
            if let Some(name_match) = caps.get(2) {
                let name = capitalize_first(name_match.as_str());
                if !is_stopword(&name) && i + 1 < segments.len() {
                    let next_spk = &segments[i + 1].speaker_id;
                    if next_spk != speaker_id && !speaker_names.contains_key(next_spk) {
                        speaker_names.insert(next_spk.clone(), name);
                    }
                }
            }
        }

        // 4. English Titles ("Dr. Watson", "Mr. Smith")
        if let Some(caps) = en_title_regex.captures(text) {
            if let (Some(title), Some(name_match)) = (caps.get(1), caps.get(2)) {
                let full = format!(
                    "{} {}",
                    title.as_str(),
                    capitalize_first(name_match.as_str())
                );
                if i + 1 < segments.len() {
                    let next_spk = &segments[i + 1].speaker_id;
                    if next_spk != speaker_id && !speaker_names.contains_key(next_spk) {
                        speaker_names.insert(next_spk.clone(), full);
                    }
                }
            }
        }
    }

    // Apply discovered names
    for seg in segments.iter_mut() {
        if let Some(name) = speaker_names.get(&seg.speaker_id) {
            seg.speaker_name = name.clone();
        }
    }
}

/// Helper to capitalize words properly across Turkish & English alphabets
fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => {
            let upper = match first {
                'i' => 'İ',
                'ı' => 'I',
                'ç' => 'Ç',
                'ğ' => 'Ğ',
                'ö' => 'Ö',
                'ş' => 'Ş',
                'ü' => 'Ü',
                c => c.to_uppercase().next().unwrap_or(c),
            };
            format!("{}{}", upper, chars.as_str())
        }
    }
}

/// Multi-lingual stopword filter (reject common conversational interjections, pronouns, verbs, auxiliaries)
fn is_stopword(s: &str) -> bool {
    let lower = s.to_lowercase();
    let stopwords = [
        // Turkish
        "evet",
        "hayır",
        "tamam",
        "peki",
        "yani",
        "olur",
        "çünkü",
        "bence",
        "zaten",
        "artık",
        "tabii",
        "tabi",
        "öyle",
        "böyle",
        "şöyle",
        "nasıl",
        "neden",
        "niçin",
        "nerede",
        "kim",
        "bir",
        "iki",
        "üç",
        "dört",
        "beş",
        "on",
        "yüz",
        "bin",
        "lütfen",
        "merhaba",
        "selam",
        "burada",
        "şurada",
        "orada",
        "şimdi",
        "sonra",
        "önce",
        "kadar",
        "gibi",
        "ile",
        "için",
        "fakat",
        "lakin",
        "ancak",
        "çünkü",
        "veya",
        "yahut",
        "belki",
        "kesinlikle",
        "aslında",
        // English
        "yes",
        "no",
        "not",
        "okay",
        "ok",
        "right",
        "sure",
        "well",
        "hello",
        "hi",
        "hey",
        "thanks",
        "thank",
        "good",
        "great",
        "now",
        "here",
        "there",
        "today",
        "yesterday",
        "tomorrow",
        "everyone",
        "all",
        "guys",
        "folks",
        "team",
        "people",
        "morning",
        "afternoon",
        "evening",
        "also",
        "just",
        "this",
        "that",
        "these",
        "those",
        "what",
        "where",
        "when",
        "why",
        "how",
        "who",
        "which",
        "have",
        "having",
        "had",
        "has",
        "been",
        "being",
        "will",
        "would",
        "shall",
        "should",
        "can",
        "could",
        "may",
        "might",
        "must",
        "done",
        "doing",
        "does",
        "think",
        "thinking",
        "thought",
        "going",
        "trying",
        "saying",
        "said",
        "tell",
        "telling",
        "told",
        "really",
        "very",
        "much",
        "more",
        "most",
        "some",
        "any",
        "other",
        "another",
        "such",
        "only",
        "own",
        "same",
        "so",
        "than",
        "too",
        "very",
        "just",
        "about",
        "above",
        "after",
        "again",
        "against",
        "because",
        "before",
        "below",
        "between",
        "both",
        "during",
        "each",
        "few",
        "from",
        "further",
        "into",
        "through",
        "under",
        "until",
        "while",
        "with",
        "without",
        "able",
        "unable",
        "happy",
        "sorry",
    ];
    stopwords.contains(&lower.as_str()) || lower.len() < 3
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: usize, start_ms: u64, end_ms: u64) -> TranscriptSegment {
        TranscriptSegment {
            id,
            speaker_id: String::new(),
            speaker_name: String::new(),
            start_time_ms: start_ms,
            end_time_ms: end_ms,
            timestamp_formatted: String::new(),
            text: "x".into(),
            language: "tr".into(),
            confidence: 1.0,
        }
    }

    /// A buzzy "voice": harmonics of `f0` with a spectral tilt, plus a little noise.
    fn voice(f0: f32, tilt: f32, secs: f32, seed: u32) -> Vec<f32> {
        let n = (secs * 16000.0) as usize;
        let mut rng = seed;
        (0..n)
            .map(|i| {
                let t = i as f32 / 16000.0;
                let mut v = 0.0;
                for h in 1..=12 {
                    v += (2.0 * std::f32::consts::PI * f0 * h as f32 * t).sin()
                        / (h as f32).powf(tilt);
                }
                rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
                v * 0.08 + ((rng >> 8) as f32 / (1u32 << 24) as f32 - 0.5) * 0.004
            })
            .collect()
    }

    fn unit(v: Vec<f32>) -> Vec<f32> {
        let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        v.into_iter().map(|x| x / n).collect()
    }

    #[test]
    fn test_old_bug_all_voices_one_speaker_is_fixed_in_fallback() {
        // Regression: the old features were time-slice energies, so every voice
        // looked the same and everything became "Konuşmacı 1".
        std::env::set_var("ECHOMIND_DIAR_MODE", "bic");
        let a = voice(110.0, 0.6, 3.0, 1);
        let b = voice(230.0, 1.6, 3.0, 2);
        let gap = vec![0.0f32; 8000];
        let mut pcm = Vec::new();
        let mut segs = Vec::new();
        let mut t = 0u64;
        for i in 0..8 {
            let v = if i % 2 == 0 { &a } else { &b };
            segs.push(seg(i + 1, t, t + 3000));
            pcm.extend_from_slice(v);
            pcm.extend_from_slice(&gap);
            t += 3500;
        }
        cluster_speakers(&mut segs, &pcm, 16000, 6);
        std::env::remove_var("ECHOMIND_DIAR_MODE");
        let ids: std::collections::HashSet<_> = segs.iter().map(|s| s.speaker_id.clone()).collect();
        assert_eq!(
            ids.len(),
            2,
            "two distinct voices must give two speakers: {:?}",
            segs.iter().map(|s| &s.speaker_id).collect::<Vec<_>>()
        );
        for i in 0..8 {
            assert_eq!(segs[i].speaker_id, segs[i % 2].speaker_id);
        }
    }

    #[test]
    fn test_fallback_does_not_split_a_single_voice() {
        std::env::set_var("ECHOMIND_DIAR_MODE", "bic");
        let mut pcm = Vec::new();
        let mut segs = Vec::new();
        for i in 0..8u64 {
            segs.push(seg(i as usize + 1, i * 3500, i * 3500 + 3000));
            pcm.extend(voice(140.0, 1.0, 3.0, i as u32 + 7));
            pcm.extend(vec![0.0f32; 8000]);
        }
        cluster_speakers(&mut segs, &pcm, 16000, 6);
        std::env::remove_var("ECHOMIND_DIAR_MODE");
        assert!(segs.iter().all(|s| s.speaker_id == "Konuşmacı 1"));
    }

    #[test]
    fn test_cosine_ahc_groups_and_folds_strays() {
        let mk = |base: usize, jitter: f32| {
            unit(
                (0..8)
                    .map(|d| {
                        if d == base {
                            1.0
                        } else {
                            jitter * ((d * 7 + base) % 5) as f32 * 0.1
                        }
                    })
                    .collect(),
            )
        };
        let mut embs = Vec::new();
        for i in 0..30 {
            embs.push(mk(i % 3, 0.3 + (i % 4) as f32 * 0.05));
        }
        embs.push(unit(vec![0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0])); // single stray
        let labels = cosine_ahc(&embs, 0.30, 6);
        let groups: std::collections::HashSet<_> = labels.iter().copied().collect();
        assert_eq!(
            groups.len(),
            3,
            "stray window must fold into a real speaker"
        );
        for i in 0..30 {
            assert_eq!(labels[i], labels[i % 3]);
        }
        // One tight group stays one speaker.
        let same: Vec<Vec<f32>> = (0..20)
            .map(|i| mk(0, 0.2 + (i % 3) as f32 * 0.05))
            .collect();
        assert!(cosine_ahc(&same, 0.30, 6)
            .iter()
            .all(|&l| l == cosine_ahc(&same, 0.30, 6)[0]));
    }

    #[test]
    fn test_segment_label_is_majority_of_its_speech() {
        // 100 fps; frames 0..300 speaker 0, 300..500 speaker 1.
        let mut labels = vec![Some(0usize); 300];
        labels.extend(vec![Some(1usize); 200]);
        let speech = vec![true; 500];
        // seg 2 spans both speakers: 0.5 s of A, 1 s of B → B.
        let mut segs = vec![
            seg(1, 0, 2000),
            seg(2, 2500, 4000),
            seg(3, 4000, 5000),
            seg(4, 5000, 5200),
        ];
        label_segments_by_frames(&mut segs, &labels, &speech, 100);
        assert_eq!(segs[0].speaker_id, "Konuşmacı 1");
        assert_eq!(
            segs[1].speaker_id, "Konuşmacı 2",
            "mixed segment goes to its majority speaker"
        );
        assert_eq!(segs[2].speaker_id, "Konuşmacı 2");
        assert_eq!(
            segs[3].speaker_id, "Konuşmacı 2",
            "segment past the audio inherits the previous speaker"
        );
    }

    #[test]
    fn test_kaldi_fbank_shape_and_values() {
        let pcm = voice(150.0, 1.0, 1.0, 3);
        let fb = crate::speaker_embedding::kaldi_fbank(&pcm, 16000);
        assert_eq!(fb.len(), 1 + (16000 - 400) / 160);
        assert!(fb.iter().flatten().all(|v| v.is_finite()));
        let mut w = fb[..50].to_vec();
        crate::speaker_embedding::mean_normalise(&mut w);
        for b in 0..crate::speaker_embedding::N_BINS {
            let m: f32 = w.iter().map(|r| r[b]).sum::<f32>() / 50.0;
            assert!(m.abs() < 1e-3);
        }
    }

    /// Neural diarization on a real labelled recording. Runs only when given:
    /// `ECHOMIND_SPEAKER_MODEL=model.onnx ECHOMIND_DIAR_WAV=dialogue.wav
    ///  ECHOMIND_DIAR_GT=gt.json cargo test --release -- --ignored neural`
    /// (gt.json: `[{"start": s, "end": s, "speaker": "A"}, ...]`).
    #[test]
    #[ignore]
    fn test_neural_matches_labelled_recording() {
        let wav = std::env::var("ECHOMIND_DIAR_WAV").expect("ECHOMIND_DIAR_WAV");
        let gt: Vec<serde_json::Value> = serde_json::from_str(
            &std::fs::read_to_string(std::env::var("ECHOMIND_DIAR_GT").expect("ECHOMIND_DIAR_GT"))
                .unwrap(),
        )
        .unwrap();
        let (pcm, _) =
            crate::importer::decode_audio_file_to_pcm16k(std::path::Path::new(&wav)).unwrap();
        let mut segs: Vec<TranscriptSegment> = gt
            .iter()
            .enumerate()
            .map(|(i, g)| {
                seg(
                    i + 1,
                    (g["start"].as_f64().unwrap() * 1000.0) as u64,
                    (g["end"].as_f64().unwrap() * 1000.0) as u64,
                )
            })
            .collect();
        cluster_speakers(&mut segs, &pcm, 16000, 6);
        // Purity: each predicted speaker should map to one true speaker.
        let mut by_pred: HashMap<String, HashMap<String, usize>> = HashMap::new();
        for (s, g) in segs.iter().zip(&gt) {
            *by_pred
                .entry(s.speaker_id.clone())
                .or_default()
                .entry(g["speaker"].as_str().unwrap().to_string())
                .or_default() += 1;
        }
        let pure: usize = by_pred.values().map(|m| *m.values().max().unwrap()).sum();
        let truth: std::collections::HashSet<_> =
            gt.iter().map(|g| g["speaker"].as_str().unwrap()).collect();
        assert!(
            pure * 100 >= segs.len() * 95,
            "purity {}/{}",
            pure,
            segs.len()
        );
        assert!(
            by_pred.len() <= truth.len() + 1,
            "{} speakers for {} voices",
            by_pred.len(),
            truth.len()
        );
    }

    #[test]
    fn test_resolve_speaker_names_english() {
        let mut segments = vec![
            TranscriptSegment {
                id: 1,
                speaker_id: "Konuşmacı 1".to_string(),
                speaker_name: "Konuşmacı 1".to_string(),
                start_time_ms: 0,
                end_time_ms: 2000,
                timestamp_formatted: "00:00 -> 00:02".to_string(),
                text: "My name is John, welcome everyone.".to_string(),
                language: "en".to_string(),
                confidence: 0.98,
            },
            TranscriptSegment {
                id: 2,
                speaker_id: "Konuşmacı 1".to_string(),
                speaker_name: "Konuşmacı 1".to_string(),
                start_time_ms: 2100,
                end_time_ms: 4000,
                timestamp_formatted: "00:02 -> 00:04".to_string(),
                text: "Hey Sarah, could you present the quarterly slides?".to_string(),
                language: "en".to_string(),
                confidence: 0.98,
            },
            TranscriptSegment {
                id: 3,
                speaker_id: "Konuşmacı 2".to_string(),
                speaker_name: "Konuşmacı 2".to_string(),
                start_time_ms: 4200,
                end_time_ms: 6000,
                timestamp_formatted: "00:04 -> 00:06".to_string(),
                text: "Sure John, let me share my screen.".to_string(),
                language: "en".to_string(),
                confidence: 0.98,
            },
        ];

        resolve_speaker_names(&mut segments);
        assert_eq!(segments[0].speaker_name, "John");
        assert_eq!(segments[1].speaker_name, "John");
        assert_eq!(segments[2].speaker_name, "Sarah");
    }

    #[test]
    fn test_resolve_speaker_names_from_addressing() {
        let mut segments = vec![
            TranscriptSegment {
                id: 1,
                speaker_id: "Konuşmacı 1".to_string(),
                speaker_name: "Konuşmacı 1".to_string(),
                start_time_ms: 0,
                end_time_ms: 3000,
                timestamp_formatted: "00:00 -> 00:03".to_string(),
                text: "Ramazan Bey bu projenin teslim tarihi ne zaman?".to_string(),
                language: "tr".to_string(),
                confidence: 0.95,
            },
            TranscriptSegment {
                id: 2,
                speaker_id: "Konuşmacı 2".to_string(),
                speaker_name: "Konuşmacı 2".to_string(),
                start_time_ms: 3100,
                end_time_ms: 6000,
                timestamp_formatted: "00:03 -> 00:06".to_string(),
                text: "Gelecek hafta Cuma günü teslim edeceğiz.".to_string(),
                language: "tr".to_string(),
                confidence: 0.98,
            },
        ];

        resolve_speaker_names(&mut segments);
        assert_eq!(segments[1].speaker_name, "Ramazan Bey");
    }

    #[test]
    fn test_reject_3rd_person_mention() {
        let mut segments = vec![
            TranscriptSegment {
                id: 1,
                speaker_id: "Konuşmacı 1".to_string(),
                speaker_name: "Konuşmacı 1".to_string(),
                start_time_ms: 0,
                end_time_ms: 3000,
                timestamp_formatted: "00:00 -> 00:03".to_string(),
                text: "Dün Serkan Bey ile görüştük ve bütçeyi onaylattık.".to_string(),
                language: "tr".to_string(),
                confidence: 0.95,
            },
            TranscriptSegment {
                id: 2,
                speaker_id: "Konuşmacı 2".to_string(),
                speaker_name: "Konuşmacı 2".to_string(),
                start_time_ms: 3100,
                end_time_ms: 6000,
                timestamp_formatted: "00:03 -> 00:06".to_string(),
                text: "Çok güzel, şimdi geliştirmeye başlayabiliriz.".to_string(),
                language: "tr".to_string(),
                confidence: 0.98,
            },
        ];

        resolve_speaker_names(&mut segments);
        assert_ne!(segments[1].speaker_name, "Serkan Bey");
        assert_eq!(segments[1].speaker_name, "Konuşmacı 2");
    }

    fn tone(freq: f32, rate: u32, start_ms: u64, end_ms: u64, amp: f32) -> Vec<f32> {
        let n = (rate as u64 * end_ms / 1000) as usize;
        let start = (rate as u64 * start_ms / 1000) as usize;
        let end = (rate as u64 * end_ms / 1000) as usize;
        let mut v = vec![0.0f32; n];
        for (i, s) in v.iter_mut().enumerate().take(end).skip(start) {
            *s = amp * (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin();
        }
        v
    }

    fn seg_text(start_ms: u64, end_ms: u64, text: &str) -> TranscriptSegment {
        let mut s = seg(1, start_ms, end_ms);
        s.text = text.to_string();
        s
    }

    #[test]
    fn test_attribute_mic_dominant_labelled_siz() {
        // Mic speaks 0–1s; system silent. Force BIC so the remote path (if any)
        // stays deterministic without needing the neural model.
        std::env::set_var("ECHOMIND_DIAR_MODE", "bic");
        let mic = tone(220.0, 16000, 0, 1000, 0.5);
        let sys = vec![0.0f32; mic.len()];
        let mut segs = vec![seg_text(0, 900, "Merhaba ekip")];
        attribute_speakers_by_channel(&mut segs, &mic, &sys, 16000);
        assert_eq!(segs[0].speaker_id, LOCAL_SPEAKER_LABEL);
        assert_eq!(segs[0].speaker_name, LOCAL_SPEAKER_LABEL);
        std::env::remove_var("ECHOMIND_DIAR_MODE");
    }

    #[test]
    fn test_attribute_sys_dominant_not_siz() {
        std::env::set_var("ECHOMIND_DIAR_MODE", "bic");
        let sys = tone(440.0, 16000, 0, 1000, 0.5);
        let mic = vec![0.0f32; sys.len()];
        let mut segs = vec![seg_text(0, 900, "Hello from remote")];
        attribute_speakers_by_channel(&mut segs, &mic, &sys, 16000);
        assert_ne!(segs[0].speaker_id, LOCAL_SPEAKER_LABEL);
        assert!(segs[0].speaker_id.starts_with("Konuşmacı"));
        std::env::remove_var("ECHOMIND_DIAR_MODE");
    }

    #[test]
    fn test_attribute_echo_bleed_does_not_mislabel_remote_as_siz() {
        // Remote speech on system, plus a quieter correlated copy on the mic
        // (speaker bleed). Must still attribute to the remote side.
        std::env::set_var("ECHOMIND_DIAR_MODE", "bic");
        let sys = tone(330.0, 16000, 0, 1200, 0.6);
        let mic: Vec<f32> = sys.iter().map(|&s| s * 0.35).collect();
        let mut segs = vec![seg_text(0, 1100, "Remote with bleed")];
        attribute_speakers_by_channel(&mut segs, &mic, &sys, 16000);
        assert_ne!(
            segs[0].speaker_id, LOCAL_SPEAKER_LABEL,
            "bleed into mic must not flip dominance to Siz"
        );
        std::env::remove_var("ECHOMIND_DIAR_MODE");
    }

    #[test]
    fn test_attribute_alternating_channels() {
        std::env::set_var("ECHOMIND_DIAR_MODE", "bic");
        let mut mic = tone(200.0, 16000, 0, 1000, 0.5);
        let mut sys = vec![0.0f32; mic.len()];
        // Second second: remote only.
        let remote = tone(500.0, 16000, 1000, 2000, 0.5);
        mic.resize(remote.len(), 0.0);
        sys.resize(remote.len(), 0.0);
        for i in 16000..remote.len() {
            sys[i] = remote[i];
        }
        let mut segs = vec![
            seg_text(0, 900, "Ben buradayım"),
            seg_text(1100, 1900, "And I am remote"),
        ];
        attribute_speakers_by_channel(&mut segs, &mic, &sys, 16000);
        assert_eq!(segs[0].speaker_name, LOCAL_SPEAKER_LABEL);
        assert_ne!(segs[1].speaker_name, LOCAL_SPEAKER_LABEL);
        std::env::remove_var("ECHOMIND_DIAR_MODE");
    }

    /// `n` unit vectors near `dir` (small deterministic jitter).
    fn embedding_cloud(dir: &[f32], n: usize) -> Vec<Vec<f32>> {
        (0..n)
            .map(|k| {
                let mut v: Vec<f32> = dir
                    .iter()
                    .enumerate()
                    .map(|(i, x)| x + 0.02 * (((k * 7 + i * 13) % 11) as f32 - 5.0) / 5.0)
                    .collect();
                let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
                v.iter_mut().for_each(|x| *x /= norm);
                v
            })
            .collect()
    }

    fn mix(a: &[f32], b: &[f32]) -> Vec<f32> {
        a.iter().zip(b).map(|(x, y)| x + y).collect()
    }

    #[test]
    fn test_cluster_between_two_voices_is_dissolved() {
        let a = [1.0, 0.0, 0.0, 0.0];
        let b = [0.0, 1.0, 0.0, 0.0];
        let between = mix(&a, &b);
        let mut embs = embedding_cloud(&a, 10);
        embs.extend(embedding_cloud(&b, 10));
        embs.extend(embedding_cloud(&between, 6));
        let mut parent: Vec<usize> = (0..26)
            .map(|k| {
                if k < 10 {
                    0
                } else if k < 20 {
                    1
                } else {
                    2
                }
            })
            .collect();
        dissolve_between_clusters(&embs, &mut parent);
        let mut ids = parent.clone();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(
            ids,
            vec![0, 1],
            "mixed cluster must fold into the two voices"
        );
        assert!(parent[..10].iter().all(|&p| p == 0));
        assert!(parent[10..20].iter().all(|&p| p == 1));
    }

    #[test]
    fn test_distinct_voices_are_kept() {
        let dirs = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];
        let mut embs = Vec::new();
        let mut parent = Vec::new();
        for (c, d) in dirs.iter().enumerate() {
            embs.extend(embedding_cloud(d, 8));
            parent.extend(std::iter::repeat_n(c, 8));
        }
        let before = parent.clone();
        dissolve_between_clusters(&embs, &mut parent);
        assert_eq!(parent, before);
    }
}
