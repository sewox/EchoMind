export interface SpeakerAnalytics {
  speaker_id: string;
  speaker_name: string;
  total_speech_seconds: number;
  talk_percentage: number;
  word_count: number;
  wpm: number;
  segment_count: number;
  longest_monologue_seconds: number;
}

export interface MeetingAnalytics {
  total_duration_seconds: number;
  total_speech_seconds: number;
  total_silence_seconds: number;
  silence_percentage: number;
  total_words: number;
  average_wpm: number;
  meeting_balance_score: number; // 0 - 100
  speaker_stats: SpeakerAnalytics[];
  dominant_speaker: string | null;
  dominant_speaker_percentage: number;
  meeting_pace_label: "Fast" | "Moderate" | "Calm" | string;
  key_insights: string[];
}
