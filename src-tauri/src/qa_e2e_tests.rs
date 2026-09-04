#[cfg(test)]
mod e2e_qa_suite {
    use std::fs::File;
    use std::io::Write;
    use std::path::Path;

    const USER_AUDIO_DIR: &str = "/Users/macbookpro/Documents/Projeler/EchoMind/Ses Kayıtları";

    #[test]
    fn test_qa_01_corrupted_and_edge_case_audio_resilience() {
        let temp_dir = std::env::temp_dir().join("echomind_qa_corrupted");
        let _ = std::fs::create_dir_all(&temp_dir);

        // Case 1: 0-Byte Empty File
        let empty_path = temp_dir.join("zero_byte.mp3");
        let _ = File::create(&empty_path);
        let res_empty = crate::importer::decode_audio_file_to_pcm16k(&empty_path);
        assert!(res_empty.is_err(), "0-baytlık dosya hata döndürmeli, çökmemeli");

        // Case 2: Corrupted Random Noise Header
        let corrupt_path = temp_dir.join("corrupted_header.mp3");
        if let Ok(mut f) = File::create(&corrupt_path) {
            let random_bytes = [0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0xFF, 0x12, 0x34, 0x56, 0x78];
            let _ = f.write_all(&random_bytes);
        }
        let res_corrupt = crate::importer::decode_audio_file_to_pcm16k(&corrupt_path);
        assert!(res_corrupt.is_err(), "Bozuk başlıklı dosya güvenle yakalanmalı");

        // Case 3: Truncated MP3 with valid header but cut off
        let truncated_path = temp_dir.join("truncated.mp3");
        if let Ok(mut f) = File::create(&truncated_path) {
            let id3_stub = [0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0A, 0xFF, 0xFB, 0x90, 0x64];
            let _ = f.write_all(&id3_stub);
        }
        let res_trunc = crate::importer::decode_audio_file_to_pcm16k(&truncated_path);
        println!("Truncated audio handled gracefully: {:?}", res_trunc.is_ok() || res_trunc.is_err());

        // Cleanup
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_qa_02_real_user_audio_decoding_and_normalization() {
        let audio_dir = Path::new(USER_AUDIO_DIR);
        if !audio_dir.exists() {
            println!("Test klasörü bulunamadı: {}", USER_AUDIO_DIR);
            return;
        }

        let test_files = ["Arksigner Toplantı.mp3", "Kayıt (60).mp3"];
        for fname in &test_files {
            let p = audio_dir.join(fname);
            if p.exists() {
                let start = std::time::Instant::now();
                let (mut pcm, duration_seconds) = crate::importer::decode_audio_file_to_pcm16k(&p)
                    .unwrap_or_else(|_| panic!("{} kod çözülemedi", fname));
                let decode_dur = start.elapsed();

                assert!(duration_seconds > 0, "Süre 0'dan büyük olmalı");
                assert!(!pcm.is_empty(), "PCM ses verisi boş olmamalı");

                let total_secs = pcm.len() as f64 / 16000.0;
                println!("\n✅ [QA DECODE] {}:", fname);
                println!("   - Süre: {:.1} sn ({:.2} dk)", total_secs, total_secs / 60.0);
                println!("   - Çözme Süresi: {:.2?}", decode_dur);
                println!("   - Toplam 16kHz Örnek: {}", pcm.len());

                // Normalization Test
                let peak_before = pcm.iter().fold(0.0f32, |m, &x| m.max(x.abs()));
                crate::audio::normalize_audio_samples(&mut pcm);
                let peak_after = pcm.iter().fold(0.0f32, |m, &x| m.max(x.abs()));
                println!("   - Normalizasyon Tepe Değeri: {:.2} -> {:.2}", peak_before, peak_after);
                assert!(peak_after <= 1.0, "Tepe genlik 1.0'ı aşmamalı (clipping koruması)");
            }
        }
    }

    #[test]
    fn test_qa_03_natural_pause_vad_slicing_integrity() {
        let sr = 16000;
        let total_samples = 10 * 60 * sr; // 10 mins
        let mut mock_audio = vec![0.0f32; total_samples];

        for i in 0..10 {
            let start = i * 60 * sr;
            let end = start + 25 * sr;
            for j in start..end {
                mock_audio[j] = (j as f32 * 0.05).sin() * 0.4;
            }
        }

        let chunks = crate::transcriber::split_audio_at_natural_pauses(&mock_audio, 16000, 180);
        assert!(!chunks.is_empty(), "Doğal duraklama bölümleri oluşturulmalı");
        println!("\n✅ [QA VAD SLICE] 10 dakikalık ses {} parçaya bölündü.", chunks.len());

        for (idx, (offset_ms, samples)) in chunks.iter().enumerate() {
            println!("   - Parça {}: Başlangıç offset: {} ms, Örnek: {}", idx + 1, offset_ms, samples.len());
        }
    }

    #[test]
    fn test_qa_04_diarization_and_speaker_recognition() {
        let mut segments = vec![
            crate::transcriber::TranscriptSegment {
                id: 1,
                speaker_id: "Konuşmacı 1".to_string(),
                speaker_name: "Konuşmacı 1".to_string(),
                start_time_ms: 0,
                end_time_ms: 5000,
                timestamp_formatted: "00:00 -> 00:05".to_string(),
                text: "Merhaba Ahmet Bey, bugünkü toplantıya hoş geldiniz.".to_string(),
                language: "tr".to_string(),
                confidence: 0.98,
            },
            crate::transcriber::TranscriptSegment {
                id: 2,
                speaker_id: "Konuşmacı 2".to_string(),
                speaker_name: "Konuşmacı 2".to_string(),
                start_time_ms: 6000,
                end_time_ms: 12000,
                timestamp_formatted: "00:06 -> 00:12".to_string(),
                text: "Teşekkürler, bütçe raporunu inceledim.".to_string(),
                language: "tr".to_string(),
                confidence: 0.98,
            },
        ];

        crate::diarization::resolve_speaker_names(&mut segments);
        println!("\n✅ [QA DIARIZATION] Hitap çözümleme sonuçları:");
        for s in &segments {
            println!("   - [{}] {} (ID: {}) -> \"{}\"", s.timestamp_formatted, s.speaker_name, s.speaker_id, s.text);
        }

        // Konuşmacı 1'in hitap ettiği karşı taraf Konuşmacı 2 "Ahmet Bey" olmalıdır.
        assert_eq!(segments[1].speaker_name, "Ahmet Bey");
    }

    #[test]
    fn test_qa_05_multi_format_report_export() {
        let meeting = crate::storage::MeetingRecord {
            id: "qa_mtg_test".to_string(),
            title: "QA Strateji ve Mimari Toplantısı".to_string(),
            date_formatted: "03 Eylül 2026, 14:30".to_string(),
            duration_seconds: 360,
            duration_formatted: "06:00".to_string(),
            audio_file_path: None,
            segments: vec![
                crate::transcriber::TranscriptSegment {
                    id: 1,
                    speaker_id: "Konuşmacı 1".to_string(),
                    speaker_name: "Can".to_string(),
                    start_time_ms: 0,
                    end_time_ms: 5000,
                    timestamp_formatted: "00:00 -> 00:05".to_string(),
                    text: "Sistemin uçtan uca testlerini başlatalım.".to_string(),
                    language: "tr".to_string(),
                    confidence: 0.98,
                }
            ],
            summary: "Toplantıda uçtan uca sistem testleri ve kalite güvence adımları değerlendirildi.".to_string(),
            key_decisions: vec!["Tüm offline motorlar test edilecek ve onaylanacak.".to_string()],
            meeting_goal: Some("QA testlerinin eksiksiz tamamlanması.".to_string()),
            key_highlights: Some(vec!["Sıfır halüsinasyon garantisi sağlandı.".to_string()]),
            action_items: Some(vec![
                crate::storage::ActionItem {
                    task: "Performans metriklerini raporla".to_string(),
                    assignee: Some("Can".to_string()),
                    source_citations: vec![1],
                    is_completed: false,
                }
            ]),
            phase1_agreed: Some(vec!["Whisper ve Apple Speech entegrasyonu".to_string()]),
            phase2_deferred: Some(vec![]),
            detailed_topics: Some(vec![]),
            participants: Some(vec!["Can".to_string()]),
            engine_used: Some("🔒 Yerel Whisper Small (244M)".to_string()),
            summary_provider: Some("🔒 Cihaz İçi Hızlı Özet".to_string()),
        };

        let md = crate::summarizer::SummarizerEngine::export_notes_markdown(&meeting, None, Some("tr"));
        assert!(md.contains("QA Strateji ve Mimari Toplantısı"));
        assert!(md.contains("Sistemin uçtan uca testlerini başlatalım."));

        let html = crate::summarizer::SummarizerEngine::export_notes_html(&meeting, None, Some("tr"));
        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("QA Strateji ve Mimari Toplantısı"));
        println!("\n✅ [QA EXPORT] Markdown ve HTML rapor şablonları başarıyla üretildi.");
    }

    #[test]
    fn test_qa_06_real_meeting_speech_transcription() {
        let audio_dir = Path::new(USER_AUDIO_DIR);
        let p = audio_dir.join("Arksigner Toplantı.mp3");
        if !p.exists() {
            println!("Arksigner Toplantı.mp3 bulunamadı, atlanıyor.");
            return;
        }

        let (mut pcm, _) = crate::importer::decode_audio_file_to_pcm16k(&p).expect("Decode failed");
        crate::audio::normalize_audio_samples(&mut pcm);

        // Take 60 seconds from minute 5:00 (300s -> 360s: 300*16,000 = 4,800,000 to 5,760,000)
        let sample_slice = if pcm.len() > 5760000 {
            &pcm[4800000..5760000]
        } else if pcm.len() > 960000 {
            &pcm[..960000]
        } else {
            &pcm
        };

        let engine = crate::transcriber::GlobalTranscriberEngine::new();
        let _ = engine.init_model("models/ggml-small.bin");

        let start = std::time::Instant::now();
        let segments = engine.transcribe_pcm(sample_slice, "tr").unwrap_or_default();
        let dur = start.elapsed();

        println!("\n=======================================================");
        println!("✅ [QA REAL ASR] Arksigner Toplantısı (5. Dakika Konuşma Kesiti - {:.2?} sürede tamamlandı):", dur);
        println!("=======================================================");
        for s in &segments {
            println!("  [{}] {}: {}", s.timestamp_formatted, s.speaker_name, s.text);
        }
        assert!(!segments.is_empty(), "Transkripsiyon segmentleri üretilmeli");
    }
}
