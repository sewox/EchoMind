//! Transcribing a recording's two tracks separately: the microphone (the
//! local user, "Siz") and the system audio (everyone else), merged by time,
//! as meeting recorders do (Granola, Hyprnote). Mixing them lost words: on a
//! real meeting the mixed transcript held only 39% of the local user's
//! phrases, the separate one all of them, with no phrase written twice
//! (once the echo is removed, see `echo.rs`).
//!
//! For Whisper each track is first cut down to its voiced stretches, with a
//! short pause between them: Whisper writes words into long silences ("tamam."
//! over fifty silent seconds of a microphone track). Timestamps are mapped
//! back afterwards. Engines that stay quiet on silence (Apple dictation) get
//! the whole track, so nothing can be cut.

use crate::transcriber::TranscriptSegment;

const RATE: usize = 16_000;
/// Analysis frame for voice activity (30 ms).
const FRAME: usize = RATE * 3 / 100;
/// Pauses shorter than this stay inside a stretch.
const BRIDGE: usize = RATE * 8 / 10;
/// Voiced stretches shorter than this are clicks, not speech.
const MIN_VOICE: usize = RATE * 3 / 10;
/// Kept around each stretch so word edges are not cut.
const PAD: usize = RATE / 4;
/// Silence put between stretches in the compacted track.
const GAP: usize = RATE / 2;
/// A frame counts as voiced above this level, or above the noise floor
/// times `FLOOR_FACTOR`, whichever is higher.
const MIN_LEVEL: f32 = 0.012;
const FLOOR_FACTOR: f32 = 3.0;

fn frame_levels(x: &[f32]) -> Vec<f32> {
    x.chunks(FRAME)
        .map(|f| (f.iter().map(|s| s * s).sum::<f32>() / f.len() as f32).sqrt())
        .collect()
}

/// Voiced stretches of `x` as sample ranges (start, end), padded and with
/// short pauses bridged.
pub fn voice_regions(x: &[f32]) -> Vec<(usize, usize)> {
    let levels = frame_levels(x);
    if levels.is_empty() {
        return Vec::new();
    }
    let mut sorted = levels.clone();
    sorted.sort_by(f32::total_cmp);
    let floor = sorted[sorted.len() * 15 / 100];
    let threshold = MIN_LEVEL.max(floor * FLOOR_FACTOR);

    let mut regions: Vec<(usize, usize)> = Vec::new();
    for (i, &level) in levels.iter().enumerate() {
        if level < threshold {
            continue;
        }
        let (start, end) = (i * FRAME, ((i + 1) * FRAME).min(x.len()));
        match regions.last_mut() {
            Some(last) if start <= last.1 + BRIDGE => last.1 = end,
            _ => regions.push((start, end)),
        }
    }
    regions
        .into_iter()
        .filter(|(s, e)| e - s >= MIN_VOICE)
        .map(|(s, e)| (s.saturating_sub(PAD), (e + PAD).min(x.len())))
        .fold(Vec::new(), |mut out: Vec<(usize, usize)>, (s, e)| {
            match out.last_mut() {
                Some(last) if s <= last.1 => last.1 = last.1.max(e),
                _ => out.push((s, e)),
            }
            out
        })
}

/// One stretch of the compacted track and where it came from.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Piece {
    compact_start: usize,
    original_start: usize,
    len: usize,
}

/// A track reduced to its voiced stretches, with the way back.
#[derive(Debug, Clone, Default)]
pub struct Compacted {
    pub audio: Vec<f32>,
    pieces: Vec<Piece>,
}

impl Compacted {
    /// Original position of a position in the compacted track. Positions in
    /// a gap belong to the end of the stretch before it.
    pub fn to_original(&self, compact: usize) -> usize {
        let i = self
            .pieces
            .partition_point(|p| p.compact_start <= compact)
            .saturating_sub(1);
        let Some(p) = self.pieces.get(i) else {
            return compact;
        };
        p.original_start + (compact.saturating_sub(p.compact_start)).min(p.len)
    }
}

pub fn compact(x: &[f32]) -> Compacted {
    let mut out = Compacted::default();
    for (s, e) in voice_regions(x) {
        if !out.audio.is_empty() {
            out.audio.extend(std::iter::repeat_n(0.0, GAP));
        }
        out.pieces.push(Piece {
            compact_start: out.audio.len(),
            original_start: s,
            len: e - s,
        });
        out.audio.extend_from_slice(&x[s..e]);
    }
    out
}

fn ms_to_samples(ms: u64) -> usize {
    (ms as usize) * RATE / 1000
}

fn samples_to_ms(samples: usize) -> u64 {
    (samples * 1000 / RATE) as u64
}

/// Moves segment times from the compacted track back to the original one.
fn restore_times(segments: &mut [TranscriptSegment], track: &Compacted) {
    for seg in segments.iter_mut() {
        let start = track.to_original(ms_to_samples(seg.start_time_ms));
        let end = track
            .to_original(ms_to_samples(seg.end_time_ms))
            .max(start + 1);
        seg.start_time_ms = samples_to_ms(start);
        seg.end_time_ms = samples_to_ms(end);
        seg.timestamp_formatted =
            crate::transcriber::format_span(seg.start_time_ms, seg.end_time_ms);
    }
}

/// One transcript: the local segments labeled as the user, the remote ones
/// with their own speakers, in time order and numbered from 1.
pub fn merge(
    mut local: Vec<TranscriptSegment>,
    remote: Vec<TranscriptSegment>,
) -> Vec<TranscriptSegment> {
    for seg in local.iter_mut() {
        seg.speaker_id = crate::diarization::LOCAL_SPEAKER_LABEL.to_string();
        seg.speaker_name = crate::diarization::LOCAL_SPEAKER_LABEL.to_string();
    }
    let mut all = local;
    all.extend(remote);
    all.sort_by_key(|s| (s.start_time_ms, s.end_time_ms));
    for (i, seg) in all.iter_mut().enumerate() {
        seg.id = i + 1;
    }
    all
}

/// How a track reaches the recognizer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Silence {
    /// Cut out (engines that invent words in silence: Whisper).
    Remove,
    /// Kept (engines that stay quiet on silence: Apple dictation).
    Keep,
}

/// Transcribes `mic` and `system` separately with `run` (which labels the
/// speakers of the audio it gets) and merges the results.
pub fn transcribe<F>(
    mic: &[f32],
    system: &[f32],
    silence: Silence,
    mut run: F,
) -> Result<Vec<TranscriptSegment>, String>
where
    F: FnMut(&[f32]) -> Result<Vec<TranscriptSegment>, String>,
{
    let mut part = |track: &[f32]| -> Result<Vec<TranscriptSegment>, String> {
        if voice_regions(track).is_empty() {
            return Ok(Vec::new());
        }
        if silence == Silence::Keep {
            return run(track);
        }
        let compacted = compact(track);
        let mut segments = run(&compacted.audio)?;
        restore_times(&mut segments, &compacted);
        Ok(segments)
    };
    let local = part(mic)?;
    let remote = part(system)?;
    Ok(merge(local, remote))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(seconds: f32, level: f32) -> Vec<f32> {
        (0..(seconds * RATE as f32) as usize)
            .map(|i| level * (i as f32 * 0.07).sin())
            .collect()
    }

    fn silence(seconds: f32) -> Vec<f32> {
        vec![0.0; (seconds * RATE as f32) as usize]
    }

    fn seg(start_ms: u64, end_ms: u64, speaker: &str) -> TranscriptSegment {
        TranscriptSegment {
            id: 0,
            speaker_id: speaker.into(),
            speaker_name: speaker.into(),
            start_time_ms: start_ms,
            end_time_ms: end_ms,
            timestamp_formatted: String::new(),
            text: "x".into(),
            language: "tr".into(),
            confidence: 1.0,
        }
    }

    #[test]
    fn finds_speech_and_bridges_short_pauses() {
        // 2 s silence, 1 s voice, 0.5 s pause, 1 s voice, 5 s silence, 1 s voice.
        let x: Vec<f32> = [
            silence(2.0),
            tone(1.0, 0.2),
            silence(0.5),
            tone(1.0, 0.2),
            silence(5.0),
            tone(1.0, 0.2),
        ]
        .concat();
        let r = voice_regions(&x);
        assert_eq!(r.len(), 2, "{r:?}");
        assert!(r[0].0 <= 2 * RATE && r[0].0 >= 2 * RATE - PAD - FRAME);
        assert!(r[0].1 >= (4.5 * RATE as f32) as usize);
        assert!(r[1].0 <= (9.5 * RATE as f32) as usize);
    }

    #[test]
    fn ignores_clicks_and_a_quiet_floor() {
        let mut x = vec![0.004f32; 10 * RATE];
        // A 60 ms click is not speech.
        for s in x.iter_mut().skip(3 * RATE).take(RATE * 6 / 100) {
            *s = 0.5;
        }
        assert!(voice_regions(&x).is_empty());
        assert!(voice_regions(&[]).is_empty());
        assert!(compact(&silence(30.0)).audio.is_empty());
    }

    #[test]
    fn compacting_drops_silence_and_maps_back() {
        let x: Vec<f32> = [silence(10.0), tone(2.0, 0.2), silence(20.0), tone(2.0, 0.2)].concat();
        let c = compact(&x);
        assert!(
            c.audio.len() < 6 * RATE,
            "silence removed: {}",
            c.audio.len()
        );
        assert_eq!(c.pieces.len(), 2);
        // The first sample of each stretch maps to where it was.
        assert_eq!(c.to_original(0), c.pieces[0].original_start);
        let second = c.pieces[1];
        assert_eq!(c.to_original(second.compact_start), second.original_start);
        assert!(second.original_start >= 32 * RATE - PAD - FRAME);
        // Inside the gap: the end of the first stretch.
        let gap_pos = c.pieces[0].compact_start + c.pieces[0].len + GAP / 2;
        assert_eq!(
            c.to_original(gap_pos),
            c.pieces[0].original_start + c.pieces[0].len
        );
    }

    #[test]
    fn segments_come_back_on_the_original_timeline() {
        let x: Vec<f32> = [silence(60.0), tone(3.0, 0.2)].concat();
        let c = compact(&x);
        let mut segs = vec![seg(0, 1000, "A")];
        restore_times(&mut segs, &c);
        let start = c.pieces[0].original_start as u64 * 1000 / RATE as u64;
        assert_eq!(segs[0].start_time_ms, start);
        assert_eq!(segs[0].end_time_ms, start + 1000);
        assert_eq!(
            segs[0].timestamp_formatted,
            crate::transcriber::format_span(start, start + 1000)
        );
    }

    #[test]
    fn local_and_remote_merge_in_time_order() {
        let merged = merge(
            vec![
                seg(5_000, 6_000, "Konuşmacı 1"),
                seg(1_000, 2_000, "Konuşmacı 1"),
            ],
            vec![seg(3_000, 4_000, "Konuşmacı 2")],
        );
        let order: Vec<(usize, u64, &str)> = merged
            .iter()
            .map(|s| (s.id, s.start_time_ms, s.speaker_name.as_str()))
            .collect();
        assert_eq!(
            order,
            [
                (1, 1_000, "Siz"),
                (2, 3_000, "Konuşmacı 2"),
                (3, 5_000, "Siz")
            ]
        );
    }

    #[test]
    fn each_track_is_transcribed_on_its_own() {
        let mic: Vec<f32> = [silence(30.0), tone(2.0, 0.2)].concat();
        let system: Vec<f32> = [tone(2.0, 0.2), silence(30.0)].concat();
        let mut calls = Vec::new();
        let segs = transcribe(&mic, &system, Silence::Remove, |audio| {
            calls.push(audio.len());
            Ok(vec![seg(0, 500, "Konuşmacı 1")])
        })
        .unwrap();
        assert_eq!(calls.len(), 2);
        assert!(
            calls.iter().all(|&n| n < 4 * RATE),
            "silence never sent: {calls:?}"
        );
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].speaker_name, "Konuşmacı 1", "remote talks first");
        assert_eq!(segs[1].speaker_name, "Siz");
        assert!(segs[1].start_time_ms >= 29_000);

        // A silent mic is not transcribed at all.
        let mut n = 0;
        transcribe(&silence(10.0), &system, Silence::Remove, |_| {
            n += 1;
            Ok(Vec::new())
        })
        .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn engines_quiet_on_silence_get_the_whole_track() {
        let mic: Vec<f32> = [silence(30.0), tone(2.0, 0.2)].concat();
        let mut lens = Vec::new();
        let segs = transcribe(&mic, &silence(5.0), Silence::Keep, |audio| {
            lens.push(audio.len());
            Ok(vec![seg(30_500, 31_000, "Konuşmacı 1")])
        })
        .unwrap();
        assert_eq!(lens, [mic.len()], "whole mic, silent system skipped");
        assert_eq!(segs[0].start_time_ms, 30_500, "times already right");
        assert_eq!(segs[0].speaker_name, "Siz");
    }
}
