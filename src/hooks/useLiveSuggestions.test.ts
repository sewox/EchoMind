import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLiveSuggestions } from "./useLiveSuggestions";
import { I18nProvider } from "../locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";
import { TranscriptSegment } from "../components/TranscriptViewer";

const mockSegments: TranscriptSegment[] = [
  {
    id: 1,
    speaker_id: "spk1",
    speaker_name: "Ali",
    start_time_ms: 0,
    end_time_ms: 3000,
    timestamp_formatted: "00:00",
    text: "Proje için bütçe onayını henüz alamadık.",
    language: "tr",
    confidence: 0.9,
  },
  {
    id: 2,
    speaker_id: "spk2",
    speaker_name: "Ayşe",
    start_time_ms: 3000,
    end_time_ms: 6000,
    timestamp_formatted: "00:03",
    text: "Fiyat biraz yüksek geldi.",
    language: "tr",
    confidence: 0.95,
  },
];

describe("useLiveSuggestions Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderSuggestionsHook = (
    options: Parameters<typeof useLiveSuggestions>[0],
  ) => {
    return renderHook(() => useLiveSuggestions(options), {
      wrapper: I18nProvider,
    });
  };

  it("does not fetch suggestions when isRecording is false", () => {
    const { result } = renderSuggestionsHook({
      isRecording: false,
      segments: mockSegments,
    });

    expect(result.current.suggestions).toEqual([]);
    expect(invoke).not.toHaveBeenCalledWith(
      "generate_live_suggestions",
      expect.anything(),
    );
  });

  it("does not fetch suggestions when segments list is empty", () => {
    const { result } = renderSuggestionsHook({
      isRecording: true,
      segments: [],
    });

    expect(result.current.suggestions).toEqual([]);
    expect(invoke).not.toHaveBeenCalledWith(
      "generate_live_suggestions",
      expect.anything(),
    );
  });

  it("fetches and sets suggestions when recording with new segments", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "generate_live_suggestions") {
        return Promise.resolve([
          {
            id: "sug-1",
            category: "question",
            text: "Tavan bütçeniz nedir?",
            rationale: "Bütçe belirsizliğini netleştirin.",
            timestamp_ms: 12345,
          },
        ]);
      }
      return Promise.resolve();
    });

    const { result } = renderSuggestionsHook({
      isRecording: true,
      segments: mockSegments,
      throttleMs: 0,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith("generate_live_suggestions", {
      recentSegments: [
        "Proje için bütçe onayını henüz alamadık.",
        "Fiyat biraz yüksek geldi.",
      ],
      langCode: "tr",
    });

    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.suggestions[0].text).toBe("Tavan bütçeniz nedir?");
  });

  it("dismisses single suggestion by ID", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "generate_live_suggestions") {
        return Promise.resolve([
          {
            id: "sug-1",
            category: "question",
            text: "Soru 1",
            rationale: "Gerekçe 1",
            timestamp_ms: 1,
          },
          {
            id: "sug-2",
            category: "action",
            text: "Aksiyon 2",
            rationale: "Gerekçe 2",
            timestamp_ms: 2,
          },
        ]);
      }
      return Promise.resolve();
    });

    const { result } = renderSuggestionsHook({
      isRecording: true,
      segments: mockSegments,
      throttleMs: 0,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.suggestions).toHaveLength(2);

    act(() => {
      result.current.dismissSuggestion("sug-1");
    });

    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.suggestions[0].id).toBe("sug-2");
  });

  it("clears all suggestions", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "generate_live_suggestions") {
        return Promise.resolve([
          {
            id: "sug-1",
            category: "insight",
            text: "İpucu",
            rationale: "Gerekçe",
            timestamp_ms: 1,
          },
        ]);
      }
      return Promise.resolve();
    });

    const { result } = renderSuggestionsHook({
      isRecording: true,
      segments: mockSegments,
      throttleMs: 0,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.suggestions).toHaveLength(1);

    act(() => {
      result.current.clearSuggestions();
    });

    expect(result.current.suggestions).toEqual([]);
  });

  it("handles invoke errors gracefully without crashing", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "generate_live_suggestions") {
        return Promise.reject(new Error("Engine failed"));
      }
      return Promise.resolve();
    });

    const { result } = renderSuggestionsHook({
      isRecording: true,
      segments: mockSegments,
      throttleMs: 0,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isAnalyzing).toBe(false);
  });
});
