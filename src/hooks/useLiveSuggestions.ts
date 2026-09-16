import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LiveSuggestionItem } from "../types/suggestions";
import { TranscriptSegment } from "../components/TranscriptViewer";
import { useI18n } from "../locales/i18nContext";
import { usePrivacyMode } from "./usePrivacyMode";

interface UseLiveSuggestionsOptions {
  isRecording: boolean;
  segments: TranscriptSegment[];
  enabled?: boolean;
  throttleMs?: number;
}

export function useLiveSuggestions({
  isRecording,
  segments,
  enabled = true,
  throttleMs = 12000,
}: UseLiveSuggestionsOptions) {
  const { language } = useI18n();
  const { mode: privacyMode } = usePrivacyMode();
  const [suggestions, setSuggestions] = useState<LiveSuggestionItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const lastAnalyzedSegmentCountRef = useRef<number>(0);
  const lastAnalysisTimeRef = useRef<number>(0);

  const dismissSuggestion = useCallback((id: string) => {
    setSuggestions((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
  }, []);

  useEffect(() => {
    if (!isRecording) {
      // Clear suggestions when recording stops or keep them until new session
      lastAnalyzedSegmentCountRef.current = 0;
      return;
    }

    if (!enabled || segments.length === 0) {
      return;
    }

    const now = Date.now();
    const segmentCountDiff =
      segments.length - lastAnalyzedSegmentCountRef.current;
    const timeSinceLast = now - lastAnalysisTimeRef.current;

    // Trigger analysis if at least 1 new segment arrived and throttle interval elapsed
    if (segmentCountDiff > 0 && timeSinceLast >= throttleMs) {
      lastAnalysisTimeRef.current = now;
      lastAnalyzedSegmentCountRef.current = segments.length;

      // Slice the last 4 recent segments for contextual analysis
      const recentTextList = segments.slice(-4).map((s) => s.text);

      const fetchSuggestions = async () => {
        setIsAnalyzing(true);
        try {
          const result = await invoke<LiveSuggestionItem[]>(
            "generate_live_suggestions",
            {
              recentSegments: recentTextList,
              langCode: language,
            },
          );

          if (result && result.length > 0) {
            setSuggestions((prev) => {
              // Combine without duplicate IDs and limit to top 3 active suggestions
              const existingIds = new Set(prev.map((s) => s.id));
              const newItems = result.filter((s) => !existingIds.has(s.id));
              return [...newItems, ...prev].slice(0, 3);
            });
          }
        } catch (err) {
          console.error("Live suggestions generation error:", err);
        } finally {
          setIsAnalyzing(false);
        }
      };

      fetchSuggestions();
    }
  }, [isRecording, segments, enabled, throttleMs, language, privacyMode]);

  return {
    suggestions,
    isAnalyzing,
    dismissSuggestion,
    clearSuggestions,
  };
}
