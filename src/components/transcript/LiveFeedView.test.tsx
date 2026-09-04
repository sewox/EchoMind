import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LiveFeedView } from "./LiveFeedView";
import { I18nProvider } from "../../locales/i18nContext";
import { TranscriptSegment } from "../TranscriptViewer";
import { MeetingRecord } from "../../App";

describe("LiveFeedView Component", () => {
  const mockSegments: TranscriptSegment[] = [
    {
      id: 1,
      speaker_id: "spk_1",
      speaker_name: "Ahmet (Mikrofon)",
      start_time_ms: 1000,
      end_time_ms: 4000,
      timestamp_formatted: "00:01 -> 00:04",
      text: "Bugünkü toplantının amacı Q3 bütçesini onaylamak.",
      language: "tr",
      confidence: 0.98,
    },
  ];

  const mockPastMeeting: MeetingRecord = {
    id: "mtg-001",
    title: "Q3 Planlama",
    date_formatted: "01.09.2026",
    duration_seconds: 120,
    duration_formatted: "02:00",
    audio_file_path: "/path/to/audio.flac",
    segments: mockSegments,
    summary: "",
    key_decisions: [],
  };

  const defaultProps = {
    segments: mockSegments,
    filteredSegments: mockSegments,
    searchQuery: "",
    isRecording: false,
    isRedacting: false,
    highlightedSegmentId: null,
    editingSpeakerId: null,
    editingNameValue: "",
    selectedPastMeeting: mockPastMeeting,
    onRedactTranscript: vi.fn(),
    onStartEditSpeaker: vi.fn(),
    onSaveSpeakerName: vi.fn(),
    onCancelEditSpeaker: vi.fn(),
    onEditingNameChange: vi.fn(),
    onSegmentPlay: vi.fn(),
  };

  it("renders transcript segments, highlights active segment, and plays audio", () => {
    const { rerender } = render(
      <I18nProvider>
        <LiveFeedView {...defaultProps} />
      </I18nProvider>,
    );

    expect(
      screen.getByText("Bugünkü toplantının amacı Q3 bütçesini onaylamak."),
    ).toBeInTheDocument();

    const playBtn = screen.getByTitle("Bu Cümleyi Dinle");
    fireEvent.click(playBtn);
    expect(defaultProps.onSegmentPlay).toHaveBeenCalledWith(1000);

    // Test Smart Redaction trigger
    const redactBtn = screen.getByText(/Akıllı Redaksiyon & Düzeltme/i);
    fireEvent.click(redactBtn);
    expect(defaultProps.onRedactTranscript).toHaveBeenCalled();

    // Rerender with highlighted segment
    rerender(
      <I18nProvider>
        <LiveFeedView {...defaultProps} highlightedSegmentId={1} />
      </I18nProvider>,
    );
    const segElement = document.getElementById("segment-1");
    expect(segElement?.className).toContain("border-cyan-400");
  });

  it("handles speaker inline renaming and keyboard shortcuts", () => {
    const { rerender } = render(
      <I18nProvider>
        <LiveFeedView {...defaultProps} />
      </I18nProvider>,
    );

    const editSpeakerBtn = screen.getByTitle(/Konuşmacı Adını Düzenle/i);
    fireEvent.click(editSpeakerBtn);
    expect(defaultProps.onStartEditSpeaker).toHaveBeenCalledWith(
      "spk_1",
      "Ahmet (Mikrofon)",
    );

    // In editing mode
    rerender(
      <I18nProvider>
        <LiveFeedView
          {...defaultProps}
          editingSpeakerId="spk_1"
          editingNameValue="Mehmet"
        />
      </I18nProvider>,
    );

    const input = screen.getByDisplayValue("Mehmet");
    fireEvent.change(input, { target: { value: "Ali" } });
    expect(defaultProps.onEditingNameChange).toHaveBeenCalledWith("Ali");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(defaultProps.onSaveSpeakerName).toHaveBeenCalledWith("spk_1");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(defaultProps.onCancelEditSpeaker).toHaveBeenCalled();
  });

  it("renders empty states appropriately for search, recording, and idle", () => {
    const { rerender } = render(
      <I18nProvider>
        <LiveFeedView
          {...defaultProps}
          segments={[]}
          filteredSegments={[]}
          searchQuery="kelime"
        />
      </I18nProvider>,
    );
    expect(
      screen.getByText(/Aramanızla eşleşen konuşma bulunamadı/i),
    ).toBeInTheDocument();

    rerender(
      <I18nProvider>
        <LiveFeedView
          {...defaultProps}
          segments={[]}
          filteredSegments={[]}
          searchQuery=""
          isRecording={true}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(/Konuşmalar dinleniyor/i)).toBeInTheDocument();

    rerender(
      <I18nProvider>
        <LiveFeedView
          {...defaultProps}
          segments={[]}
          filteredSegments={[]}
          searchQuery=""
          isRecording={false}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByText(/Henüz bir konuşma kaydı bulunmuyor/i),
    ).toBeInTheDocument();
  });
});
