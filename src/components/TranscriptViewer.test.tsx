import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TranscriptViewer } from "./TranscriptViewer";
import { I18nProvider } from "../locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";
import { MeetingRecord } from "../App";

const mockPastMeeting: MeetingRecord = {
  id: "mtg-001",
  title: "Q3 Strateji ve Bütçe",
  date_formatted: "01.09.2026",
  duration_seconds: 120,
  duration_formatted: "02:00",
  audio_file_path: "/path/to/audio.flac",
  segments: [
    {
      id: 1,
      speaker_id: "spk1",
      speaker_name: "Ahmet",
      start_time_ms: 0,
      end_time_ms: 5000,
      timestamp_formatted: "00:00 -> 00:05",
      text: "Depo yatırımı için onay alındı.",
      language: "tr",
      confidence: 0.98,
    },
    {
      id: 2,
      speaker_id: "spk2",
      speaker_name: "Mehmet",
      start_time_ms: 6000,
      end_time_ms: 12000,
      timestamp_formatted: "00:06 -> 00:12",
      text: "Lojistik maliyetleri %15 azalacak.",
      language: "tr",
      confidence: 0.95,
    },
  ],
  summary: "Strateji toplantısı özeti.",
  key_decisions: ["Depo yatırımı onaylandı."],
  meeting_goal: "Q3 hedeflerini netleştirmek",
  key_highlights: ["Maliyetler düşecek"],
  action_items: [
    {
      task: "Kira kontratı imzalanacak",
      assignee: "Ahmet",
      source_citations: [1],
      is_completed: false,
    },
  ],
  detailed_topics: [
    {
      topic_title: "Lojistik & Depo",
      bullet_points: ["Yeni lokasyon kararı verildi."],
    },
  ],
  participants: ["Ahmet", "Mehmet"],
};

describe("TranscriptViewer Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const defaultProps = {
    isRecording: false,
    isSpeaking: false,
    selectedLanguage: "tr",
    onLanguageChange: vi.fn(),
    selectedPastMeeting: mockPastMeeting,
    onReturnToLiveSession: vi.fn(),
    onMeetingUpdated: vi.fn(),
  };

  it("renders tabs (stream, report, tasks) and allows switching between them", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "play_native_audio")
        return Promise.resolve({
          is_playing: true,
          current_time_secs: 0,
          duration_secs: 120,
        });
      if (cmd === "play_native_audio_at")
        return Promise.resolve({
          is_playing: true,
          current_time_secs: 6,
          duration_secs: 120,
        });
      if (cmd === "seek_native_audio")
        return Promise.resolve({
          is_playing: true,
          current_time_secs: 25,
          duration_secs: 120,
        });
      if (cmd === "pause_native_audio")
        return Promise.resolve({
          is_playing: false,
          current_time_secs: 0,
          duration_secs: 120,
        });
      if (cmd === "get_native_audio_playback_state")
        return Promise.resolve({
          is_playing: false,
          current_time_secs: 0,
          duration_secs: 120,
        });
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    expect(
      screen.getByText("Depo yatırımı için onay alındı."),
    ).toBeInTheDocument();

    // Click on segment play button
    const segmentPlayBtns = screen.getAllByTitle(/Bu Cümleyi Dinle/i);
    if (segmentPlayBtns.length > 0) {
      await act(async () => {
        fireEvent.click(segmentPlayBtns[0]);
      });
      expect(invoke).toHaveBeenCalledWith(
        "play_native_audio_at",
        expect.objectContaining({
          filePath: "/path/to/audio.flac",
        }),
      );
    }

    // Switch to Report Tab
    const reportTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    fireEvent.click(reportTab);
    expect(
      screen.getByText(/Q3 hedeflerini netleştirmek/i),
    ).toBeInTheDocument();

    // Switch to Tasks Tab
    const tasksTab = screen.getByRole("button", {
      name: /Görevler & Kararlar/i,
    });
    fireEvent.click(tasksTab);
    expect(screen.getByText(/Kira kontratı imzalanacak/i)).toBeInTheDocument();

    // Click on Citation #1 in tasks view to jump to segment
    const citationBtn = screen.getByText("#1");
    fireEvent.click(citationBtn);

    // Audio player controls: Pause when playing
    const pauseBarBtn = screen.getByTitle("Durdur");
    await act(async () => {
      fireEvent.click(pauseBarBtn);
    });
    expect(invoke).toHaveBeenCalledWith("pause_native_audio");

    // Seek via range input
    const rangeInput = screen.getByRole("slider");
    await act(async () => {
      fireEvent.change(rangeInput, { target: { value: "25" } });
    });
    expect(invoke).toHaveBeenCalledWith("seek_native_audio", {
      positionSeconds: 25,
    });
  });

  it("handles summary generation, translation, and export notes in report tab", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "generate_meeting_summary") {
        return Promise.resolve({
          meeting_goal: "Yeni hedefler",
          key_highlights: ["Yeni vizyon"],
          action_items: [
            {
              task: "Görev 1",
              assignee: "Mehmet",
              source_citations: [1],
              is_completed: false,
            },
          ],
          key_decisions: ["Karar 1"],
          summary: "Oluşturulan Özet",
          provider_used: "Gemini",
          generation_time_ms: 1200,
        });
      }
      if (cmd === "translate_meeting_summary") {
        return Promise.resolve({
          meeting_goal: "New goals",
          key_highlights: ["New vision"],
          action_items: [
            {
              task: "Task 1",
              assignee: "Mehmet",
              source_citations: [1],
              is_completed: false,
            },
          ],
          key_decisions: ["Decision 1"],
          summary: "Generated Summary EN",
          provider_used: "Gemini",
          generation_time_ms: 1200,
        });
      }
      if (cmd === "export_meeting_notes")
        return Promise.resolve("# Toplantı Notları");
      if (cmd === "toggle_action_item_status") return Promise.resolve();
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    // Switch to Report Tab
    const reportTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    fireEvent.click(reportTab);

    // Change summary translation language to English
    const select = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.change(select, { target: { value: "en" } });
    });
    expect(invoke).toHaveBeenCalledWith(
      "translate_meeting_summary",
      expect.objectContaining({
        targetLangCode: "en",
      }),
    );

    // Switch back to English (cached)
    await act(async () => {
      fireEvent.change(select, { target: { value: "en" } });
    });

    // Export markdown notes
    const exportNotesBtn = screen.getByRole("button", {
      name: /Raporu İndir \(\.md\)/i,
    });
    await act(async () => {
      fireEvent.click(exportNotesBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "export_meeting_notes",
      expect.any(Object),
    );

    // Retranscribe button inside summary view
    const retranscribeInSummaryBtn = screen.getByRole("button", {
      name: /Zeka Modunu Değiştir & Yeniden Yazıya Dök/i,
    });
    await act(async () => {
      fireEvent.click(retranscribeInSummaryBtn);
    });
    expect(
      screen.getAllByText(/Konuşmaları Yeniden Yazıya Dök/i).length,
    ).toBeGreaterThan(0);
  });

  it("handles speaker name update, smart redaction, and action item toggle", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "update_meeting_speaker_name") {
        return Promise.resolve({
          ...mockPastMeeting,
          segments: [
            { ...mockPastMeeting.segments[0], speaker_name: "Ahmet Bey" },
            mockPastMeeting.segments[1],
          ],
        });
      }
      if (cmd === "enhance_meeting_transcript") {
        return Promise.resolve({
          ...mockPastMeeting,
          segments: [
            { ...mockPastMeeting.segments[0], text: "Düzeltilmiş metin" },
            mockPastMeeting.segments[1],
          ],
        });
      }
      if (cmd === "toggle_action_item_status") return Promise.resolve();
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    // Click edit speaker
    const editBtns = screen.getAllByTitle(/Konuşmacı Adını Düzenle/i);
    fireEvent.click(editBtns[0]);

    const input = screen.getByDisplayValue("Ahmet");
    fireEvent.change(input, { target: { value: "Ahmet Bey" } });

    const saveBtn = screen.getByTitle("Kaydet");
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(invoke).toHaveBeenCalledWith("update_meeting_speaker_name", {
      meetingId: "mtg-001",
      speakerId: "spk1",
      newName: "Ahmet Bey",
    });

    // Redaction
    const redactBtn = screen.getByText(/Akıllı Redaksiyon & Düzeltme/i);
    await act(async () => {
      fireEvent.click(redactBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "enhance_meeting_transcript",
      expect.objectContaining({
        meetingId: "mtg-001",
      }),
    );

    // Switch to Tasks Tab and Toggle Task Checkbox
    const tasksTab = screen.getByRole("button", {
      name: /Görevler & Kararlar/i,
    });
    fireEvent.click(tasksTab);

    const taskElement = screen.getByText(/Kira kontratı imzalanacak/i);
    const taskButton = taskElement
      .closest("div")
      ?.parentElement?.querySelector("button");
    if (taskButton) {
      await act(async () => {
        fireEvent.click(taskButton);
      });
      expect(invoke).toHaveBeenCalledWith("toggle_action_item_status", {
        meetingId: "mtg-001",
        actionIndex: 0,
      });
    }
  });

  it("filters transcript by search term and copies transcript to clipboard", async () => {
    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    const searchInput = screen.getByPlaceholderText(/Konuşmalarda ara/i);
    fireEvent.change(searchInput, { target: { value: "Lojistik" } });

    expect(
      screen.getByText(/Lojistik maliyetleri %15 azalacak/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Depo yatırımı için onay alındı/i)).toBeNull();

    // Copy button
    const copyBtn = screen.getByRole("button", { name: /Kopyala/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });
  });

  it("opens and closes export modal and retranscribe modal", async () => {
    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    const exportBtn = screen.getByRole("button", { name: /Dışa Aktar/i });
    fireEvent.click(exportBtn);
    expect(screen.getByText(/Raporu Dışa Aktar & Paylaş/i)).toBeInTheDocument();

    const retranscribeBtn = screen.getByRole("button", {
      name: /Yeniden Yazıya Dök/i,
    });
    fireEvent.click(retranscribeBtn);
    expect(
      screen.getAllByText(/Konuşmaları Yeniden Yazıya Dök/i).length,
    ).toBeGreaterThan(0);
  });

  it("renders live recording state and handles transcribe buffer and clear", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript") return Promise.resolve([]);
      if (cmd === "transcribe_audio_buffer")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "clear_transcription_history") return Promise.resolve();
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={null}
          isRecording={true}
          isSpeaking={true}
        />
      </I18nProvider>,
    );

    expect(screen.getByText(/Konuşuluyor/i)).toBeInTheDocument();

    // Click "Yazıya Dönüştür" to transcribe
    const transcribeBtn = screen.getByRole("button", {
      name: /Yazıya Dönüştür/i,
    });
    await act(async () => {
      fireEvent.click(transcribeBtn);
    });

    expect(
      await screen.findByText("Depo yatırımı için onay alındı."),
    ).toBeInTheDocument();

    // Clear transcript
    const clearBtn = await screen.findByTitle("Temizle");
    await act(async () => {
      fireEvent.click(clearBtn);
    });
    expect(invoke).toHaveBeenCalledWith("clear_transcription_history");
  });
});
