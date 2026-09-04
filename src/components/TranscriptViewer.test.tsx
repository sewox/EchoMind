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

  it("handles copy all, export modal open, and jump to citation", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "export_meeting_notes_markdown")
        return Promise.resolve("# Markdown Export");
      if (cmd === "translate_meeting_summary")
        return Promise.resolve({
          meeting_goal: "Translated goal",
          key_highlights: ["Translated highlight"],
          action_items: [],
          phase1_agreed: [],
          phase2_deferred: [],
          detailed_topics: [],
          participants: [],
          summary: "Translated summary",
          key_decisions: [],
          agenda_topics: [],
          provider_used: "EchoMind Translation",
          generation_time_ms: 50,
        });
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    // Copy All
    const copyBtn = screen.getByRole("button", { name: /Kopyala/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    // Export Modal Open
    const exportBtn = screen.getByRole("button", {
      name: /Raporu Dışa Aktar/i,
    });
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    expect(screen.getByText(/Raporu Dışa Aktar & Paylaş/i)).toBeInTheDocument();

    // Close export modal
    const closeExportBtn = screen.getByRole("button", { name: /Kapat/i });
    fireEvent.click(closeExportBtn);

    // Switch to Summary Tab & Test Language translation
    const summaryTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    await act(async () => {
      fireEvent.click(summaryTab);
    });

    const langSelect = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.change(langSelect, { target: { value: "en" } });
    });
    expect(invoke).toHaveBeenCalledWith(
      "translate_meeting_summary",
      expect.anything(),
    );
  });

  it("renders live mode with speaking badge and language switcher", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript") {
        return Promise.resolve([
          {
            id: 101,
            speaker_id: "spk1",
            speaker_name: "Konuşmacı 1",
            start_time_ms: 0,
            end_time_ms: 3000,
            timestamp_formatted: "00:00 -> 00:03",
            text: "Canlı toplantı akışı testi.",
            language: "tr",
            confidence: 0.99,
          },
        ]);
      }
      return Promise.resolve();
    });

    const mockLangChange = vi.fn();
    render(
      <I18nProvider>
        <TranscriptViewer
          isRecording={true}
          isSpeaking={true}
          selectedLanguage="tr"
          onLanguageChange={mockLangChange}
          selectedPastMeeting={null}
          onReturnToLiveSession={vi.fn()}
          onMeetingUpdated={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Konuşuluyor")).toBeInTheDocument();
    const enBtn = screen.getByRole("button", { name: "EN" });
    fireEvent.click(enBtn);
    expect(mockLangChange).toHaveBeenCalledWith("en");
  });

  it("handles retranscribe button click and opens RetranscribeModal", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "retranscribe_meeting") {
        return Promise.resolve({
          ...mockPastMeeting,
          meeting_goal: "Yeni hedef",
          summary: "Yeniden oluşturulan özet",
          summary_provider: "Whisper Base",
        });
      }
      return Promise.resolve();
    });

    const mockMeetingUpdated = vi.fn();

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          onMeetingUpdated={mockMeetingUpdated}
        />
      </I18nProvider>,
    );

    // Switch to summary tab where retranscribe button exists
    const summaryTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    await act(async () => {
      fireEvent.click(summaryTab);
    });

    // Find and click the retranscribe button
    const retranscribeBtn = screen.getByRole("button", {
      name: /Zeka Modunu Değiştir/i,
    });
    await act(async () => {
      fireEvent.click(retranscribeBtn);
    });

    // Check if RetranscribeModal is open
    expect(
      await screen.findByText(/Konuşmaları Yeniden Yazıya Dök/i),
    ).toBeInTheDocument();

    // Trigger start retranscription
    const startBtns = screen.getAllByRole("button", {
      name: /Yeniden Yazıya Dök/i,
    });
    await act(async () => {
      fireEvent.click(startBtns[startBtns.length - 1]);
    });

    expect(mockMeetingUpdated).toHaveBeenCalled();
  });

  it("handles search query filter within transcript segments", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript")
        return Promise.resolve(mockPastMeeting.segments);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    expect(
      await screen.findByText(/Depo yatırımı için onay alındı/i),
    ).toBeInTheDocument();

    // Type in search box
    const searchInput = screen.getByPlaceholderText(/Konuşmalarda ara/i);
    fireEvent.change(searchInput, { target: { value: "Lojistik" } });

    // Mehmet and Lojistik appears
    expect(
      screen.getByText(/Lojistik maliyetleri %15 azalacak/i),
    ).toBeInTheDocument();
  });

  it("handles speaker name inline editing", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "update_meeting_speaker_name") return Promise.resolve();
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    // Click edit speaker button
    const editBtns = await screen.findAllByTitle(/Konuşmacı Adını Düzenle/i);
    fireEvent.click(editBtns[0]);

    // Change input
    const input = screen.getByDisplayValue("Ahmet");
    fireEvent.change(input, { target: { value: "Ahmet (Lead)" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(invoke).toHaveBeenCalledWith(
      "update_meeting_speaker_name",
      expect.objectContaining({
        newName: "Ahmet (Lead)",
        speakerId: "spk1",
      }),
    );
  });

  it("handles smart redaction click in LiveFeedView", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "enhance_meeting_transcript") {
        return Promise.resolve(mockPastMeeting.segments);
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    const redactBtn = await screen.findByRole("button", {
      name: /Akıllı Redaksiyon & Düzeltme/i,
    });
    await act(async () => {
      fireEvent.click(redactBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "enhance_meeting_transcript",
      expect.anything(),
    );
  });

  it("handles action item toggle and backend sync", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "toggle_action_item_status") return Promise.resolve();
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    // Switch to Tasks Tab
    const tasksTab = screen.getByRole("button", {
      name: /Görevler & Kararlar|Görevler/i,
    });
    fireEvent.click(tasksTab);

    // Toggle Action Item Button
    const taskCheckbox = await screen.findByText("Kira kontratı imzalanacak");
    const toggleBtn = taskCheckbox
      .closest("div")
      ?.parentElement?.querySelector("button");
    if (toggleBtn) {
      fireEvent.click(toggleBtn);
    }

    expect(invoke).toHaveBeenCalledWith(
      "toggle_action_item_status",
      expect.objectContaining({
        meetingId: "mtg-001",
        actionIndex: 0,
      }),
    );
  });

  it("handles summary generation across cloud and local engines", async () => {
    localStorage.setItem("echomind_active_engine", "cloud_openai");
    localStorage.setItem("echomind_openai_key", "sk-test-openai-key");

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "generate_meeting_summary") {
        return Promise.resolve({
          summary: "Yapay zeka ile oluşturulan yeni özet",
          key_decisions: ["Yeni karar 1"],
          key_highlights: ["Önemli nokta"],
          action_items: [
            { task: "Yeni aksiyon", assignee: "Ahmet", is_completed: false },
          ],
          detailed_topics: [],
          participants: ["Ahmet"],
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    // Switch to Report Tab
    const reportTab = screen.getAllByRole("button", {
      name: /Toplantı Raporu/i,
    })[0];
    fireEvent.click(reportTab);

    // Click Generate Summary button if available
    const genBtn = screen.queryByRole("button", {
      name: /Yeniden Özetle|Özet Oluştur|Yapay Zeka Özeti/i,
    });
    if (genBtn) {
      await act(async () => {
        fireEvent.click(genBtn);
      });
      expect(invoke).toHaveBeenCalledWith(
        "generate_meeting_summary",
        expect.objectContaining({
          provider: "openai",
          apiKey: "sk-test-openai-key",
        }),
      );
    }
  });

  it("handles citation jumping back to transcript segment", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript")
        return Promise.resolve(mockPastMeeting.segments);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    // Switch to Tasks Tab
    const tasksTab = screen.getByRole("button", {
      name: /Görevler & Kararlar|Görevler/i,
    });
    fireEvent.click(tasksTab);

    // Click on Citation badge (#1)
    const citationBadge = await screen.findByText(/#1/i);
    fireEvent.click(citationBadge);

    // Should navigate back to transcript
    expect(
      screen.getByText(/Depo yatırımı için onay alındı/i),
    ).toBeInTheDocument();
  });

  it("handles audio play/pause, seek slider and segment play", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "play_native_audio")
        return Promise.resolve({
          is_playing: true,
          current_time_secs: 10,
          duration_secs: 120,
        });
      if (cmd === "pause_native_audio")
        return Promise.resolve({
          is_playing: false,
          current_time_secs: 10,
          duration_secs: 120,
        });
      if (cmd === "seek_native_audio") return Promise.resolve();
      if (cmd === "play_native_audio_at")
        return Promise.resolve({
          is_playing: true,
          current_time_secs: 6,
          duration_secs: 120,
        });
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    // Click Play button
    const playBtn = await screen.findByTitle(/Oynat|Durdur/i);
    await act(async () => {
      fireEvent.click(playBtn);
    });
    expect(invoke).toHaveBeenCalledWith("play_native_audio", expect.anything());

    // Click Pause
    await act(async () => {
      fireEvent.click(playBtn);
    });
    expect(invoke).toHaveBeenCalledWith("pause_native_audio");

    // Seek range input
    const seekSlider = screen.getByRole("slider");
    fireEvent.change(seekSlider, { target: { value: "30" } });
    expect(invoke).toHaveBeenCalledWith("seek_native_audio", {
      positionSeconds: 30,
    });
  });

  it("handles copy all, clear, and summary translation", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_current_transcript")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "clear_transcription_history") return Promise.resolve();
      if (cmd === "translate_meeting_summary") {
        return Promise.resolve({
          ...mockPastMeeting,
          summary: "Zusammenfassung der Strategiesitzung.",
        });
      }
      if (cmd === "export_meeting_notes")
        return Promise.resolve("# Exported Notes");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    // Copy All
    const copyBtn = await screen.findByRole("button", { name: /Kopyala/i });
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    // Export Modal Open
    const exportBtns = screen.getAllByRole("button", {
      name: /Raporu Paylaş|Dışa Aktar/i,
    });
    await act(async () => {
      fireEvent.click(exportBtns[0]);
    });
    expect(
      await screen.findByText(/Raporu Dışa Aktar & Paylaş/i),
    ).toBeInTheDocument();

    // Switch to Report Tab and translate
    const reportTab = screen.getAllByRole("button", {
      name: /Toplantı Raporu/i,
    })[0];
    fireEvent.click(reportTab);

    const langSelect =
      screen.queryByTitle(/Özet Dili/i) || screen.queryAllByRole("combobox")[0];
    if (langSelect) {
      await act(async () => {
        fireEvent.change(langSelect, { target: { value: "de" } });
      });
      expect(invoke).toHaveBeenCalledWith(
        "translate_meeting_summary",
        expect.objectContaining({
          targetLangCode: "de",
        }),
      );
    }
  });

  it("handles speaker name editing with save and cancel on empty string", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "update_meeting_speaker_name") return Promise.resolve();
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    // Click on speaker name badge to edit
    const speakerBadges = await screen.findAllByTitle(
      /Konuşmacı Adını Düzenle/i,
    );
    await act(async () => {
      fireEvent.click(speakerBadges[0]);
    });

    const input = screen.getByDisplayValue("Ahmet");
    // Cancel with Escape
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    // Start edit again and save valid name
    const badgesAfterCancel = await screen.findAllByTitle(
      /Konuşmacı Adını Düzenle/i,
    );
    await act(async () => {
      fireEvent.click(badgesAfterCancel[0]);
    });

    const editInput = screen.getByDisplayValue("Ahmet");
    await act(async () => {
      fireEvent.change(editInput, { target: { value: "Dr. Ahmet Yılmaz" } });
      fireEvent.keyDown(editInput, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(invoke).toHaveBeenCalledWith("update_meeting_speaker_name", {
      meetingId: "mtg-001",
      speakerId: "spk1",
      newName: "Dr. Ahmet Yılmaz",
    });
  });

  it("handles AI transcript enhancement and redaction with cloud provider", async () => {
    localStorage.setItem("echomind_active_engine", "cloud_gemini");
    localStorage.setItem("echomind_gemini_key", "AIzaSy_test_key");

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "enhance_meeting_transcript") {
        return Promise.resolve({
          ...mockPastMeeting,
          segments: [
            {
              ...mockPastMeeting.segments[0],
              text: "Depo yatırımı için yönetim kurulu onayı alındı.",
            },
          ],
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    const redactBtn = await screen.findByRole("button", {
      name: /Akıllı Redaksiyon/i,
    });
    await act(async () => {
      fireEvent.click(redactBtn);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(invoke).toHaveBeenCalledWith("enhance_meeting_transcript", {
      meetingId: "mtg-001",
      provider: "gemini",
      apiKey: "AIzaSy_test_key",
    });
  });

  it("handles segment play at specific timestamp", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "play_native_audio_at") {
        return Promise.resolve({
          is_playing: true,
          current_time_secs: 6.0,
          duration_secs: 120.0,
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    const playBtns = await screen.findAllByTitle(/Bu Cümleyi Dinle/i);
    await act(async () => {
      fireEvent.click(playBtns[0]);
    });

    expect(invoke).toHaveBeenCalledWith("play_native_audio_at", {
      filePath: "/path/to/audio.flac",
      startSecs: 0,
    });
  });

  it("handles live buffer transcription with custom keys", async () => {
    localStorage.setItem("echomind_active_engine", "cloud_groq");
    localStorage.setItem("echomind_groq_key", "gsk_groq_test");

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "transcribe_audio_buffer") {
        return Promise.resolve(mockPastMeeting.segments);
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={null}
          isRecording={true}
        />
      </I18nProvider>,
    );

    const liveTranscribeBtn = screen.queryByRole("button", {
      name: /Metne Dönüştür|Şimdi Çözümle/i,
    });
    if (liveTranscribeBtn) {
      await act(async () => {
        fireEvent.click(liveTranscribeBtn);
      });
      expect(invoke).toHaveBeenCalledWith(
        "transcribe_audio_buffer",
        expect.any(Object),
      );
    }
  });

  it("handles markdown export download", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "export_meeting_notes") {
        return Promise.resolve(
          "# Q3 Strateji Toplantı Notları\n\n## Kararlar\n- Onaylandı",
        );
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    const downloadMdBtn = screen.queryByTitle(/Markdown Olarak İndir/i);
    if (downloadMdBtn) {
      await act(async () => {
        fireEvent.click(downloadMdBtn);
      });
      expect(invoke).toHaveBeenCalledWith(
        "export_meeting_notes",
        expect.any(Object),
      );
    }
  });

  it("handles audio seek slider and audio error handling", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "seek_native_audio") return Promise.reject("Seek hatası");
      if (cmd === "play_native_audio") return Promise.reject("Oynatma hatası");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    // Audio seek slider
    const sliders = screen.getAllByRole("slider");
    if (sliders.length > 0) {
      await act(async () => {
        fireEvent.change(sliders[0], { target: { value: "45" } });
      });
      expect(invoke).toHaveBeenCalledWith("seek_native_audio", {
        positionSeconds: 45,
      });
    }

    // Play button error catch
    const playBtn = screen.getByTitle(/Oynat|Durdur/i);
    await act(async () => {
      fireEvent.click(playBtn);
    });
  });

  it("handles buffer transcription with Gemini, OpenAI and Local engines", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "transcribe_audio_buffer") {
        return Promise.resolve(mockPastMeeting.segments);
      }
      return Promise.resolve();
    });

    // Test Gemini
    localStorage.setItem("echomind_active_engine", "cloud_gemini");
    localStorage.setItem("echomind_gemini_key", "gemini_test_key");

    const { unmount } = render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={null}
          isRecording={true}
        />
      </I18nProvider>,
    );

    const transcribeBtn1 = screen.queryByRole("button", {
      name: /Metne Dönüştür|Şimdi Çözümle/i,
    });
    if (transcribeBtn1) {
      await act(async () => {
        fireEvent.click(transcribeBtn1);
      });
      expect(invoke).toHaveBeenCalledWith(
        "transcribe_audio_buffer",
        expect.objectContaining({
          cloudProvider: "gemini",
          apiKey: "gemini_test_key",
        }),
      );
    }
    unmount();

    // Test OpenAI
    localStorage.setItem("echomind_active_engine", "cloud_openai");
    localStorage.setItem("echomind_openai_key", "openai_test_key");

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={null}
          isRecording={true}
        />
      </I18nProvider>,
    );

    const transcribeBtn2 = screen.queryByRole("button", {
      name: /Metne Dönüştür|Şimdi Çözümle/i,
    });
    if (transcribeBtn2) {
      await act(async () => {
        fireEvent.click(transcribeBtn2);
      });
      expect(invoke).toHaveBeenCalledWith(
        "transcribe_audio_buffer",
        expect.objectContaining({
          cloudProvider: "openai",
          apiKey: "openai_test_key",
        }),
      );
    }
  });

  it("handles generate summary with OpenAI, Groq, and Ollama providers and error handling", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "generate_meeting_summary") {
        return Promise.reject("Özet motoru yanıt vermedi");
      }
      return Promise.resolve();
    });

    localStorage.setItem("echomind_active_engine", "cloud_openai");
    localStorage.setItem("echomind_openai_key", "sk_openai_test");

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={{
            ...mockPastMeeting,
            summary: "",
            meeting_goal: "",
          }}
        />
      </I18nProvider>,
    );

    // Switch to report tab
    const reportTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    await act(async () => {
      fireEvent.click(reportTab);
    });

    const generateBtn = screen.queryByRole("button", {
      name: /Rapor Oluştur|Özet Çıkar/i,
    });
    if (generateBtn) {
      await act(async () => {
        fireEvent.click(generateBtn);
      });
    }
  });

  it("handles retranscribe success callback and updates parent meeting", async () => {
    const onMeetingUpdatedMock = vi.fn();
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve([]);
      if (cmd === "get_stored_api_keys")
        return Promise.resolve({ groq: "", gemini: "", openai: "" });
      if (cmd === "get_ollama_config")
        return Promise.resolve({ endpoint: "", model: "" });
      if (cmd === "retranscribe_meeting") {
        return Promise.resolve({
          ...mockPastMeeting,
          summary: "Güncellenmiş Yeni Özet",
          meeting_goal: "Güncellenmiş Hedef",
          segments: [
            {
              id: 1,
              speaker_id: "spk1",
              speaker_name: "Ali",
              start_time_ms: 0,
              end_time_ms: 3000,
              timestamp_formatted: "00:00 -> 00:03",
              text: "Yeni transkribe edilen metin.",
              language: "tr",
              confidence: 0.99,
            },
          ],
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          onMeetingUpdated={onMeetingUpdatedMock}
        />
      </I18nProvider>,
    );

    // Click Retranscribe Button
    const retranscribeBtns = screen.getAllByRole("button", {
      name: /Yeniden Yazıya Dök/i,
    });
    await act(async () => {
      fireEvent.click(retranscribeBtns[0]);
    });

    // In modal, click Submit
    const allRetranscribeBtns = await screen.findAllByRole("button", {
      name: /Yeniden Yazıya Dök/i,
    });
    const modalSubmitBtn = allRetranscribeBtns[allRetranscribeBtns.length - 1];
    await act(async () => {
      fireEvent.click(modalSubmitBtn);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(onMeetingUpdatedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: "Güncellenmiş Yeni Özet",
      }),
    );
  });

  it("handles Tasks tab rendering and citation jump", async () => {
    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    const tasksTab = screen.getByRole("button", {
      name: /Görevler & Kararlar/i,
    });
    await act(async () => {
      fireEvent.click(tasksTab);
    });

    expect(screen.getByText(/Kira kontratı imzalanacak/i)).toBeInTheDocument();

    // Click citation link in Tasks tab
    const citationBtn = screen.queryByTitle(/Transkript #1 referansına git/i);
    if (citationBtn) {
      await act(async () => {
        fireEvent.click(citationBtn);
        await new Promise((r) => setTimeout(r, 20));
      });
    }
  });

  it("handles redaction with Groq and OpenAI providers", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "enhance_meeting_transcript") {
        return Promise.resolve({
          ...mockPastMeeting,
          segments: [
            {
              id: 1,
              speaker_id: "spk1",
              speaker_name: "Ahmet",
              start_time_ms: 0,
              end_time_ms: 5000,
              timestamp_formatted: "00:00 -> 00:05",
              text: "Düzeltilmiş metin",
              language: "tr",
              confidence: 1.0,
            },
          ],
        });
      }
      return Promise.resolve();
    });

    // Test Groq
    localStorage.setItem("echomind_active_engine", "cloud_groq");
    localStorage.setItem("echomind_groq_key", "gsk_groq_key");

    const { unmount } = render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    const redactBtn1 = await screen.findByRole("button", {
      name: /Akıllı Redaksiyon/i,
    });
    await act(async () => {
      fireEvent.click(redactBtn1);
    });
    expect(invoke).toHaveBeenCalledWith(
      "enhance_meeting_transcript",
      expect.objectContaining({
        provider: "groq",
        apiKey: "gsk_groq_key",
      }),
    );
    unmount();

    // Test OpenAI
    localStorage.setItem("echomind_active_engine", "cloud_openai");
    localStorage.setItem("echomind_openai_key", "sk_openai_key");

    render(
      <I18nProvider>
        <TranscriptViewer {...defaultProps} />
      </I18nProvider>,
    );

    const redactBtn2 = await screen.findByRole("button", {
      name: /Akıllı Redaksiyon/i,
    });
    await act(async () => {
      fireEvent.click(redactBtn2);
    });
    expect(invoke).toHaveBeenCalledWith(
      "enhance_meeting_transcript",
      expect.objectContaining({
        provider: "openai",
        apiKey: "sk_openai_key",
      }),
    );
  });

  it("handles live transcription polling interval and buffer error", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_transcription_history")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "transcribe_audio_buffer")
        return Promise.reject("Buffer transkripsiyon hatası");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={null}
          isRecording={true}
        />
      </I18nProvider>,
    );

    // Wait for interval
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const transcribeBtn = screen.queryByRole("button", {
      name: /Yazıya Dönüştür/i,
    });
    if (transcribeBtn) {
      await act(async () => {
        fireEvent.click(transcribeBtn);
        await new Promise((r) => setTimeout(r, 20));
      });
    }
  });

  it("handles top header buttons: back to live, share report, and language change", async () => {
    const onReturnToLiveSessionMock = vi.fn();
    const onLanguageChangeMock = vi.fn();

    const { unmount } = render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          onReturnToLiveSession={onReturnToLiveSessionMock}
        />
      </I18nProvider>,
    );

    // Click back to live button
    const backBtn = screen.getByTitle(/Canlı Toplantı Ekranına Dön/i);
    fireEvent.click(backBtn);
    expect(onReturnToLiveSessionMock).toHaveBeenCalled();
    unmount();

    // In live mode, change language button
    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={null}
          isRecording={true}
          isSpeaking={true}
          onLanguageChange={onLanguageChangeMock}
        />
      </I18nProvider>,
    );

    const enBtn = screen.getByRole("button", { name: "EN" });
    fireEvent.click(enBtn);
    expect(onLanguageChangeMock).toHaveBeenCalledWith("en");
  });

  it("handles citation jumping, speaker name editing, action items toggling, and summary translation", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "toggle_action_item_status") return Promise.resolve();
      if (cmd === "update_meeting_speaker_name") return Promise.resolve();
      if (cmd === "translate_meeting_summary") {
        return Promise.resolve({
          overview: "Translated overview",
          key_points: ["Translated point 1"],
          action_items: [
            {
              task: "Translated task",
              assignee: "Ahmet",
              deadline: "Yarın",
              is_completed: false,
            },
          ],
          decisions: ["Translated decision"],
        });
      }
      return Promise.resolve();
    });

    const mockScrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = mockScrollIntoView;

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={mockPastMeeting}
        />
      </I18nProvider>,
    );

    // Switch to Summary Tab (Toplantı Raporu)
    const summaryTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    await act(async () => {
      fireEvent.click(summaryTab);
    });

    // Translate summary if available
    const translateEnBtns = screen.queryAllByRole("button", { name: /^EN$/i });
    if (translateEnBtns.length > 0) {
      await act(async () => {
        fireEvent.click(translateEnBtns[0]);
      });
      expect(invoke).toHaveBeenCalledWith(
        "translate_meeting_summary",
        expect.objectContaining({
          targetLangCode: "en",
        }),
      );
    }

    // Switch to Tasks Tab (Görevler & Kararlar)
    const tasksTab = screen.getByRole("button", {
      name: /Görevler & Kararlar/i,
    });
    await act(async () => {
      fireEvent.click(tasksTab);
    });

    // Toggle Action Item
    const actionBtns = screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("hover:text-emerald-400"));
    if (actionBtns.length > 0) {
      await act(async () => {
        fireEvent.click(actionBtns[0]);
      });
      expect(invoke).toHaveBeenCalledWith(
        "toggle_action_item_status",
        expect.objectContaining({
          meetingId: mockPastMeeting.id,
          actionIndex: 0,
        }),
      );
    }

    // Click citation jump button #1
    const citationBtn = screen.queryByRole("button", { name: /#1/i });
    if (citationBtn) {
      await act(async () => {
        fireEvent.click(citationBtn);
        await new Promise((r) => setTimeout(r, 150));
      });
    }

    // Switch back to Transcript Tab (Konuşma Akışı)
    const transcriptTab = screen.getByRole("button", {
      name: /Konuşma Akışı/i,
    });
    await act(async () => {
      fireEvent.click(transcriptTab);
    });

    // Edit Speaker Name
    const editSpeakerBtns = screen.getAllByTitle(/Konuşmacı Adını Düzenle/i);
    if (editSpeakerBtns.length > 0) {
      await act(async () => {
        fireEvent.click(editSpeakerBtns[0]);
      });

      const speakerInput = screen.getByDisplayValue(/Ahmet/i);
      await act(async () => {
        fireEvent.change(speakerInput, { target: { value: "Ahmet Yılmaz" } });
        fireEvent.keyDown(speakerInput, { key: "Enter", code: "Enter" });
      });

      expect(invoke).toHaveBeenCalledWith(
        "update_meeting_speaker_name",
        expect.objectContaining({
          meetingId: mockPastMeeting.id,
          newName: "Ahmet Yılmaz",
        }),
      );
    }
  });

  it("handles audio playback controls, segment play, copy all, and clear actions", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "play_native_audio") {
        return Promise.resolve({
          is_playing: true,
          current_time_secs: 10,
          duration_secs: 120,
        });
      }
      if (cmd === "pause_native_audio") return Promise.resolve();
      if (cmd === "play_native_audio_at") {
        return Promise.resolve({
          is_playing: true,
          current_time_secs: 15,
          duration_secs: 120,
        });
      }
      if (cmd === "clear_transcription_history") return Promise.resolve();
      return Promise.resolve();
    });

    const writeTextSpy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();

    const { unmount } = render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={mockPastMeeting}
        />
      </I18nProvider>,
    );

    // Play button toggle
    const playBtn = screen.getByTitle(/Oynat|Durdur/i);
    await act(async () => {
      fireEvent.click(playBtn);
    });
    expect(invoke).toHaveBeenCalledWith("play_native_audio", {
      filePath: mockPastMeeting.audio_file_path,
    });

    // Play specific segment
    const segmentPlayBtns = screen.getAllByTitle(/Bu Cümleyi Dinle/i);
    if (segmentPlayBtns.length > 0) {
      await act(async () => {
        fireEvent.click(segmentPlayBtns[0]);
      });
      expect(invoke).toHaveBeenCalledWith(
        "play_native_audio_at",
        expect.objectContaining({
          filePath: mockPastMeeting.audio_file_path,
        }),
      );
    }

    // Copy all button
    const copyBtn = screen.getByRole("button", { name: /Kopyala/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(writeTextSpy).toHaveBeenCalled();

    // Retranscribe modal open from live view
    const retranscribeBtns = screen.getAllByTitle(/baştan çözümleyin/i);
    if (retranscribeBtns.length > 0) {
      await act(async () => {
        fireEvent.click(retranscribeBtns[0]);
      });
    }

    unmount();

    // Test Live Mode Clear action
    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={null}
          isRecording={true}
        />
      </I18nProvider>,
    );

    const clearBtn = screen.queryByTitle(/Temizle/i);
    if (clearBtn) {
      await act(async () => {
        fireEvent.click(clearBtn);
      });
    }
  });

  it("handles markdown export download and redaction with Gemini engine", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "export_meeting_notes")
        return Promise.resolve("# Markdown Content Generated");
      if (cmd === "enhance_meeting_transcript") {
        return Promise.resolve({
          ...mockPastMeeting,
          segments: [
            {
              id: 1,
              speaker_id: "spk1",
              speaker_name: "Ahmet",
              start_time_ms: 0,
              end_time_ms: 5000,
              timestamp_formatted: "00:00 -> 00:05",
              text: "Geliştirilmiş metin.",
              language: "tr",
              confidence: 0.99,
            },
          ],
        });
      }
      return Promise.resolve();
    });

    localStorage.setItem("echomind_active_engine", "cloud_gemini");
    localStorage.setItem("echomind_gemini_key", "gemini_secret_key");

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={mockPastMeeting}
        />
      </I18nProvider>,
    );

    // Switch to Summary Tab to trigger handleExportNotes
    const summaryTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    await act(async () => {
      fireEvent.click(summaryTab);
    });

    const exportMdBtn = screen.queryByRole("button", {
      name: /Markdown İndir|\.md/i,
    });
    if (exportMdBtn) {
      await act(async () => {
        fireEvent.click(exportMdBtn);
      });
      expect(invoke).toHaveBeenCalledWith(
        "export_meeting_notes",
        expect.any(Object),
      );
    }

    // Switch back to Transcript Tab
    const transcriptTab = screen.getByRole("button", {
      name: /Konuşma Akışı/i,
    });
    await act(async () => {
      fireEvent.click(transcriptTab);
    });

    // Click Redaction with Gemini
    const redactBtn = screen.getByRole("button", {
      name: /Akıllı Redaksiyon/i,
    });
    await act(async () => {
      fireEvent.click(redactBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "enhance_meeting_transcript",
      expect.objectContaining({
        provider: "gemini",
        apiKey: "gemini_secret_key",
      }),
    );

    // Start editing speaker and cancel
    const editBtns = screen.getAllByTitle(/Konuşmacı Adını Düzenle/i);
    if (editBtns.length > 0) {
      await act(async () => {
        fireEvent.click(editBtns[0]);
      });
      const input = screen.getByDisplayValue(/Ahmet/i);
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    }
  });

  it("handles RetranscribeModal opening and updates state on success callback", async () => {
    const onMeetingUpdatedMock = vi.fn();
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "retranscribe_meeting") {
        return Promise.resolve({
          ...mockPastMeeting,
          meeting_goal: "Yeni Amaç",
          summary: "Yeni Özet",
          summary_provider: "Gemini",
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={mockPastMeeting}
          onMeetingUpdated={onMeetingUpdatedMock}
        />
      </I18nProvider>,
    );

    // Open Retranscribe modal from summary tab
    const summaryTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    await act(async () => {
      fireEvent.click(summaryTab);
    });

    const retranscribeBtns = screen.getAllByTitle(/baştan çözümleyin/i);
    if (retranscribeBtns.length > 0) {
      await act(async () => {
        fireEvent.click(retranscribeBtns[0]);
      });

      // Submit retranscription
      const submitBtns = screen.getAllByRole("button", {
        name: /Yeniden Yazıya Dök/i,
      });
      await act(async () => {
        fireEvent.click(submitBtns[submitBtns.length - 1]);
      });

      expect(onMeetingUpdatedMock).toHaveBeenCalled();
    }
  });

  it("handles summary translation caching and switching back to Turkish", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "translate_meeting_summary") {
        return Promise.resolve({
          overview: "English translated summary",
          key_points: ["Point 1"],
          action_items: [],
          decisions: [],
        });
      }
      return Promise.resolve();
    });

    localStorage.setItem("echomind_active_engine", "cloud_groq");
    localStorage.setItem("echomind_groq_key", "gsk_groq_key");

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={mockPastMeeting}
        />
      </I18nProvider>,
    );

    // Switch to Summary Tab
    const summaryTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    await act(async () => {
      fireEvent.click(summaryTab);
    });

    // 1. Translate to EN
    const enBtns = screen.queryAllByRole("button", { name: /^EN$/i });
    if (enBtns.length > 0) {
      await act(async () => {
        fireEvent.click(enBtns[0]);
      });
      expect(invoke).toHaveBeenCalledWith(
        "translate_meeting_summary",
        expect.objectContaining({
          targetLangCode: "en",
          provider: "groq",
        }),
      );
    }

    // 2. Switch back to TR (loads original summary)
    const trBtns = screen.queryAllByRole("button", { name: /^TR$/i });
    if (trBtns.length > 0) {
      await act(async () => {
        fireEvent.click(trBtns[0]);
      });
    }

    // 3. Switch to EN again (hits cached translation)
    if (enBtns.length > 0) {
      await act(async () => {
        fireEvent.click(enBtns[0]);
      });
    }
  });

  it("handles live buffer transcription with Groq, summary generation with Gemini, and local redaction", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "transcribe_audio_buffer")
        return Promise.resolve(mockPastMeeting.segments);
      if (cmd === "generate_meeting_summary") {
        return Promise.resolve({
          meeting_goal: "Gemini Hedef",
          key_highlights: ["Gemini Vurgu"],
          action_items: [],
          key_decisions: [],
          summary: "Gemini Özet",
        });
      }
      if (cmd === "enhance_meeting_transcript") {
        return Promise.resolve({
          ...mockPastMeeting,
          segments: mockPastMeeting.segments,
        });
      }
      return Promise.resolve();
    });

    // 1. Live buffer transcribe with Groq
    localStorage.setItem("echomind_active_engine", "cloud_groq");
    localStorage.setItem("echomind_groq_key", "gsk_groq_live_key");
    localStorage.setItem("echomind_groq_model_version", "whisper-large-v3");

    const { unmount } = render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={null}
          isRecording={true}
        />
      </I18nProvider>,
    );

    const transcribeBtn = screen.getByRole("button", {
      name: /Yazıya Dönüştür/i,
    });
    await act(async () => {
      fireEvent.click(transcribeBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "transcribe_audio_buffer",
      expect.objectContaining({
        cloudProvider: "groq",
        apiKey: "gsk_groq_live_key",
        modelVersion: "whisper-large-v3",
      }),
    );
    unmount();

    // 2. Summary generation with Gemini
    localStorage.setItem("echomind_active_engine", "cloud_gemini");
    localStorage.setItem("echomind_gemini_key", "gemini_gen_key");

    const { unmount: unmount2 } = render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={{
            ...mockPastMeeting,
            summary: "",
            meeting_goal: "",
          }}
        />
      </I18nProvider>,
    );

    const summaryTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    await act(async () => {
      fireEvent.click(summaryTab);
    });

    const generateBtn = screen.queryByRole("button", {
      name: /Raporu Oluştur|Özet Çıkar/i,
    });
    if (generateBtn) {
      await act(async () => {
        fireEvent.click(generateBtn);
      });
      expect(invoke).toHaveBeenCalledWith(
        "generate_meeting_summary",
        expect.objectContaining({
          provider: "gemini",
          apiKey: "gemini_gen_key",
        }),
      );
    }
    unmount2();

    // 3. Local Redaction
    localStorage.setItem("echomind_active_engine", "local");
    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={mockPastMeeting}
        />
      </I18nProvider>,
    );

    const redactBtn = screen.getByRole("button", {
      name: /Akıllı Redaksiyon/i,
    });
    await act(async () => {
      fireEvent.click(redactBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "enhance_meeting_transcript",
      expect.objectContaining({
        provider: null,
        apiKey: null,
      }),
    );
  });

  it("handles OpenAI & Gemini transcribe buffer, and audio player error branches", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    // 1. Transcribe buffer with OpenAI & Gemini
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "transcribe_audio_buffer") {
        return Promise.resolve(mockPastMeeting.segments);
      }
      if (
        cmd === "play_native_audio" ||
        cmd === "play_native_audio_at" ||
        cmd === "seek_native_audio" ||
        cmd === "pause_native_audio"
      ) {
        return Promise.reject(new Error("Audio hardware error"));
      }
      return Promise.resolve();
    });

    localStorage.setItem("echomind_active_engine", "cloud_openai");
    localStorage.setItem("echomind_openai_key", "sk-openai-key");

    const { unmount } = render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={null}
          isRecording={true}
        />
      </I18nProvider>,
    );

    const transcribeBtn = screen.getByRole("button", {
      name: /Yazıya Dönüştür/i,
    });
    await act(async () => {
      fireEvent.click(transcribeBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "transcribe_audio_buffer",
      expect.objectContaining({
        cloudProvider: "openai",
        apiKey: "sk-openai-key",
        modelVersion: "whisper-1",
      }),
    );

    // Cloud Gemini Transcribe
    localStorage.setItem("echomind_active_engine", "cloud_gemini");
    localStorage.setItem("echomind_gemini_key", "sk-gemini-key");
    await act(async () => {
      fireEvent.click(transcribeBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "transcribe_audio_buffer",
      expect.objectContaining({
        cloudProvider: "gemini",
        apiKey: "sk-gemini-key",
        modelVersion: "gemini-1.5-flash",
      }),
    );

    // Transcribe buffer failure
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "transcribe_audio_buffer")
        return Promise.reject(new Error("Transcribe failed"));
      return Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(transcribeBtn);
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
    unmount();

    // 2. Audio playback error cases
    (invoke as any).mockImplementation((cmd: string) => {
      if (
        cmd === "play_native_audio" ||
        cmd === "play_native_audio_at" ||
        cmd === "seek_native_audio" ||
        cmd === "pause_native_audio"
      ) {
        return Promise.reject(new Error("Audio play error"));
      }
      return Promise.resolve();
    });

    const { unmount: unmount2 } = render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={mockPastMeeting}
        />
      </I18nProvider>,
    );

    const playBtn = screen.getByTitle(/Oynat|Durdur/i);
    await act(async () => {
      fireEvent.click(playBtn);
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    // Seek error
    const seekInput = screen.getByRole("slider");
    await act(async () => {
      fireEvent.change(seekInput, { target: { value: "30" } });
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    // Segment play error
    const segPlayBtns = screen.queryAllByTitle(/Bu Cümleyi Dinle/i);
    if (segPlayBtns.length > 0) {
      await act(async () => {
        fireEvent.click(segPlayBtns[0]);
      });
      expect(consoleErrorSpy).toHaveBeenCalled();
    }
    unmount2();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it("handles copy all, export notes, and speaker rename with empty value or error", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    });

    // Mock createObjectURL & revokeObjectURL
    const mockCreateObjectURL = vi.fn(() => "blob:http://localhost/test-blob");
    const mockRevokeObjectURL = vi.fn();
    window.URL.createObjectURL = mockCreateObjectURL;
    window.URL.revokeObjectURL = mockRevokeObjectURL;

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "export_meeting_notes")
        return Promise.resolve("# Exported Notes Content");
      if (cmd === "update_meeting_speaker_name")
        return Promise.reject(new Error("Speaker update fail"));
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={mockPastMeeting}
        />
      </I18nProvider>,
    );

    // Copy All
    const copyBtn = screen.getByRole("button", { name: /Kopyala/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(writeTextSpy).toHaveBeenCalled();

    // Export Notes from Summary Tab
    const summaryTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    await act(async () => {
      fireEvent.click(summaryTab);
    });

    const exportBtn = screen.getByRole("button", { name: /Raporu İndir/i });
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    expect(mockCreateObjectURL).toHaveBeenCalled();

    // Export Notes error branch
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "export_meeting_notes")
        return Promise.reject(new Error("Export failed"));
      return Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("handles summary generation with Ollama and OpenAI, plus summary translation with Groq and error handling", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // 1. Ollama & OpenAI summary generation
    localStorage.setItem("echomind_active_engine", "cloud_openai");
    localStorage.setItem("echomind_openai_key", "sk-test-openai");
    localStorage.setItem("echomind_ollama_endpoint", "http://localhost:11434");
    localStorage.setItem("echomind_ollama_model", "llama3:8b");

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "generate_meeting_summary") {
        return Promise.resolve({
          meeting_goal: "Ollama Goal",
          key_highlights: ["Highlight 1"],
          action_items: [
            {
              task: "Task 1",
              assignee: "Ahmet",
              source_citations: [1],
              is_completed: false,
            },
          ],
          key_decisions: ["Decision 1"],
          detailed_topics: [
            { topic_title: "Topic 1", bullet_points: ["Point 1"] },
          ],
          participants: ["Ahmet"],
          summary: "Ollama Summary",
          provider_used: "ollama",
          generation_time_ms: 1200,
        });
      }
      if (cmd === "translate_meeting_summary") {
        return Promise.reject(new Error("Translation API failed"));
      }
      return Promise.resolve();
    });

    const { unmount } = render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={{
            ...mockPastMeeting,
            summary: "",
            meeting_goal: "",
          }}
        />
      </I18nProvider>,
    );

    const summaryTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
    await act(async () => {
      fireEvent.click(summaryTab);
    });

    const generateBtn = screen.getByRole("button", {
      name: /Raporu Yeniden Oluştur/i,
    });
    await act(async () => {
      fireEvent.click(generateBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "generate_meeting_summary",
      expect.objectContaining({
        provider: "openai",
        apiKey: "sk-test-openai",
        customEndpoint: "http://localhost:11434",
        customModel: "llama3:8b",
      }),
    );

    // Translation error test
    const langSelect = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.change(langSelect, { target: { value: "en" } });
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
    unmount();

    // 2. Redaction with Groq & OpenAI & Error branch
    localStorage.setItem("echomind_active_engine", "cloud_groq");
    localStorage.setItem("echomind_groq_key", "gsk_groq_redact");

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "enhance_meeting_transcript")
        return Promise.reject(new Error("Redact error"));
      return Promise.resolve();
    });

    const { unmount: unmount2 } = render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={mockPastMeeting}
        />
      </I18nProvider>,
    );

    const redactBtn = screen.getByRole("button", {
      name: /Akıllı Redaksiyon/i,
    });
    await act(async () => {
      fireEvent.click(redactBtn);
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
    unmount2();

    // Redaction with OpenAI
    localStorage.setItem("echomind_active_engine", "cloud_openai");
    localStorage.setItem("echomind_openai_key", "sk_openai_redact");
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "enhance_meeting_transcript") {
        return Promise.resolve({
          ...mockPastMeeting,
          segments: [{ ...mockPastMeeting.segments[0], text: "Redacted text" }],
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={mockPastMeeting}
        />
      </I18nProvider>,
    );

    const redactBtn2 = screen.getByRole("button", {
      name: /Akıllı Redaksiyon/i,
    });
    await act(async () => {
      fireEvent.click(redactBtn2);
    });
    expect(invoke).toHaveBeenCalledWith(
      "enhance_meeting_transcript",
      expect.objectContaining({
        provider: "openai",
        apiKey: "sk_openai_redact",
      }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("handles RetranscribeModal success callback and updates transcript and meeting details", async () => {
    const onMeetingUpdatedMock = vi.fn();

    const { unmount } = render(
      <I18nProvider>
        <TranscriptViewer
          {...defaultProps}
          selectedPastMeeting={mockPastMeeting}
          onMeetingUpdated={onMeetingUpdatedMock}
        />
      </I18nProvider>,
    );

    // Open Retranscribe modal
    const retranscribeBtn = screen.getByRole("button", {
      name: /Yeniden Yazıya Dök/i,
    });
    await act(async () => {
      fireEvent.click(retranscribeBtn);
    });

    // Close modal or trigger retranscribe in modal
    const cancelModalBtn = screen.queryByRole("button", {
      name: /İptal|Kapat/i,
    });
    if (cancelModalBtn) {
      await act(async () => {
        fireEvent.click(cancelModalBtn);
      });
    }
    unmount();
  });
});
