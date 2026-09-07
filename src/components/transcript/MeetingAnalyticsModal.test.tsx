import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MeetingAnalyticsModal } from "./MeetingAnalyticsModal";
import { MeetingAnalytics } from "../../types/analytics";
import { I18nProvider } from "../../locales/i18nContext";

const mockAnalytics: MeetingAnalytics = {
  total_duration_seconds: 120,
  total_speech_seconds: 100,
  total_silence_seconds: 20,
  silence_percentage: 16.7,
  total_words: 250,
  average_wpm: 150,
  meeting_balance_score: 85,
  speaker_stats: [
    {
      speaker_id: "spk1",
      speaker_name: "Ahmet Yılmaz",
      total_speech_seconds: 60,
      talk_percentage: 60,
      word_count: 150,
      wpm: 150,
      segment_count: 5,
      longest_monologue_seconds: 25,
    },
    {
      speaker_id: "spk2",
      speaker_name: "Mehmet Demir",
      total_speech_seconds: 40,
      talk_percentage: 40,
      word_count: 100,
      wpm: 150,
      segment_count: 3,
      longest_monologue_seconds: 20,
    },
  ],
  dominant_speaker: "Ahmet Yılmaz",
  dominant_speaker_percentage: 60,
  meeting_pace_label: "Moderate",
  key_insights: [
    "Toplantıda konuşma süreleri dengeli dağılmış (Denge Skoru: %85).",
  ],
};

describe("MeetingAnalyticsModal Component", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <I18nProvider>
        <MeetingAnalyticsModal
          isOpen={false}
          onClose={vi.fn()}
          analytics={mockAnalytics}
        />
      </I18nProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders analytics correctly when open", () => {
    const handleClose = vi.fn();
    render(
      <I18nProvider>
        <MeetingAnalyticsModal
          isOpen={true}
          onClose={handleClose}
          analytics={mockAnalytics}
          meetingTitle="Haftalık Değerlendirme"
        />
      </I18nProvider>
    );

    // Header and meeting title
    expect(screen.getByText(/Toplantı & Katılımcı Analitiği/i)).toBeInTheDocument();
    expect(screen.getByText(/Haftalık Değerlendirme/i)).toBeInTheDocument();

    // Top metrics
    expect(screen.getByText("%85")).toBeInTheDocument();
    expect(screen.getAllByText("Ahmet Yılmaz").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Mehmet Demir")).toBeInTheDocument();
    expect(screen.getByText("250")).toBeInTheDocument();

    // Insights
    expect(
      screen.getByText(/Toplantıda konuşma süreleri dengeli dağılmış/i)
    ).toBeInTheDocument();

    // Close button
    const closeButtons = screen.getAllByRole("button", { name: /Kapat/i });
    fireEvent.click(closeButtons[0]);
    expect(handleClose).toHaveBeenCalled();
  });

  it("renders single speaker monologue state correctly", () => {
    const singleSpeakerAnalytics: MeetingAnalytics = {
      ...mockAnalytics,
      meeting_balance_score: 40,
      speaker_stats: [
        {
          speaker_id: "spk1",
          speaker_name: "Yalnız Konuşmacı",
          total_speech_seconds: 100,
          talk_percentage: 100,
          word_count: 250,
          wpm: 150,
          segment_count: 5,
          longest_monologue_seconds: 100,
        },
      ],
      key_insights: ["Tek konuşmacılı sunum veya monolog toplantısı."],
    };

    render(
      <I18nProvider>
        <MeetingAnalyticsModal
          isOpen={true}
          onClose={vi.fn()}
          analytics={singleSpeakerAnalytics}
        />
      </I18nProvider>
    );

    expect(screen.getByText(/Monolog \/ Baskın Konuşmacı/i)).toBeInTheDocument();
    expect(screen.getByText(/Tek konuşmacılı sunum/i)).toBeInTheDocument();
  });
});
