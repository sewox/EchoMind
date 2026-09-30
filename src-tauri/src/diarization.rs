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

    fn mean(&self) -> [f64; N_CEPS] {
        let n = self.n.max(1.0);
        let mut m = [0.0; N_CEPS];
        for k in 0..N_CEPS {
            m[k] = self.sum[k] / n;
        }
        m
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

/// Adjacent 10 ms frames are strongly correlated; BIC treats every sample as
/// independent, so frame counts are divided by this to get an effective count.
const FRAME_DECORRELATION: f64 = 4.0;
/// BIC model-complexity weight. Higher → fewer speakers. Calibrated with
/// `examples/diarization_eval.rs` (single-speaker, 2–4 speaker, noisy sets).
pub const BIC_LAMBDA: f64 = 2.0;

/// ΔBIC for modelling `a` and `b` with one Gaussian instead of two.
/// Negative ⇒ the two are better explained as the same speaker.
fn tuning() -> (f64, f64) {
    static T: std::sync::OnceLock<(f64, f64)> = std::sync::OnceLock::new();
    *T.get_or_init(|| {
        let l = std::env::var("ECHOMIND_BIC_LAMBDA")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(BIC_LAMBDA);
        let d = std::env::var("ECHOMIND_BIC_DECORR")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(FRAME_DECORRELATION);
        (l, d)
    })
}

fn delta_bic(a: &GaussStats, b: &GaussStats) -> f64 {
    delta_bic_with(a, b, tuning().0)
}

fn delta_bic_with(a: &GaussStats, b: &GaussStats, lambda: f64) -> f64 {
    let decorr = tuning().1;
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

/// Diarization works on the recording itself, not on ASR segments: ASR
/// segments are often long (up to 30 s) and can contain several speakers,
/// which would form "mixed" clusters of their own.
///
/// Stage 1 (speaker-change detection): walk 1 s windows in time order and
/// grow the current turn while ΔBIC says the next window is the same voice.
/// Stage 2 (clustering): BIC agglomerative clustering over those turns, which
/// are long enough for stable statistics.
const WINDOW_FRAMES: usize = 100; // 1 s
/// A window needs this many speech frames (~0.4 s) to take part.
const MIN_WINDOW_SPEECH: usize = 40;
/// Turns shorter than this many speech frames (~1 s) don't seed a cluster;
/// they're attached to the nearest speaker afterwards.
const MIN_TURN_SPEECH: usize = 100;
/// Complexity weight for stage 1 (turn growing). Lower than the clustering
/// weight: a missed change point costs more than an extra split, because
/// stage 2 re-joins same-speaker turns anyway.
pub const BIC_LAMBDA_CHANGE: f64 = 1.0;

fn change_lambda() -> f64 {
    static T: std::sync::OnceLock<f64> = std::sync::OnceLock::new();
    *T.get_or_init(|| {
        std::env::var("ECHOMIND_BIC_CHANGE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(BIC_LAMBDA_CHANGE)
    })
}

/// A homogeneous speaker turn: a run of windows `[first_win, last_win]`.
struct Turn {
    first_win: usize,
    last_win: usize,
    stats: GaussStats,
}

/// Speaker label per window (index = window number), `None` for windows
/// without enough speech. Exposed for evaluation tooling.
pub fn diarize_windows(ff: &FrameFeatures, max_k: usize) -> Vec<Option<usize>> {
    let n_win = ff.ceps.len().div_ceil(WINDOW_FRAMES);
    let fps = (ff.sample_rate as u64 / HOP_LEN as u64).max(1);
    let win_ms = WINDOW_FRAMES as u64 * 1000 / fps;
    let stats: Vec<GaussStats> = (0..n_win)
        .map(|w| segment_stats(ff, w as u64 * win_ms, (w as u64 + 1) * win_ms))
        .collect();

    // Stage 1: grow turns. Windows without enough speech don't break a turn.
    let lc = change_lambda();
    let mut turns: Vec<Turn> = Vec::new();
    for (w, st) in stats.iter().enumerate() {
        if (st.n as usize) < MIN_WINDOW_SPEECH {
            continue;
        }
        let same = turns
            .last()
            .map(|t| delta_bic_with(&t.stats, st, lc) < 0.0)
            .unwrap_or(false);
        if same {
            let t = turns.last_mut().unwrap();
            t.stats.add(st);
            t.last_win = w;
        } else {
            turns.push(Turn {
                first_win: w,
                last_win: w,
                stats: st.clone(),
            });
        }
    }
    let mut out = vec![None; n_win];
    if turns.is_empty() {
        return out;
    }

    // Stage 2: cluster the turns that carry enough speech.
    let seeds: Vec<usize> = (0..turns.len())
        .filter(|&i| turns[i].stats.n as usize >= MIN_TURN_SPEECH)
        .collect();
    let seeds = if seeds.is_empty() {
        (0..turns.len()).collect()
    } else {
        seeds
    };
    let items: Vec<GaussStats> = seeds.iter().map(|&i| turns[i].stats.clone()).collect();
    let raw = bic_cluster(&items, max_k);
    let mut turn_label = vec![usize::MAX; turns.len()];
    let mut models: HashMap<usize, GaussStats> = HashMap::new();
    for (k, &i) in seeds.iter().enumerate() {
        turn_label[i] = raw[k];
        models
            .entry(raw[k])
            .or_insert_with(GaussStats::empty)
            .add(&items[k]);
    }
    // Short turns: the cluster whose model absorbs them at the lowest ΔBIC.
    for i in 0..turns.len() {
        if turn_label[i] == usize::MAX {
            turn_label[i] = *models
                .iter()
                .min_by(|a, b| {
                    delta_bic(a.1, &turns[i].stats)
                        .partial_cmp(&delta_bic(b.1, &turns[i].stats))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .unwrap()
                .0;
        }
    }
    for (i, t) in turns.iter().enumerate() {
        for w in t.first_win..=t.last_win {
            if (stats[w].n as usize) >= MIN_WINDOW_SPEECH {
                out[w] = Some(turn_label[i]);
            }
        }
    }
    out
}

/// Segment-level variant: one Gaussian per ASR segment, BIC-clustered.
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

/// Assigns `Konuşmacı N` labels to `segments` from the audio in `full_pcm`
/// (segment times are relative to the start of `full_pcm`). Each segment gets
/// the speaker who holds most of the speech inside it.
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
    if std::env::var("ECHOMIND_DIAR_MODE").as_deref() == Ok("segment") {
        cluster_by_segments(segments, &ff, max_k);
        return;
    }
    let win = diarize_windows(&ff, max_k);
    let fps = (sample_rate as u64 / HOP_LEN as u64).max(1);

    // Cluster models, for segments that no labelled window covers.
    let mut models: HashMap<usize, GaussStats> = HashMap::new();
    let win_ms = WINDOW_FRAMES as u64 * 1000 / fps;
    for (w, l) in win.iter().enumerate() {
        if let Some(c) = l {
            let st = segment_stats(&ff, w as u64 * win_ms, (w as u64 + 1) * win_ms);
            models.entry(*c).or_insert_with(GaussStats::empty).add(&st);
        }
    }

    let mut labels: Vec<Option<usize>> = Vec::with_capacity(segments.len());
    for s in segments.iter() {
        let a = ((s.start_time_ms * fps) / 1000) as usize;
        let b = (((s.end_time_ms * fps) / 1000) as usize).min(ff.speech.len());
        // Speech frames per speaker inside the segment.
        let mut votes: HashMap<usize, usize> = HashMap::new();
        for f in a..b.max(a) {
            if ff.speech[f] {
                if let Some(Some(c)) = win.get(f / WINDOW_FRAMES) {
                    *votes.entry(*c).or_default() += 1;
                }
            }
        }
        let mut label = votes
            .into_iter()
            .max_by_key(|&(c, n)| (n, usize::MAX - c))
            .map(|(c, _)| c);
        if label.is_none() && !models.is_empty() {
            let st = segment_stats(&ff, s.start_time_ms, s.end_time_ms);
            if st.n > 0.0 {
                let m = st.mean();
                label = models
                    .iter()
                    .min_by(|x, y| {
                        let dx: f64 =
                            x.1.mean()
                                .iter()
                                .zip(m.iter())
                                .map(|(p, q)| (p - q).powi(2))
                                .sum();
                        let dy: f64 =
                            y.1.mean()
                                .iter()
                                .zip(m.iter())
                                .map(|(p, q)| (p - q).powi(2))
                                .sum();
                        dx.partial_cmp(&dy).unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .map(|(c, _)| *c);
            }
        }
        labels.push(label);
    }
    // Silent segments inherit the previous speaker.
    let mut last = labels.iter().flatten().next().copied().unwrap_or(0);
    let labels: Vec<usize> = labels
        .into_iter()
        .map(|l| {
            if let Some(c) = l {
                last = c;
            }
            last
        })
        .collect();

    let mut remap: HashMap<usize, usize> = HashMap::new();
    for (seg, &c) in segments.iter_mut().zip(&labels) {
        let next = remap.len() + 1;
        let n = *remap.entry(c).or_insert(next);
        seg.speaker_id = format!("Konuşmacı {}", n);
        seg.speaker_name = format!("Konuşmacı {}", n);
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
}
