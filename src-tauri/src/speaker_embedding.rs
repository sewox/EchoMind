//! Neural speaker embeddings (3D-Speaker CAM++, ONNX, run with `tract` — pure
//! Rust, no native runtime to bundle). Used by diarization when the model has
//! been downloaded; otherwise diarization falls back to MFCC + BIC.
use rustfft::{num_complex::Complex32, FftPlanner};
use std::path::{Path, PathBuf};
use tract_onnx::prelude::*;

pub const MODEL_FILE: &str = "speaker_campplus_en_voxceleb_16k.onnx";
pub const MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx";
pub const MODEL_SHA256: &str = "357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b";
pub const MODEL_SIZE_BYTES: u64 = 29_596_978;
pub const EMB_DIM: usize = 512;

pub const N_BINS: usize = 80;
const FRAME_LEN: usize = 400; // 25 ms
const HOP_LEN: usize = 160; // 10 ms
const N_FFT: usize = 512;

pub fn model_path() -> PathBuf {
    crate::storage::get_models_dir().join(MODEL_FILE)
}

/// Downloads the speaker model if it isn't present yet (≈30 MB, once), into a
/// `.part` file that is only renamed into place after its SHA-256 matches.
/// Diarization keeps using the MFCC + BIC fallback until this has finished.
pub fn ensure_model_downloaded() -> Result<PathBuf, String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    let path = model_path();
    if path.exists() {
        return Ok(path);
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let part = path.with_extension("onnx.part");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(MODEL_URL)
        .send()
        .map_err(|e| format!("speaker model download: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("speaker model download: HTTP {}", resp.status()));
    }
    let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    let mut total = 0u64;
    loop {
        let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        total += n as u64;
        if total > MODEL_SIZE_BYTES * 2 {
            let _ = std::fs::remove_file(&part);
            return Err("speaker model download: unexpected size".into());
        }
    }
    drop(out);
    let digest: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if digest != MODEL_SHA256 {
        let _ = std::fs::remove_file(&part);
        return Err("speaker model download: checksum mismatch".into());
    }
    std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

type Plan = SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>;

pub struct SpeakerEmbedder {
    plan: Plan,
    frames: usize,
}

impl SpeakerEmbedder {
    /// Loads the model for a fixed window length (`frames` fbank frames),
    /// with a dynamic batch dimension.
    pub fn load(path: &Path, frames: usize) -> Result<Self, String> {
        let model = tract_onnx::onnx()
            .model_for_path(path)
            .map_err(|e| format!("speaker model load: {e}"))?
            .with_input_fact(0, f32::fact([1, frames, N_BINS]).into())
            .map_err(|e| format!("speaker model input: {e}"))?
            .into_optimized()
            .map_err(|e| format!("speaker model optimise: {e}"))?
            .into_runnable()
            .map_err(|e| format!("speaker model plan: {e}"))?;
        Ok(Self {
            plan: model,
            frames,
        })
    }

    pub fn frames(&self) -> usize {
        self.frames
    }

    /// Embeds one window of mean-normalised fbank frames (`frames` × 80).
    pub fn embed(&self, feats: &[[f32; N_BINS]]) -> Result<Vec<f32>, String> {
        debug_assert_eq!(feats.len(), self.frames);
        let flat: Vec<f32> = feats.iter().flat_map(|r| r.iter().copied()).collect();
        let input = tract_ndarray::Array3::from_shape_vec((1, self.frames, N_BINS), flat)
            .map_err(|e| e.to_string())?;
        let out = self
            .plan
            .run(tvec!(input.into_tensor().into()))
            .map_err(|e| format!("speaker model run: {e}"))?;
        let v = out[0].to_array_view::<f32>().map_err(|e| e.to_string())?;
        let mut emb: Vec<f32> = v.iter().copied().collect();
        let norm = emb.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
        emb.iter_mut().for_each(|x| *x /= norm);
        Ok(emb)
    }
}

fn mel(f: f32) -> f32 {
    1127.0 * (1.0 + f / 700.0).ln()
}

/// Kaldi-compatible 80-bin log-mel filterbank (dither 0, snip_edges, Povey
/// window, DC removal, 0.97 pre-emphasis, power spectrum, 20 Hz–Nyquist),
/// matching what the 3D-Speaker / sherpa-onnx models were trained on.
pub fn kaldi_fbank(pcm: &[f32], sample_rate: u32) -> Vec<[f32; N_BINS]> {
    if pcm.len() < FRAME_LEN {
        return Vec::new();
    }
    let n_frames = 1 + (pcm.len() - FRAME_LEN) / HOP_LEN;
    let window: Vec<f32> = (0..FRAME_LEN)
        .map(|i| {
            (0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (FRAME_LEN - 1) as f32).cos())
                .powf(0.85)
        })
        .collect();
    // Triangular filters defined in the mel domain (Kaldi MelBanks).
    let nyquist = sample_rate as f32 / 2.0;
    let (lo, hi) = (mel(20.0), mel(nyquist));
    let delta = (hi - lo) / (N_BINS + 1) as f32;
    let fft_bin_hz = sample_rate as f32 / N_FFT as f32;
    let banks: Vec<Vec<(usize, f32)>> = (0..N_BINS)
        .map(|b| {
            let (l, c, r) = (
                lo + b as f32 * delta,
                lo + (b + 1) as f32 * delta,
                lo + (b + 2) as f32 * delta,
            );
            (0..N_FFT / 2)
                .filter_map(|k| {
                    let m = mel(k as f32 * fft_bin_hz);
                    let w = if m > l && m <= c {
                        (m - l) / (c - l)
                    } else if m > c && m < r {
                        (r - m) / (r - c)
                    } else {
                        0.0
                    };
                    (w > 0.0).then_some((k, w))
                })
                .collect()
        })
        .collect();

    let fft = FftPlanner::<f32>::new().plan_fft_forward(N_FFT);
    let mut buf = vec![Complex32::new(0.0, 0.0); N_FFT];
    let mut frame = [0f32; FRAME_LEN];
    let mut out = Vec::with_capacity(n_frames);
    for f in 0..n_frames {
        frame.copy_from_slice(&pcm[f * HOP_LEN..f * HOP_LEN + FRAME_LEN]);
        let mean = frame.iter().sum::<f32>() / FRAME_LEN as f32;
        frame.iter_mut().for_each(|x| *x -= mean);
        for i in (1..FRAME_LEN).rev() {
            frame[i] -= 0.97 * frame[i - 1];
        }
        frame[0] -= 0.97 * frame[0];
        for (i, b) in buf.iter_mut().enumerate() {
            *b = if i < FRAME_LEN {
                Complex32::new(frame[i] * window[i], 0.0)
            } else {
                Complex32::new(0.0, 0.0)
            };
        }
        fft.process(&mut buf);
        let mut row = [0f32; N_BINS];
        for (b, bank) in banks.iter().enumerate() {
            let e: f32 = bank.iter().map(|&(k, w)| w * buf[k].norm_sqr()).sum();
            row[b] = e.max(f32::EPSILON).ln();
        }
        out.push(row);
    }
    out
}

/// Subtracts the per-bin mean over the window ("global-mean" normalisation).
pub fn mean_normalise(feats: &mut [[f32; N_BINS]]) {
    if feats.is_empty() {
        return;
    }
    let n = feats.len() as f32;
    for b in 0..N_BINS {
        let m = feats.iter().map(|r| r[b]).sum::<f32>() / n;
        feats.iter_mut().for_each(|r| r[b] -= m);
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}
