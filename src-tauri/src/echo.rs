//! The remote side's voice in the microphone track, and its removal.
//!
//! With loudspeakers, what the system plays reaches the microphone again, so
//! the remote side is recorded twice: once in the system track and once, a
//! little earlier or later, in the microphone track. Mixed, that sounds like
//! an echo, and speech recognition loses about half the words (measured on a
//! real two-hour meeting: 405 words instead of 731 in five minutes).
//!
//! Two steps, as meeting recorders do it (see fastrepl/anarlog, MIT):
//! 1. Alignment: the lag between the copy in the microphone and the system
//!    track is measured with GCC-PHAT every 30 s (it drifts during a long
//!    recording), and the system track is shifted onto the microphone's
//!    timeline.
//! 2. Cancellation: DTLN-aec (Westhausen, MIT; 128 units) removes the
//!    aligned system audio from the microphone, keeping the local voice.
//!
//! Recordings without a measurable copy (headphones, a silent remote side)
//! are left as they are.

use ndarray::Array3;
use ort::session::Session;
use ort::value::Tensor;
use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use std::sync::Arc;

pub const SAMPLE_RATE: usize = 16_000;

const MODEL_1: &[u8] = include_bytes!("../resources/aec/model_128_1.onnx");
const MODEL_2: &[u8] = include_bytes!("../resources/aec/model_128_2.onnx");
const STATE_SIZE: usize = 128;
const BLOCK: usize = 512;
const SHIFT: usize = 128;

/// Analysis window and spacing for the lag measurements.
const LAG_WINDOW: usize = 10 * SAMPLE_RATE;
const LAG_STEP: usize = 30 * SAMPLE_RATE;
/// Largest lag searched either way (the copy can lead or trail).
const MAX_LAG: usize = SAMPLE_RATE * 6 / 10;
/// System audio this loud counts as the remote side talking.
const ACTIVE_RMS: f32 = 0.02;
/// Peak-to-median ratio of the GCC-PHAT curve above which the microphone
/// clearly holds a copy (real echo measured 250–800; noise stays under 10).
const MIN_SHARPNESS: f32 = 25.0;
/// Fewer clear measurements than this: no echo worth removing.
const MIN_MEASUREMENTS: usize = 2;

fn rms(x: &[f32]) -> f32 {
    if x.is_empty() {
        return 0.0;
    }
    (x.iter().map(|s| s * s).sum::<f32>() / x.len() as f32).sqrt()
}

/// One lag measurement: around `at` (samples), the copy in the microphone
/// comes `lag` samples before the system track (negative: after).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lag {
    pub at: usize,
    pub lag: isize,
}

/// GCC-PHAT between `reference` and `observed`, where `observed` starts
/// `MAX_LAG` samples earlier and ends `MAX_LAG` later. Returns the lag (as in
/// [`Lag`]) and the sharpness of the peak.
fn gcc_phat(planner: &mut FftPlanner<f32>, reference: &[f32], observed: &[f32]) -> (isize, f32) {
    let n = (reference.len() + observed.len()).next_power_of_two();
    let fft = planner.plan_fft_forward(n);
    let ifft = planner.plan_fft_inverse(n);
    let spectrum = |x: &[f32], fft: &Arc<dyn Fft<f32>>| {
        let mut buf: Vec<Complex<f32>> = x.iter().map(|&s| Complex::new(s, 0.0)).collect();
        buf.resize(n, Complex::new(0.0, 0.0));
        fft.process(&mut buf);
        buf
    };
    let a = spectrum(reference, &fft);
    let b = spectrum(observed, &fft);
    let mut g: Vec<Complex<f32>> = b
        .iter()
        .zip(&a)
        .map(|(bb, aa)| {
            let c = bb * aa.conj();
            c / (c.norm() + 1e-12)
        })
        .collect();
    ifft.process(&mut g);
    let curve: Vec<f32> = g[..2 * MAX_LAG + 1].iter().map(|c| c.re).collect();
    let (k, peak) = curve
        .iter()
        .copied()
        .enumerate()
        .max_by(|x, y| x.1.total_cmp(&y.1))
        .unwrap_or((MAX_LAG, 0.0));
    let mut mags: Vec<f32> = curve.iter().map(|v| v.abs()).collect();
    mags.sort_by(f32::total_cmp);
    let median = mags[mags.len() / 2].max(1e-12);
    (MAX_LAG as isize - k as isize, peak / median)
}

/// Clear lag measurements over the recording, smoothed so a single odd
/// window cannot move the alignment.
pub fn measure_lags(mic: &[f32], system: &[f32]) -> Vec<Lag> {
    measure_lags_with(mic, system, |s| s)
}

/// [`measure_lags`] for any sample type: only the analysed windows are
/// converted, so 16-bit recordings are never copied whole.
fn measure_lags_with<S: Copy>(mic: &[S], system: &[S], to_f32: impl Fn(S) -> f32) -> Vec<Lag> {
    let window = |x: &[S]| x.iter().map(|&s| to_f32(s)).collect::<Vec<f32>>();
    let len = mic.len().min(system.len());
    let mut planner = FftPlanner::new();
    let mut raw = Vec::new();
    let mut start = MAX_LAG;
    while start + LAG_WINDOW + MAX_LAG <= len {
        let reference = window(&system[start..start + LAG_WINDOW]);
        if rms(&reference) >= ACTIVE_RMS {
            let observed = window(&mic[start - MAX_LAG..start + LAG_WINDOW + MAX_LAG]);
            let (lag, sharpness) = gcc_phat(&mut planner, &reference, &observed);
            if sharpness >= MIN_SHARPNESS {
                raw.push(Lag {
                    at: start + LAG_WINDOW / 2,
                    lag,
                });
            }
        }
        start += LAG_STEP;
    }
    // Median of each measurement and its neighbours.
    (0..raw.len())
        .map(|i| {
            let lo = i.saturating_sub(2);
            let hi = (i + 3).min(raw.len());
            let mut near: Vec<isize> = raw[lo..hi].iter().map(|l| l.lag).collect();
            near.sort_unstable();
            Lag {
                at: raw[i].at,
                lag: near[near.len() / 2],
            }
        })
        .collect()
}

/// The system track moved onto the microphone's timeline: each stretch uses
/// the lag measured nearest to it.
pub fn align(system: &[f32], len: usize, lags: &[Lag]) -> Vec<f32> {
    let mut out = vec![0.0f32; len];
    if lags.is_empty() {
        let n = len.min(system.len());
        out[..n].copy_from_slice(&system[..n]);
        return out;
    }
    let mut which = 0;
    for (t, sample) in out.iter_mut().enumerate() {
        while which + 1 < lags.len() && t >= (lags[which].at + lags[which + 1].at) / 2 {
            which += 1;
        }
        let src = t as isize + lags[which].lag;
        if src >= 0 {
            if let Some(&s) = system.get(src as usize) {
                *sample = s;
            }
        }
    }
    out
}

fn ort_err(e: impl std::fmt::Display) -> String {
    format!("echo cancellation: {e}")
}

/// DTLN-aec over a whole recording (a port of anarlog's `crates/aec`).
struct Dtln {
    first: Session,
    second: Session,
}

impl Dtln {
    fn load() -> Result<Self, String> {
        let session = |bytes: &[u8]| {
            Session::builder()
                .map_err(ort_err)?
                .with_intra_threads(1)
                .map_err(ort_err)?
                .commit_from_memory(bytes)
                .map_err(ort_err)
        };
        Ok(Dtln {
            first: session(MODEL_1)?,
            second: session(MODEL_2)?,
        })
    }

    /// `mic` without the echo of `reference` (same length and timeline).
    fn process(&mut self, mic: &[f32], reference: &[f32]) -> Result<Vec<f32>, String> {
        let len = mic.len().min(reference.len());
        let pad = BLOCK - SHIFT;
        let padded = |x: &[f32]| {
            let mut v = vec![0.0f32; pad];
            v.extend_from_slice(&x[..len]);
            v.extend(std::iter::repeat_n(0.0, pad));
            v
        };
        let (audio, lpb) = (padded(mic), padded(reference));

        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(BLOCK);
        let ifft = planner.plan_fft_inverse(BLOCK);
        let bins = BLOCK / 2 + 1;

        let mut states_1 = ndarray::Array4::<f32>::zeros((1, 2, STATE_SIZE, 2));
        let mut states_2 = ndarray::Array4::<f32>::zeros((1, 2, STATE_SIZE, 2));
        let mut in_buf = vec![0.0f32; BLOCK];
        let mut lpb_buf = vec![0.0f32; BLOCK];
        let mut out_buf = vec![0.0f32; BLOCK];
        let mut out = vec![0.0f32; audio.len()];
        let mut spec = vec![Complex::new(0.0f32, 0.0); BLOCK];
        let mut lpb_spec = vec![Complex::new(0.0f32, 0.0); BLOCK];

        let blocks = (audio.len() - pad) / SHIFT;
        for idx in 0..blocks {
            let s = idx * SHIFT;
            in_buf.copy_within(SHIFT.., 0);
            in_buf[pad..].copy_from_slice(&audio[s..s + SHIFT]);
            lpb_buf.copy_within(SHIFT.., 0);
            lpb_buf[pad..].copy_from_slice(&lpb[s..s + SHIFT]);

            for (c, &x) in spec.iter_mut().zip(&in_buf) {
                *c = Complex::new(x, 0.0);
            }
            fft.process(&mut spec);
            for (c, &x) in lpb_spec.iter_mut().zip(&lpb_buf) {
                *c = Complex::new(x, 0.0);
            }
            fft.process(&mut lpb_spec);
            let in_mag = Array3::from_shape_fn((1, 1, bins), |(_, _, k)| spec[k].norm());
            let lpb_mag = Array3::from_shape_fn((1, 1, bins), |(_, _, k)| lpb_spec[k].norm());

            let outputs = self
                .first
                .run(ort::inputs![
                    Tensor::from_array(in_mag).map_err(ort_err)?,
                    Tensor::from_array(states_1.clone()).map_err(ort_err)?,
                    Tensor::from_array(lpb_mag).map_err(ort_err)?
                ])
                .map_err(ort_err)?;
            let (_, mask) = outputs["Identity"]
                .try_extract_tensor::<f32>()
                .map_err(ort_err)?;
            let mask = mask.to_vec();
            let (_, st) = outputs["Identity_1"]
                .try_extract_tensor::<f32>()
                .map_err(ort_err)?;
            states_1 = ndarray::Array4::from_shape_vec((1, 2, STATE_SIZE, 2), st.to_vec())
                .map_err(ort_err)?;
            drop(outputs);

            // Mask the half spectrum and its mirror, back to time.
            for k in 0..bins {
                spec[k] *= mask[k];
                if k > 0 && k < BLOCK - k {
                    spec[BLOCK - k] *= mask[k];
                }
            }
            ifft.process(&mut spec);
            let estimated =
                Array3::from_shape_fn((1, 1, BLOCK), |(_, _, i)| spec[i].re / BLOCK as f32);
            let lpb_block =
                Array3::from_shape_vec((1, 1, BLOCK), lpb_buf.clone()).map_err(ort_err)?;

            let outputs = self
                .second
                .run(ort::inputs![
                    Tensor::from_array(estimated).map_err(ort_err)?,
                    Tensor::from_array(states_2.clone()).map_err(ort_err)?,
                    Tensor::from_array(lpb_block).map_err(ort_err)?
                ])
                .map_err(ort_err)?;
            let (_, block) = outputs["Identity"]
                .try_extract_tensor::<f32>()
                .map_err(ort_err)?;
            out_buf.copy_within(SHIFT.., 0);
            out_buf[pad..].fill(0.0);
            for (o, &b) in out_buf.iter_mut().zip(block.iter()) {
                *o += b;
            }
            let (_, st) = outputs["Identity_1"]
                .try_extract_tensor::<f32>()
                .map_err(ort_err)?;
            states_2 = ndarray::Array4::from_shape_vec((1, 2, STATE_SIZE, 2), st.to_vec())
                .map_err(ort_err)?;
            out[s..s + SHIFT].copy_from_slice(&out_buf[..SHIFT]);
        }
        let mut cleaned = out[pad..pad + len].to_vec();
        let peak = cleaned.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        if peak > 1.0 {
            cleaned.iter_mut().for_each(|s| *s *= 0.99 / peak);
        }
        Ok(cleaned)
    }
}

/// Recording split across threads in pieces; each starts this much earlier
/// so the model's state has settled where its output is kept.
const PREROLL: usize = 2 * SAMPLE_RATE;
/// Shorter recordings run in one piece.
const MIN_PARALLEL: usize = 60 * SAMPLE_RATE;

/// [`Dtln::process`] over the whole recording, in parallel pieces.
fn cancel(mic: &[f32], reference: &[f32]) -> Result<Vec<f32>, String> {
    let len = mic.len().min(reference.len());
    let threads = std::thread::available_parallelism()
        .map_or(2, |n| n.get())
        .clamp(1, 4);
    if len < MIN_PARALLEL || threads == 1 {
        return Dtln::load()?.process(&mic[..len], &reference[..len]);
    }
    let piece = len.div_ceil(threads);
    let parts: Vec<Result<Vec<f32>, String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|i| {
                let (start, end) = (i * piece, ((i + 1) * piece).min(len));
                let from = start.saturating_sub(PREROLL);
                scope.spawn(move || {
                    let out = Dtln::load()?.process(&mic[from..end], &reference[from..end])?;
                    Ok(out[start - from..].to_vec())
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| {
                h.join()
                    .unwrap_or_else(|_| Err("echo cancellation panicked".into()))
            })
            .collect()
    });
    let mut out = Vec::with_capacity(len);
    for part in parts {
        out.extend(part?);
    }
    Ok(out)
}

/// The two tracks of a recording after echo removal.
#[derive(Debug, Clone)]
pub struct Cleaned {
    pub mic: Vec<f32>,
    /// The system track on the microphone's timeline.
    pub system: Vec<f32>,
    /// Median lag that was corrected, in ms (positive: the system track was
    /// late); `None` when no echo was found and nothing changed.
    pub lag_ms: Option<f32>,
}

/// The microphone holds a clear copy of the system audio.
pub fn has_echo(mic: &[f32], system: &[f32]) -> bool {
    measure_lags(mic, system).len() >= MIN_MEASUREMENTS
}

/// [`has_echo`] for the 16-bit tracks of a recording being saved.
pub fn has_echo_pcm16(mic: &[i16], system: &[i16]) -> bool {
    measure_lags_with(mic, system, crate::audio::sample_to_f32).len() >= MIN_MEASUREMENTS
}

/// Cleans decoded recording channels in place: with two channels (mic,
/// system) and an echo, the mic loses the echo and the system track is
/// aligned with it. Returns the corrected lag in ms, if any.
pub fn clean_channels(channels: &mut [Vec<f32>]) -> Option<f32> {
    let [mic, system] = channels else {
        return None;
    };
    let cleaned = remove_echo(mic, system);
    cleaned.lag_ms?;
    *mic = cleaned.mic;
    *system = cleaned.system;
    cleaned.lag_ms
}

/// Removes the remote side's echo from `mic` and aligns `system` with it.
/// Without a measurable echo (or if the model fails) the tracks come back
/// unchanged.
pub fn remove_echo(mic: &[f32], system: &[f32]) -> Cleaned {
    let unchanged = || Cleaned {
        mic: mic.to_vec(),
        system: system.to_vec(),
        lag_ms: None,
    };
    let lags = measure_lags(mic, system);
    if lags.len() < MIN_MEASUREMENTS {
        return unchanged();
    }
    let aligned = align(system, mic.len(), &lags);
    let cleaned = cancel(mic, &aligned);
    match cleaned {
        Ok(mut clean_mic) => {
            clean_mic.resize(mic.len(), 0.0);
            let mut sorted: Vec<isize> = lags.iter().map(|l| l.lag).collect();
            sorted.sort_unstable();
            Cleaned {
                mic: clean_mic,
                system: aligned,
                lag_ms: Some(sorted[sorted.len() / 2] as f32 * 1000.0 / SAMPLE_RATE as f32),
            }
        }
        Err(e) => {
            eprintln!("⚠️ Yankı giderilemedi, kayıt olduğu gibi kullanılıyor: {e}");
            unchanged()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Speech-like noise: random bursts with silences.
    fn voice(seconds: usize, seed: u64) -> Vec<f32> {
        let mut x = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let mut out = Vec::with_capacity(seconds * SAMPLE_RATE);
        for i in 0..seconds * SAMPLE_RATE {
            x = x
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let n = ((x >> 33) as f32 / (1u64 << 31) as f32) - 0.5;
            let on = !(i / (SAMPLE_RATE / 3)).is_multiple_of(3);
            out.push(if on { n * 0.4 } else { 0.0 });
        }
        out
    }

    /// `x` delayed by `by` samples (positive) or advanced (negative).
    fn shifted(x: &[f32], by: isize) -> Vec<f32> {
        (0..x.len() as isize)
            .map(|t| {
                let s = t - by;
                if s >= 0 && (s as usize) < x.len() {
                    x[s as usize]
                } else {
                    0.0
                }
            })
            .collect()
    }

    #[test]
    fn finds_a_copy_that_leads_the_system_track() {
        // As recorded: the copy in the mic comes 134 ms before the system track.
        let remote = voice(90, 1);
        let system = shifted(&remote, 2144);
        let mic: Vec<f32> = remote.iter().map(|s| s * 0.4).collect();
        let lags = measure_lags(&mic, &system);
        assert!(lags.len() >= MIN_MEASUREMENTS, "{lags:?}");
        for l in &lags {
            assert!((l.lag - 2144).abs() <= 2, "{l:?}");
        }
        assert!(has_echo(&mic, &system));
    }

    #[test]
    fn finds_a_copy_that_trails_the_system_track() {
        let remote = voice(90, 2);
        let mic: Vec<f32> = shifted(&remote, 800).iter().map(|s| s * 0.3).collect();
        let lags = measure_lags(&mic, &remote);
        assert!(lags.iter().all(|l| (l.lag + 800).abs() <= 2), "{lags:?}");
    }

    #[test]
    fn no_echo_without_a_copy() {
        // Headphones: the mic holds another voice, not the remote one.
        let system = voice(90, 3);
        let mic = voice(90, 4);
        assert!(!has_echo(&mic, &system));
        let out = remove_echo(&mic, &system);
        assert_eq!(out.lag_ms, None);
        assert_eq!(out.mic, mic, "left as recorded");
        // And a silent remote side gives nothing to measure.
        assert!(!has_echo(&mic, &vec![0.0; mic.len()]));
    }

    #[test]
    fn sixteen_bit_tracks_are_checked_the_same_way() {
        let remote = voice(90, 7);
        let system = shifted(&remote, 2144);
        let mic: Vec<f32> = remote.iter().map(|s| s * 0.4).collect();
        let pcm = |x: &[f32]| {
            x.iter()
                .map(|&s| crate::audio::sample_to_i16(s))
                .collect::<Vec<_>>()
        };
        assert!(has_echo_pcm16(&pcm(&mic), &pcm(&system)));
        assert!(!has_echo_pcm16(&pcm(&voice(90, 8)), &pcm(&system)));
    }

    #[test]
    fn channels_without_echo_or_a_second_track_are_untouched() {
        let mut mono = vec![voice(5, 9)];
        assert_eq!(clean_channels(&mut mono), None);
        let mut two = vec![voice(90, 10), voice(90, 11)];
        let before = two.clone();
        assert_eq!(clean_channels(&mut two), None);
        assert_eq!(two, before);
    }

    #[test]
    fn alignment_follows_the_nearest_measurement() {
        let system: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let lags = [Lag { at: 10, lag: 5 }, Lag { at: 70, lag: -3 }];
        let out = align(&system, 100, &lags);
        assert_eq!(out[0], 5.0, "early part shifted by the first lag");
        assert_eq!(out[39], 44.0);
        assert_eq!(out[40], 37.0, "after the midpoint, the second lag");
        assert_eq!(out[99], 96.0);
        assert_eq!(align(&system, 3, &[]), vec![0.0, 1.0, 2.0]);
    }

    #[test]
    fn the_model_keeps_length_and_silence() {
        let mut dtln = Dtln::load().expect("bundled model loads");
        let silence = vec![0.0f32; 3 * SAMPLE_RATE + 77];
        let out = dtln.process(&silence, &silence).unwrap();
        assert_eq!(out.len(), silence.len());
        assert!(out.iter().all(|s| s.abs() < 1e-3));
    }

    /// Real recording (two channels: mic, system), e.g. a meeting played over
    /// loudspeakers:
    /// `ECHO_TEST_FILE=<file> cargo test --lib echo_real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn echo_real_recording() {
        let path = std::env::var("ECHO_TEST_FILE").expect("set ECHO_TEST_FILE");
        let ch =
            crate::importer::decode_audio_file_channels_16k(std::path::Path::new(&path)).unwrap();
        let (mic, system) = (&ch[0], &ch[1]);
        let out = remove_echo(mic, system);
        assert!(out.lag_ms.is_some(), "no echo found");
        // Seconds where only the remote side talks: the echo must drop.
        let sec = SAMPLE_RATE;
        let mut before = Vec::new();
        let mut after = Vec::new();
        for i in 0..mic.len() / sec {
            let r = rms(&out.system[i * sec..(i + 1) * sec]);
            let m = rms(&mic[i * sec..(i + 1) * sec]);
            if r > 0.03 && m < 0.06 {
                before.push(m);
                after.push(rms(&out.mic[i * sec..(i + 1) * sec]));
            }
        }
        let drop = 20.0 * (after.iter().sum::<f32>() / before.iter().sum::<f32>()).log10();
        eprintln!(
            "lag {:?} ms, echo {drop:.1} dB over {} s",
            out.lag_ms,
            before.len()
        );
        assert!(drop < -15.0);
    }
}
