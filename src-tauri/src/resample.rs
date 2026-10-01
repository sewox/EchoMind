//! Streaming low-pass + resample to 16 kHz.
//!
//! The capture path used to "resample" by keeping every Nth sample with no
//! filter, which folds everything above 8 kHz (fans, hiss, sibilants) back into
//! the speech band. This applies a windowed-sinc low-pass at the output Nyquist
//! and interpolates, keeping state across callback buffers.

/// Kernel half-width in input samples per unit of decimation ratio.
const HALF_TAPS_PER_RATIO: f64 = 8.0;

pub struct Downsampler {
    input_rate: u32,
    ratio: f64,
    cutoff: f64,
    half_width: usize,
    /// Input samples kept from earlier buffers (the filter's left context).
    history: Vec<f32>,
    /// Position of the next output sample, in input samples relative to the
    /// start of `history`.
    next_pos: f64,
}

impl Downsampler {
    pub fn new(input_rate: u32, output_rate: u32) -> Self {
        let ratio = (input_rate as f64 / output_rate as f64).max(1.0);
        Self {
            input_rate,
            ratio,
            // Cut a little below the output Nyquist to leave room for the
            // transition band.
            cutoff: 0.45 / ratio,
            half_width: (HALF_TAPS_PER_RATIO * ratio).ceil() as usize,
            history: Vec::new(),
            next_pos: 0.0,
        }
    }

    pub fn input_rate(&self) -> u32 {
        self.input_rate
    }

    /// Feeds input samples and returns the output samples now available.
    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        if (self.ratio - 1.0).abs() < 1e-9 {
            return input.to_vec();
        }
        self.history.extend_from_slice(input);
        let mut out = Vec::with_capacity((input.len() as f64 / self.ratio) as usize + 1);
        let hw = self.half_width as f64;
        while self.next_pos + hw < self.history.len() as f64 {
            out.push(self.sample_at(self.next_pos));
            self.next_pos += self.ratio;
        }
        // Drop history we no longer need for the left side of the kernel.
        let keep_from = (self.next_pos - hw).floor().max(0.0) as usize;
        if keep_from > 0 {
            self.history.drain(..keep_from);
            self.next_pos -= keep_from as f64;
        }
        out
    }

    fn sample_at(&self, pos: f64) -> f32 {
        let center = pos.floor() as isize;
        let frac = pos - center as f64;
        let hw = self.half_width as isize;
        let mut acc = 0.0f64;
        let mut wsum = 0.0f64;
        for k in -hw..=hw {
            let idx = center + k;
            if idx < 0 || idx as usize >= self.history.len() {
                continue;
            }
            let x = k as f64 - frac; // distance from the output position
            let sinc = if x.abs() < 1e-9 {
                2.0 * self.cutoff
            } else {
                (2.0 * std::f64::consts::PI * self.cutoff * x).sin() / (std::f64::consts::PI * x)
            };
            // Blackman window over [-hw-1, hw+1].
            let n = (x + hw as f64 + 1.0) / (2.0 * hw as f64 + 2.0);
            let w = 0.42 - 0.5 * (2.0 * std::f64::consts::PI * n).cos()
                + 0.08 * (4.0 * std::f64::consts::PI * n).cos();
            let h = sinc * w;
            acc += h * self.history[idx as usize] as f64;
            wsum += h;
        }
        if wsum.abs() > 1e-12 {
            (acc / wsum) as f32
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: f32, rate: u32, secs: f32) -> Vec<f32> {
        (0..(rate as f32 * secs) as usize)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin())
            .collect()
    }

    fn rms(v: &[f32]) -> f32 {
        (v.iter().map(|x| x * x).sum::<f32>() / v.len().max(1) as f32).sqrt()
    }

    #[test]
    fn test_keeps_speech_band_and_removes_aliasing() {
        // 1 kHz (speech band) passes; 11 kHz would alias to 5 kHz with naive
        // decimation and must be strongly attenuated instead.
        let mut ds = Downsampler::new(48000, 16000);
        let speech = ds.process(&tone(1000.0, 48000, 1.0));
        assert!(
            (rms(&speech[200..]) - 0.707).abs() < 0.05,
            "1 kHz rms {}",
            rms(&speech[200..])
        );

        let mut ds = Downsampler::new(48000, 16000);
        let alias = ds.process(&tone(11000.0, 48000, 1.0));
        assert!(
            rms(&alias[200..]) < 0.02,
            "11 kHz leaked: rms {}",
            rms(&alias[200..])
        );

        // The old naive decimation lets it through almost unchanged.
        let naive: Vec<f32> = tone(11000.0, 48000, 1.0).into_iter().step_by(3).collect();
        assert!(rms(&naive) > 0.5);
    }

    #[test]
    fn test_streaming_matches_one_shot_and_length() {
        let input = tone(440.0, 44100, 2.0);
        let mut a = Downsampler::new(44100, 16000);
        let whole = a.process(&input);
        let mut b = Downsampler::new(44100, 16000);
        let mut parts = Vec::new();
        for chunk in input.chunks(437) {
            parts.extend(b.process(chunk));
        }
        assert_eq!(whole.len(), parts.len());
        let worst = whole
            .iter()
            .zip(&parts)
            .enumerate()
            .map(|(i, (x, y))| (i, (x - y).abs()))
            .fold((0, 0f32), |a, b| if b.1 > a.1 { b } else { a });
        assert!(
            worst.1 < 1e-4,
            "max diff {} at {} of {}",
            worst.1,
            worst.0,
            whole.len()
        );
        let expected = (input.len() as f64 * 16000.0 / 44100.0) as usize;
        assert!((whole.len() as i64 - expected as i64).abs() < 40);
    }

    #[test]
    fn test_passthrough_at_16k() {
        let mut ds = Downsampler::new(16000, 16000);
        assert_eq!(ds.process(&[0.1, 0.2, 0.3]), vec![0.1, 0.2, 0.3]);
    }
}
