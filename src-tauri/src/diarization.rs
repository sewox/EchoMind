use crate::transcriber::TranscriptSegment;
use regex::Regex;
use std::collections::HashMap;

/// 8-Band spectral energy profile representing the vocal tract filter envelope
#[derive(Debug, Clone)]
pub struct AcousticFeatures {
    pub pitch_f0: f32,             // Median fundamental frequency in Hz (80 Hz - 400 Hz)
    pub spectral_bands: [f32; 8],  // 8-band log-energy spectral distribution
    pub zero_crossing_rate: f32,   // Phonetic articulation speed
    pub rms_energy: f32,           // Segment volume dynamics
    pub voiced_frame_count: usize, // Number of valid voiced speech frames
}

impl Default for AcousticFeatures {
    fn default() -> Self {
        Self {
            pitch_f0: 150.0,
            spectral_bands: [0.35355339; 8],
            zero_crossing_rate: 0.05,
            rms_energy: 0.05,
            voiced_frame_count: 0,
        }
    }
}

/// Extract frame-by-frame acoustic features across the ENTIRE segment (32ms frames with 16ms hop)
pub fn extract_segment_features(samples: &[f32], sample_rate: u32) -> AcousticFeatures {
    if samples.is_empty() {
        return AcousticFeatures::default();
    }

    let frame_size = ((sample_rate as f32) * 0.032) as usize; // 32ms (~512 samples at 16kHz)
    let hop_size = ((sample_rate as f32) * 0.016) as usize;   // 16ms (~256 samples at 16kHz)

    if samples.len() < frame_size {
        // Fallback for extremely short bursts
        let mut feats = AcousticFeatures::default();
        feats.rms_energy = (samples.iter().map(|&s| s * s).sum::<f32>() / samples.len().max(1) as f32).sqrt();
        return feats;
    }

    let min_lag = (sample_rate / 400) as usize; // ~40 samples (400 Hz)
    let max_lag = (sample_rate / 80) as usize;  // ~200 samples (80 Hz)

    let mut pitch_list: Vec<f32> = Vec::new();
    let mut band_energy_accum = [0.0f32; 8];
    let mut zcr_sum = 0.0f32;
    let mut rms_sum = 0.0f32;
    let mut total_voiced_frames = 0;

    let num_frames = (samples.len() - frame_size) / hop_size + 1;

    for f_idx in 0..num_frames {
        let start = f_idx * hop_size;
        let end = start + frame_size;
        let frame = &samples[start..end];

        // Frame Energy
        let frame_sum_sq: f32 = frame.iter().map(|&s| s * s).sum();
        let frame_rms = (frame_sum_sq / frame_size as f32).sqrt();

        // Skip silent or background noise frames
        if frame_rms < 0.005 {
            continue;
        }

        // Zero-Crossing Rate
        let mut zc = 0;
        for i in 1..frame_size {
            if (frame[i] >= 0.0 && frame[i - 1] < 0.0) || (frame[i] < 0.0 && frame[i - 1] >= 0.0) {
                zc += 1;
            }
        }
        let frame_zcr = (zc as f32) / (frame_size as f32);

        // Autocorrelation Pitch Estimation for Voiced Frames
        let mut best_lag = 0;
        let mut best_corr = -1.0f32;

        for lag in min_lag..=max_lag.min(frame_size / 2) {
            let mut corr = 0.0f32;
            let count = frame_size - lag;
            for i in 0..count {
                corr += frame[i] * frame[i + lag];
            }
            corr /= count as f32;

            if corr > best_corr {
                best_corr = corr;
                best_lag = lag;
            }
        }

        // Check if periodicity is strong enough (Voiced speech indication)
        let is_voiced = best_corr > (frame_sum_sq / frame_size as f32) * 0.28 && best_lag > 0;

        if is_voiced {
            let f0 = (sample_rate as f32) / (best_lag as f32);
            if (80.0..=380.0).contains(&f0) {
                pitch_list.push(f0);
            }
        }

        // 8-Band Spectral Distribution Approximation (Vocal Tract Resonances)
        let mut frame_bands = [0.0f32; 8];
        let sub_chunk = frame_size / 8;
        for b in 0..8 {
            let b_start = b * sub_chunk;
            let b_end = (b + 1) * sub_chunk;
            let b_energy: f32 = frame[b_start..b_end].iter().map(|&s| s * s).sum();
            frame_bands[b] = (b_energy / sub_chunk as f32).sqrt();
            band_energy_accum[b] += frame_bands[b];
        }

        zcr_sum += frame_zcr;
        rms_sum += frame_rms;
        total_voiced_frames += 1;
    }

    if total_voiced_frames == 0 {
        return AcousticFeatures::default();
    }

    // Median Pitch (much more robust than arithmetic mean against outliers)
    pitch_list.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median_pitch = if !pitch_list.is_empty() {
        pitch_list[pitch_list.len() / 2]
    } else {
        150.0
    };

    // Normalize Spectral Energy Vector to Unit Magnitude (L2 Norm)
    let mut normalized_bands = [0.0f32; 8];
    let norm_denom = band_energy_accum.iter().map(|&e| e * e).sum::<f32>().sqrt();
    if norm_denom > 0.0001 {
        for b in 0..8 {
            normalized_bands[b] = band_energy_accum[b] / norm_denom;
        }
    } else {
        normalized_bands = [0.125; 8];
    }

    AcousticFeatures {
        pitch_f0: median_pitch,
        spectral_bands: normalized_bands,
        zero_crossing_rate: zcr_sum / (total_voiced_frames as f32),
        rms_energy: rms_sum / (total_voiced_frames as f32),
        voiced_frame_count: total_voiced_frames,
    }
}

/// Compute cosine distance between two spectral profiles + normalized pitch distance
pub fn acoustic_distance(a: &AcousticFeatures, b: &AcousticFeatures) -> f32 {
    // 1. Cosine Distance on 8-Band Spectral Profile (Vocal Tract Envelope)
    let dot: f32 = a.spectral_bands.iter().zip(b.spectral_bands.iter()).map(|(&x, &y)| x * y).sum();
    let spectral_cosine_dist = (1.0 - dot).clamp(0.0, 2.0);

    // 2. Relative Pitch ($F_0$) Distance
    let pitch_diff = (a.pitch_f0 - b.pitch_f0).abs();
    let pitch_mean = (a.pitch_f0 + b.pitch_f0) * 0.5 + 1.0;
    let pitch_dist = (pitch_diff / pitch_mean).clamp(0.0, 1.5);

    // 3. ZCR Distance (Phonetic Pace)
    let zcr_dist = (a.zero_crossing_rate - b.zero_crossing_rate).abs() / 0.15;

    // Weighted acoustic combination
    (spectral_cosine_dist * 0.60) + (pitch_dist * 0.30) + (zcr_dist.clamp(0.0, 1.0) * 0.10)
}

/// Global Agglomerative Hierarchical Clustering (AHC) + Temporal Continuity Smoothing
pub fn cluster_speakers(
    segments: &mut [TranscriptSegment],
    full_pcm: &[f32],
    sample_rate: u32,
    max_speakers: usize,
) {
    if segments.is_empty() {
        return;
    }

    let num_segs = segments.len();
    let max_k = max_speakers.clamp(1, 8);
    let mut features: Vec<AcousticFeatures> = Vec::with_capacity(num_segs);

    // 1. Extract high-resolution acoustic voice features for each segment
    for seg in segments.iter() {
        let start_sample = ((seg.start_time_ms as usize) * (sample_rate as usize)) / 1000;
        let end_sample = ((seg.end_time_ms as usize) * (sample_rate as usize)) / 1000;

        let start_idx = start_sample.min(full_pcm.len());
        let end_idx = end_sample.min(full_pcm.len());

        let slice = if start_idx < end_idx {
            &full_pcm[start_idx..end_idx]
        } else {
            &[]
        };

        features.push(extract_segment_features(slice, sample_rate));
    }

    // 2. Agglomerative Hierarchical Clustering (AHC)
    let mut cluster_assignments: Vec<usize> = (0..num_segs).collect();
    let merge_distance_threshold = 0.46; // Calibrated acoustic boundary threshold

    loop {
        let mut unique_clusters: Vec<usize> = cluster_assignments.clone();
        unique_clusters.sort_unstable();
        unique_clusters.dedup();

        if unique_clusters.len() <= 1 {
            break;
        }

        let mut best_i = 0;
        let mut best_j = 0;
        let mut min_cluster_dist = f32::MAX;

        for i in 0..unique_clusters.len() {
            let c_i = unique_clusters[i];
            let segs_i: Vec<usize> = cluster_assignments.iter().enumerate().filter_map(|(idx, &c)| if c == c_i { Some(idx) } else { None }).collect();

            for j in (i + 1)..unique_clusters.len() {
                let c_j = unique_clusters[j];
                let segs_j: Vec<usize> = cluster_assignments.iter().enumerate().filter_map(|(idx, &c)| if c == c_j { Some(idx) } else { None }).collect();

                let mut dist_sum = 0.0f32;
                let mut pairs = 0;

                for &si in &segs_i {
                    for &sj in &segs_j {
                        dist_sum += acoustic_distance(&features[si], &features[sj]);
                        pairs += 1;
                    }
                }

                let avg_dist = if pairs > 0 { dist_sum / (pairs as f32) } else { f32::MAX };

                if avg_dist < min_cluster_dist {
                    min_cluster_dist = avg_dist;
                    best_i = c_i;
                    best_j = c_j;
                }
            }
        }

        if min_cluster_dist > merge_distance_threshold && unique_clusters.len() <= max_k {
            break;
        }

        if min_cluster_dist >= f32::MAX {
            break;
        }

        for c in cluster_assignments.iter_mut() {
            if *c == best_j {
                *c = best_i;
            }
        }
    }

    // 3. Temporal Continuity Smoothing (Markov Continuity Pass)
    for i in 0..(num_segs.saturating_sub(1)) {
        let gap_ms = segments[i + 1].start_time_ms.saturating_sub(segments[i].end_time_ms);
        if gap_ms < 1200 {
            let dist = acoustic_distance(&features[i], &features[i + 1]);
            if dist < 0.48 {
                cluster_assignments[i + 1] = cluster_assignments[i];
            }
        }
    }

    // Smooth single-segment isolated blips
    for i in 1..(num_segs.saturating_sub(1)) {
        if cluster_assignments[i - 1] == cluster_assignments[i + 1]
            && cluster_assignments[i] != cluster_assignments[i - 1]
        {
            let seg_dur_ms = segments[i].end_time_ms.saturating_sub(segments[i].start_time_ms);
            if seg_dur_ms < 2500 {
                let dist_to_neighbor = acoustic_distance(&features[i], &features[i - 1]);
                if dist_to_neighbor < 0.52 {
                    cluster_assignments[i] = cluster_assignments[i - 1];
                }
            }
        }
    }

    // 4. Remap cluster IDs to contiguous 1..N speaker labels
    let mut cluster_to_speaker: HashMap<usize, usize> = HashMap::new();
    let mut speaker_seq = 1;

    for (idx, seg) in segments.iter_mut().enumerate() {
        let raw_c = cluster_assignments[idx];
        let spk_num = *cluster_to_speaker.entry(raw_c).or_insert_with(|| {
            let num = speaker_seq;
            speaker_seq += 1;
            num
        });

        seg.speaker_id = format!("Konuşmacı {}", spk_num);
        seg.speaker_name = format!("Konuşmacı {}", spk_num);
    }
}

/// Automatically extract speaker names from English & Turkish self-introductions, vocatives, and turn-taking dialogues
pub fn resolve_speaker_names(segments: &mut [TranscriptSegment]) {
    if segments.is_empty() {
        return;
    }

    // Multi-lingual Regex Patterns (English & Turkish)
    let tr_intro_regex = Regex::new(r"(?i)\b(benim adım|benim ismim|adım|ismim)\s+([A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,})\b").unwrap();
    let en_intro_regex = Regex::new(r"(?i)\b(my name is|i am|i'm)\s+([A-Z][a-z]{2,})\b").unwrap();
    let en_this_is_regex = Regex::new(r"(?i)\b(this is)\s+([A-Z][a-z]{2,})\s+(speaking|here|from|calling)\b").unwrap();

    let tr_vocative_regex = Regex::new(r"\b([A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,})\s+(Bey|Hanım|Hocam)\b").unwrap();
    let en_vocative_regex = Regex::new(r"(?i)\b(hey|thanks|thank you|go ahead|over to you|what do you think)\s+([A-Z][a-z]{2,})\b").unwrap();
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
            let is_3rd_person = lower.contains("görüştük") || lower.contains("konuştuk") || lower.contains("dedi") || lower.contains("ile");
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
                let full = format!("{} {}", title.as_str(), capitalize_first(name_match.as_str()));
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
        "evet", "hayır", "tamam", "peki", "yani", "olur", "çünkü", "bence", "zaten", "artık",
        "tabii", "tabi", "öyle", "böyle", "şöyle", "nasıl", "neden", "niçin", "nerede", "kim",
        "bir", "iki", "üç", "dört", "beş", "on", "yüz", "bin", "lütfen", "merhaba", "selam",
        "burada", "şurada", "orada", "şimdi", "sonra", "önce", "kadar", "gibi", "ile", "için",
        "fakat", "lakin", "ancak", "çünkü", "veya", "yahut", "belki", "kesinlikle", "aslında",
        // English
        "yes", "no", "not", "okay", "ok", "right", "sure", "well", "hello", "hi", "hey", "thanks", "thank",
        "good", "great", "now", "here", "there", "today", "yesterday", "tomorrow", "everyone",
        "all", "guys", "folks", "team", "people", "morning", "afternoon", "evening", "also", "just",
        "this", "that", "these", "those", "what", "where", "when", "why", "how", "who", "which",
        "have", "having", "had", "has", "been", "being", "will", "would", "shall", "should", "can",
        "could", "may", "might", "must", "done", "doing", "does", "think", "thinking", "thought",
        "going", "trying", "saying", "said", "tell", "telling", "told", "really", "very", "much",
        "more", "most", "some", "any", "other", "another", "such", "only", "own", "same", "so",
        "than", "too", "very", "just", "about", "above", "after", "again", "against", "because",
        "before", "below", "between", "both", "during", "each", "few", "from", "further", "into",
        "through", "under", "until", "while", "with", "without", "able", "unable", "happy", "sorry"
    ];
    stopwords.contains(&lower.as_str()) || lower.len() < 3
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_segment_features() {
        let pcm = vec![0.1f32; 16000];
        let feats = extract_segment_features(&pcm, 16000);
        assert!(feats.pitch_f0 > 0.0);
        assert_eq!(feats.spectral_bands.len(), 8);
    }

    #[test]
    fn test_acoustic_distance_stability() {
        let mut a = AcousticFeatures::default();
        a.pitch_f0 = 130.0;
        let mut b = AcousticFeatures::default();
        b.pitch_f0 = 140.0;

        let dist = acoustic_distance(&a, &b);
        assert!(dist < 0.3); // Close pitch should have low acoustic distance
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
}
