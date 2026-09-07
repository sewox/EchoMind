export interface MemoryQueryOptions {
  query: string;
  speaker_filter?: string | null;
  min_score?: number | null;
}

export interface MemoryStats {
  total_meetings: number;
  total_segments: number;
  total_words: number;
  unique_speakers: string[];
}
