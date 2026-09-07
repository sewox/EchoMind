use hound::{WavSpec, WavWriter, SampleFormat};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::importer::decode_audio_file_to_pcm16k;
use crate::storage::{StorageEngine, get_storage_dir};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SoundbiteResult {
    pub file_path: String,
    pub filename: String,
    pub duration_seconds: f64,
    pub start_ms: u64,
    pub end_ms: u64,
}

pub struct AudioClipper;

impl AudioClipper {
    /// Clips a PCM segment from an audio file and saves it as a standard 16kHz 16-bit Mono WAV file.
    pub fn clip_to_wav(
        input_file_path: &Path,
        start_ms: u64,
        end_ms: u64,
        output_file_path: &Path,
    ) -> Result<SoundbiteResult, String> {
        if !input_file_path.exists() {
            return Err(format!("Kaynak ses dosyası bulunamadı: {:?}", input_file_path));
        }

        if end_ms <= start_ms {
            return Err("Bitiş zamanı başlangıç zamanından büyük olmalıdır.".to_string());
        }

        // Decode audio to 16kHz mono float32
        let (samples, _) = decode_audio_file_to_pcm16k(input_file_path)?;

        let sample_rate = 16000usize;
        let start_sample = (start_ms as usize * sample_rate) / 1000;
        let mut end_sample = (end_ms as usize * sample_rate) / 1000;

        if start_sample >= samples.len() {
            return Err("Başlangıç zamanı ses dosyasının toplam süresinden büyüktür.".to_string());
        }

        if end_sample > samples.len() {
            end_sample = samples.len();
        }

        let slice = &samples[start_sample..end_sample];
        if slice.is_empty() {
            return Err("Kırpılacak ses parçası boş.".to_string());
        }

        // Ensure parent dir exists
        if let Some(parent) = output_file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Dizin oluşturulamadı: {}", e))?;
        }

        let spec = WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        };

        let mut writer = WavWriter::create(output_file_path, spec)
            .map_err(|e| format!("WAV dosyası oluşturulamadı: {}", e))?;

        for &sample in slice {
            let clamped = sample.max(-1.0).min(1.0);
            let sample_i16 = (clamped * 32767.0) as i16;
            writer
                .write_sample(sample_i16)
                .map_err(|e| format!("Örnek yazılamadı: {}", e))?;
        }

        writer
            .finalize()
            .map_err(|e| format!("WAV dosyası kapatılamadı: {}", e))?;

        let duration_seconds = (slice.len() as f64) / (sample_rate as f64);
        let filename = output_file_path
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("soundbite.wav")
            .to_string();

        Ok(SoundbiteResult {
            file_path: output_file_path.to_string_lossy().to_string(),
            filename,
            duration_seconds: (duration_seconds * 10.0).round() / 10.0,
            start_ms,
            end_ms,
        })
    }

    /// Clips a segment from a meeting record and saves to $APP_DATA/soundbites/
    pub fn clip_meeting_segment(
        meeting_id: &str,
        segment_id: usize,
        start_ms: u64,
        end_ms: u64,
    ) -> Result<SoundbiteResult, String> {
        let storage = StorageEngine::new();
        let meetings_lock = storage.meetings.lock().unwrap();

        let target_meeting = meetings_lock
            .iter()
            .find(|m| m.id == meeting_id)
            .ok_or_else(|| format!("Toplantı bulunamadı: {}", meeting_id))?;

        let audio_path_str = target_meeting
            .audio_file_path
            .as_ref()
            .ok_or_else(|| "Bu toplantıya ait ses dosyası bulunmuyor.".to_string())?;

        let input_path = PathBuf::from(audio_path_str);
        let soundbites_dir = get_storage_dir().join("soundbites");
        let output_filename = format!("soundbite_{}_seg_{}.wav", meeting_id, segment_id);
        let output_path = soundbites_dir.join(output_filename);

        Self::clip_to_wav(&input_path, start_ms, end_ms, &output_path)
    }
}

#[tauri::command]
pub fn clip_meeting_soundbite(
    meeting_id: String,
    segment_id: usize,
    start_ms: u64,
    end_ms: u64,
) -> Result<SoundbiteResult, String> {
    AudioClipper::clip_meeting_segment(&meeting_id, segment_id, start_ms, end_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_times() {
        let dummy_input = PathBuf::from("non_existent_audio.wav");
        let dummy_output = PathBuf::from("dummy_out.wav");
        let res = AudioClipper::clip_to_wav(&dummy_input, 5000, 2000, &dummy_output);
        assert!(res.is_err());
    }
}
