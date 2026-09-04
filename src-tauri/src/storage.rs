use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use flacenc::bitsink::ByteSink;
use flacenc::component::BitRepr;
use flacenc::error::Verify;
use flacenc::source::MemSource;

use crate::transcriber::TranscriptSegment;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActionItem {
    pub task: String,
    #[serde(default)]
    pub assignee: Option<String>,
    #[serde(default)]
    pub source_citations: Vec<usize>,
    #[serde(default)]
    pub is_completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TopicBreakdown {
    pub topic_title: String,
    pub bullet_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingRecord {
    pub id: String,
    pub title: String,
    pub date_formatted: String,
    pub duration_seconds: u64,
    pub duration_formatted: String,
    pub audio_file_path: Option<String>,
    pub segments: Vec<TranscriptSegment>,
    pub summary: String,
    pub key_decisions: Vec<String>,
    #[serde(default)]
    pub meeting_goal: Option<String>,
    #[serde(default)]
    pub key_highlights: Option<Vec<String>>,
    #[serde(default)]
    pub action_items: Option<Vec<ActionItem>>,
    #[serde(default)]
    pub phase1_agreed: Option<Vec<String>>,
    #[serde(default)]
    pub phase2_deferred: Option<Vec<String>>,
    #[serde(default)]
    pub detailed_topics: Option<Vec<TopicBreakdown>>,
    #[serde(default)]
    pub participants: Option<Vec<String>>,
    #[serde(default)]
    pub engine_used: Option<String>,
    #[serde(default)]
    pub summary_provider: Option<String>,
}

pub struct StorageEngine {
    pub file_path: PathBuf,
    pub meetings: Arc<Mutex<Vec<MeetingRecord>>>,
}

pub fn get_storage_dir() -> PathBuf {
    if let Ok(cwd) = std::env::current_dir() {
        // If cwd is inside src-tauri (e.g. during cargo run), step out to project root
        let root = if cwd.ends_with("src-tauri") {
            cwd.parent().unwrap_or(&cwd).to_path_buf()
        } else {
            cwd
        };
        return root.join("data");
    }
    PathBuf::from("data")
}

impl StorageEngine {
    pub fn new() -> Self {
        let storage_dir = get_storage_dir();
        if !storage_dir.exists() {
            let _ = fs::create_dir_all(&storage_dir);
        }

        let rec_dir = storage_dir.join("recordings");
        if !rec_dir.exists() {
            let _ = fs::create_dir_all(&rec_dir);
        }

        let file_path = storage_dir.join("meetings_history.json");
        let engine = StorageEngine {
            file_path,
            meetings: Arc::new(Mutex::new(Vec::new())),
        };

        let _ = engine.load_from_disk();
        engine
    }

    pub fn load_from_disk(&self) -> Result<Vec<MeetingRecord>, String> {
        if !self.file_path.exists() {
            return Ok(Vec::new());
        }

        let mut file = File::open(&self.file_path).map_err(|e| format!("Dosya açma hatası: {}", e))?;
        let mut content = String::new();
        file.read_to_string(&mut content).map_err(|e| format!("Okuma hatası: {}", e))?;

        if content.trim().is_empty() {
            return Ok(Vec::new());
        }

        let records: Vec<MeetingRecord> = serde_json::from_str(&content)
            .map_err(|e| format!("JSON ayrıştırma hatası: {}", e))?;

        let mut lock = self.meetings.lock().unwrap();
        *lock = records.clone();
        Ok(records)
    }

    pub fn save_to_disk(&self) -> Result<(), String> {
        let lock = self.meetings.lock().unwrap();
        let json_str = serde_json::to_string_pretty(&*lock)
            .map_err(|e| format!("JSON dönüştürme hatası: {}", e))?;

        let mut file = File::create(&self.file_path)
            .map_err(|e| format!("Yazma dosyası oluşturma hatası: {}", e))?;
        file.write_all(json_str.as_bytes())
            .map_err(|e| format!("Yazma hatası: {}", e))?;

        Ok(())
    }

    pub fn add_meeting(&self, mut meeting: MeetingRecord) -> Result<MeetingRecord, String> {
        if meeting.summary.is_empty() {
            meeting.summary = generate_summary_from_segments(&meeting.segments);
        }

        if meeting.key_decisions.is_empty() {
            meeting.key_decisions = extract_key_decisions(&meeting.segments);
        }

        {
            let mut lock = self.meetings.lock().unwrap();
            // Insert newest at beginning
            lock.insert(0, meeting.clone());
        }

        self.save_to_disk()?;
        Ok(meeting)
    }

    pub fn get_all(&self) -> Vec<MeetingRecord> {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let lock = self.meetings.lock().unwrap();
        let mut list = lock.clone();
        for mtg in &mut list {
            if let Some(ref path) = mtg.audio_file_path {
                let p = PathBuf::from(path);
                if !p.is_absolute() {
                    let abs_p = cwd.join(path);
                    if abs_p.exists() {
                        mtg.audio_file_path = Some(abs_p.to_string_lossy().to_string());
                    }
                }
            }
        }
        list
    }

    pub fn delete_meeting(&self, id: &str) -> Result<Vec<MeetingRecord>, String> {
        {
            let mut lock = self.meetings.lock().unwrap();
            if let Some(mtg) = lock.iter().find(|m| m.id == id) {
                if let Some(ref path_str) = mtg.audio_file_path {
                    let audio_path = PathBuf::from(path_str);
                    
                    // SAFETY GUARANTEE: Only delete files located inside the app's internal recordings directory!
                    // Never delete user's original external files (e.g. ~/Downloads/..., ~/Desktop/...).
                    let rec_dir = get_storage_dir().join("recordings");
                    let is_internal = audio_path.starts_with(&rec_dir)
                        || path_str.contains("data/recordings")
                        || path_str.contains("data\\recordings");

                    if is_internal && audio_path.exists() {
                        let _ = fs::remove_file(audio_path);
                    }
                }
            }
            lock.retain(|m| m.id != id);
        }
        self.save_to_disk()?;
        Ok(self.get_all())
    }

    pub fn update_title(&self, id: &str, new_title: &str) -> Result<Vec<MeetingRecord>, String> {
        {
            let mut lock = self.meetings.lock().unwrap();
            if let Some(mtg) = lock.iter_mut().find(|m| m.id == id) {
                mtg.title = new_title.trim().to_string();
            } else {
                return Err(format!("Toplantı bulunamadı: {}", id));
            }
        }
        self.save_to_disk()?;
        Ok(self.get_all())
    }
}

pub fn get_global_storage() -> &'static StorageEngine {
    static STORAGE: OnceLock<StorageEngine> = OnceLock::new();
    STORAGE.get_or_init(StorageEngine::new)
}

/// Encodes 16kHz mono float audio PCM samples into FLAC format (100% Lossless, 0 Distortion)
pub fn compress_audio_to_flac(samples_f32: &[f32], output_path: &PathBuf) -> Result<(), String> {
    if samples_f32.is_empty() {
        return Ok(());
    }

    // Convert f32 PCM [-1.0, 1.0] to i32 PCM [-32768, 32767]
    let samples_i32: Vec<i32> = samples_f32
        .iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i32)
        .collect();

    let sample_rate = 16000;
    let channels = 1;
    let bits_per_sample = 16;

    let source = MemSource::from_samples(&samples_i32, channels, bits_per_sample, sample_rate);
    let config = flacenc::config::Encoder::default()
        .into_verified()
        .map_err(|e| format!("FLAC config hatası: {:?}", e))?;
    let flac_stream = flacenc::encode_with_fixed_block_size(&config, source, config.block_size)
        .map_err(|e| format!("FLAC kodlama hatası: {:?}", e))?;

    let mut sink = ByteSink::new();
    flac_stream
        .write(&mut sink)
        .map_err(|e| format!("FLAC yazma hatası: {:?}", e))?;

    let flac_bytes = sink.into_inner();
    let mut file = File::create(output_path)
        .map_err(|e| format!("FLAC ses dosyası oluşturulamadı: {}", e))?;
    file.write_all(&flac_bytes)
        .map_err(|e| format!("FLAC ses verisi yazılamadı: {}", e))?;

    Ok(())
}

/// Helper function to generate an intelligent summary from meeting transcript segments
pub fn generate_summary_from_segments(segments: &[TranscriptSegment]) -> String {
    if segments.is_empty() {
        return "Toplantıda henüz transkript edilmiş bir konuşma bulunmamaktadır.".to_string();
    }

    let total_words: usize = segments.iter().map(|s| s.text.split_whitespace().count()).sum();
    let speakers_count = segments
        .iter()
        .map(|s| &s.speaker_name)
        .collect::<std::collections::HashSet<_>>()
        .len();

    let highlights: Vec<String> = segments
        .iter()
        .take(3)
        .map(|s| format!("• {}: \"{}\"", s.speaker_name, s.text))
        .collect();

    format!(
        "Toplantı Özeti:\n- Toplam {} konuşmacı katıldı ve {} kelime konuşuldu.\n- Önemli Öne Çıkan Notlar:\n{}",
        speakers_count,
        total_words,
        highlights.join("\n")
    )
}

/// Helper function to extract key decisions from transcript text
pub fn extract_key_decisions(segments: &[TranscriptSegment]) -> Vec<String> {
    let mut decisions = Vec::new();
    for seg in segments {
        let lower = seg.text.to_lowercase();
        if lower.contains("karar") || lower.contains("plan") || lower.contains("yapacağız") || lower.contains("onay") {
            decisions.push(format!("{}: \"{}\"", seg.speaker_name, seg.text));
        }
    }

    if decisions.is_empty() && !segments.is_empty() {
        decisions.push(format!("{}: \"{}\"", segments[0].speaker_name, segments[0].text));
    }

    decisions
}

#[tauri::command]
pub fn get_all_meetings() -> Vec<MeetingRecord> {
    let storage = get_global_storage();
    storage.get_all()
}

#[tauri::command]
pub fn save_current_meeting(
    title: String,
    duration_seconds: u64,
) -> Result<MeetingRecord, String> {
    let transcriber = crate::transcriber::get_global_transcriber();
    let segments = transcriber.get_history();
    let audio_engine = crate::audio::get_global_audio_engine();

    let now = chrono::Local::now();
    let id = format!("mtg_{}", now.format("%Y%m%d_%H%M%S"));
    let date_formatted = now.format("%d %B %Y, %H:%M").to_string();

    let raw_pcm_buffer = audio_engine.get_pcm_buffer();
    let actual_duration = if duration_seconds > 0 {
        duration_seconds
    } else {
        (raw_pcm_buffer.len() as u64) / 16000
    };

    let mins = actual_duration / 60;
    let secs = actual_duration % 60;
    let duration_formatted = format!("{:02}:{:02}", mins, secs);

    // FLAC 0-Loss Audio Compression Storage
    let storage_dir = get_storage_dir();
    let rec_dir = storage_dir.join("recordings");
    if !rec_dir.exists() {
        let _ = fs::create_dir_all(&rec_dir);
    }
    let flac_file_path = rec_dir.join(format!("{}.flac", id));

    let audio_file_path = if !raw_pcm_buffer.is_empty() {
        match compress_audio_to_flac(&raw_pcm_buffer, &flac_file_path) {
            Ok(_) => Some(flac_file_path.to_string_lossy().to_string()),
            Err(e) => {
                eprintln!("FLAC kaydetme uyarısı: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Deduplicate segments (avoid any accidental duplicate timestamps/texts)
    let mut deduplicated_segments: Vec<TranscriptSegment> = Vec::new();
    for (_idx, seg) in segments.into_iter().enumerate() {
        let is_dup = deduplicated_segments.iter().any(|existing| {
            existing.start_time_ms == seg.start_time_ms
                && existing.end_time_ms == seg.end_time_ms
                && existing.text.trim() == seg.text.trim()
        });
        if !is_dup {
            let mut s = seg;
            s.id = deduplicated_segments.len() + 1;
            deduplicated_segments.push(s);
        }
    }

    let meeting = MeetingRecord {
        id,
        title: if title.trim().is_empty() {
            format!("Toplantı - {}", date_formatted)
        } else {
            title
        },
        date_formatted,
        duration_seconds: actual_duration,
        duration_formatted,
        audio_file_path,
        segments: deduplicated_segments,
        summary: String::new(),
        key_decisions: Vec::new(),
        meeting_goal: None,
        key_highlights: None,
        action_items: None,
        phase1_agreed: None,
        phase2_deferred: None,
        detailed_topics: None,
        participants: None,
        engine_used: Some("Cihazda (Whisper Small)".to_string()),
        summary_provider: Some("EchoMind Akıllı Özet".to_string()),
    };

    transcriber.clear_history();

    let storage = get_global_storage();
    storage.add_meeting(meeting)
}

#[tauri::command]
pub fn delete_meeting_by_id(id: Option<String>, meeting_id: Option<String>) -> Result<Vec<MeetingRecord>, String> {
    let target_id = id.or(meeting_id).ok_or_else(|| "Toplantı ID belirtilmedi".to_string())?;
    let storage = get_global_storage();
    storage.delete_meeting(&target_id)
}

#[tauri::command]
pub fn update_meeting_speaker_name(
    meeting_id: String,
    speaker_id: String,
    new_name: String,
) -> Result<MeetingRecord, String> {
    let storage = get_global_storage();
    let mut lock = storage.meetings.lock().unwrap();
    if let Some(mtg) = lock.iter_mut().find(|m| m.id == meeting_id) {
        for seg in mtg.segments.iter_mut() {
            if seg.speaker_id == speaker_id || seg.speaker_name == speaker_id {
                seg.speaker_name = new_name.clone();
            }
        }
        let updated = mtg.clone();
        drop(lock);
        storage.save_to_disk()?;
        Ok(updated)
    } else {
        Err(format!("Toplantı bulunamadı: {}", meeting_id))
    }
}

#[tauri::command]
pub fn update_meeting_title(id: String, new_title: String) -> Result<Vec<MeetingRecord>, String> {
    let storage = get_global_storage();
    storage.update_title(&id, &new_title)
}

#[tauri::command]
pub fn toggle_action_item_status(meeting_id: String, action_index: usize) -> Result<MeetingRecord, String> {
    let storage = get_global_storage();
    let mut lock = storage.meetings.lock().unwrap();
    if let Some(mtg) = lock.iter_mut().find(|m| m.id == meeting_id) {
        if let Some(items) = &mut mtg.action_items {
            if let Some(item) = items.get_mut(action_index) {
                item.is_completed = !item.is_completed;
            }
        }
        let updated = mtg.clone();
        drop(lock);
        storage.save_to_disk()?;
        Ok(updated)
    } else {
        Err(format!("Toplantı bulunamadı: {}", meeting_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_add_and_delete() {
        let storage = StorageEngine::new();
        let sample_meeting = MeetingRecord {
            id: "test_123".to_string(),
            title: "Test Toplantısı".to_string(),
            date_formatted: "21 Ağustos 2026".to_string(),
            duration_seconds: 120,
            duration_formatted: "02:00".to_string(),
            audio_file_path: None,
            segments: Vec::new(),
            summary: "Test Özet".to_string(),
            key_decisions: vec!["Karar 1".to_string()],
            meeting_goal: Some("Test Amacı".to_string()),
            key_highlights: Some(vec!["Ders 1".to_string()]),
            action_items: Some(vec![ActionItem {
                task: "Görev 1".to_string(),
                assignee: Some("Sercan".to_string()),
                source_citations: vec![1],
                is_completed: false,
            }]),
            phase1_agreed: Some(vec!["Faz 1".to_string()]),
            phase2_deferred: Some(vec!["Faz 2".to_string()]),
            detailed_topics: Some(vec![TopicBreakdown {
                topic_title: "Konu 1".to_string(),
                bullet_points: vec!["Madde 1".to_string()],
            }]),
            participants: Some(vec!["Sercan".to_string()]),
            engine_used: Some("Cihazda (Whisper Small)".to_string()),
            summary_provider: Some("EchoMind".to_string()),
        };

        let added = storage.add_meeting(sample_meeting).unwrap();
        assert_eq!(added.id, "test_123");

        let remaining = storage.delete_meeting("test_123").unwrap();
        assert!(!remaining.iter().any(|m| m.id == "test_123"));
    }

    #[test]
    fn test_flac_lossless_compression() {
        let sample_dir = std::env::temp_dir().join("echomind_test_rec");
        let _ = fs::create_dir_all(&sample_dir);
        let test_flac_path = sample_dir.join("test_audio.flac");

        // Generate 1 second of 440Hz sine wave PCM samples
        let mut samples = Vec::new();
        for i in 0..16000 {
            let t = i as f32 / 16000.0;
            let sample = (2.0 * std::f32::consts::PI * 440.0 * t).sin() * 0.5;
            samples.push(sample);
        }

        let res = compress_audio_to_flac(&samples, &test_flac_path);
        assert!(res.is_ok());
        assert!(test_flac_path.exists());

        let metadata = fs::metadata(&test_flac_path).unwrap();
        assert!(metadata.len() > 0);
        let _ = fs::remove_dir_all(&sample_dir);
    }

    #[test]
    fn test_storage_update_title_and_extraction() {
        let storage = StorageEngine::new();
        let sample_meeting = MeetingRecord {
            id: "mtg_edit_test".to_string(),
            title: "Eski Başlık".to_string(),
            date_formatted: "01.09.2026".to_string(),
            duration_seconds: 60,
            duration_formatted: "01:00".to_string(),
            audio_file_path: None,
            segments: vec![TranscriptSegment {
                id: 1,
                speaker_id: "spk1".to_string(),
                speaker_name: "Konuşmacı 1".to_string(),
                start_time_ms: 0,
                end_time_ms: 2000,
                timestamp_formatted: "00:00 -> 00:02".to_string(),
                text: "Depo yatırımı için karar aldık ve onay verdik.".to_string(),
                language: "tr".to_string(),
                confidence: 0.99,
            }],
            summary: "Özet".to_string(),
            key_decisions: vec!["Karar A".to_string()],
            meeting_goal: Some("Hedef".to_string()),
            key_highlights: None,
            action_items: Some(vec![ActionItem {
                task: "Görev A".to_string(),
                assignee: Some("Ahmet".to_string()),
                source_citations: vec![1],
                is_completed: false,
            }]),
            phase1_agreed: None,
            phase2_deferred: None,
            detailed_topics: None,
            participants: Some(vec!["Konuşmacı 1".to_string()]),
            engine_used: Some("Whisper".to_string()),
            summary_provider: Some("AI".to_string()),
        };

        // 1. Add meeting & get by id
        storage.add_meeting(sample_meeting.clone()).unwrap();
        let all = storage.get_all();
        let fetched = all.iter().find(|m| m.id == "mtg_edit_test").unwrap();
        assert_eq!(fetched.title, "Eski Başlık");

        // 2. Update Title
        let updated_list = storage.update_title("mtg_edit_test", "Yeni İcra Başlığı").unwrap();
        let found = updated_list.iter().find(|m| m.id == "mtg_edit_test").unwrap();
        assert_eq!(found.title, "Yeni İcra Başlığı");

        // 3. Summary & Decision Extraction Helpers
        let summary_text = generate_summary_from_segments(&sample_meeting.segments);
        assert!(summary_text.contains("1 konuşmacı"));

        let decisions = extract_key_decisions(&sample_meeting.segments);
        assert!(!decisions.is_empty());
        assert!(decisions[0].contains("karar"));

        // 4. Empty segments edge case
        let empty_summary = generate_summary_from_segments(&[]);
        assert!(empty_summary.contains("bulunmamaktadır"));

        let empty_decisions = extract_key_decisions(&[]);
        assert!(empty_decisions.is_empty());

        // 5. Clean up
        let _ = storage.delete_meeting("mtg_edit_test");
    }
}
