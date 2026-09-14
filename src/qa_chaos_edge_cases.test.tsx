import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "./App";
import TranscriptViewer from "./components/TranscriptViewer";
import { ExportModal } from "./components/ExportModal";
import { CustomTemplateModal } from "./components/transcript/CustomTemplateModal";
import { MeetingAnalyticsModal } from "./components/transcript/MeetingAnalyticsModal";
import { GlobalAssistantModal } from "./components/GlobalAssistantModal";
import { I18nProvider } from "./locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";

const adversarialStrings = [
  "<script>alert('xss')</script>",
  "'; DROP TABLE meetings; --",
  "{{7*7}} ${7*7}",
  "💥🔥🚀🎉 Çoklu Emoji ve UTF-8 Boşluklar \u200B\u200C\u200D\uFEFF",
  "A".repeat(5000), // Aşırı uzun metin
  "   \t\n   ", // Sadece beyaz boşluk
];

describe("Senior QA Edge-Case & Chaos / Monkey Testing Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  /* -------------------------------------------------------------------------- */
  /* 1. Empty & Corrupted State Resilience                                      */
  /* -------------------------------------------------------------------------- */
  describe("1. Empty & Corrupted Data Resilience", () => {
    it("handles completely empty meeting without crashing in TranscriptViewer", async () => {
      const corruptedMeeting: any = {
        id: "corrupt-1",
        title: "",
        date_formatted: "",
        duration_seconds: 0,
        duration_formatted: "00:00",
        segments: [], // Boş transkript
        summary: "", // Boş özet
        key_decisions: [],
        meeting_goal: null,
        action_items: null, // null/undefined
      };

      const { unmount } = render(
        <I18nProvider>
          <TranscriptViewer
            isRecording={false}
            isSpeaking={false}
            selectedLanguage="tr"
            onLanguageChange={vi.fn()}
            selectedPastMeeting={corruptedMeeting}
          />
        </I18nProvider>,
      );

      // Tab switching should never crash
      const reportTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
      await act(async () => {
        fireEvent.click(reportTab);
      });

      const tasksTab = screen.queryByRole("button", { name: /Görevler & Kararlar/i });
      if (tasksTab) {
        await act(async () => {
          fireEvent.click(tasksTab);
        });
      }

      unmount();
    });

    it("handles meeting with undefined/null fields in ExportModal without crash", async () => {
      render(
        <I18nProvider>
          <ExportModal
            isOpen={true}
            onClose={vi.fn()}
            meetingId="empty-exp"
            meetingTitle=""
            activeSummary={null}
          />
        </I18nProvider>,
      );

      // Cycle all export tabs
      const tabs = ["Markdown", "HTML", "Slack & Teams", "Takip E-Postası", "Görevler (CSV/MD)"];
      for (const tabName of tabs) {
        const tabBtn = screen.queryByRole("button", { name: new RegExp(tabName, "i") });
        if (tabBtn) {
          await act(async () => {
            fireEvent.click(tabBtn);
          });
        }
      }
    });

    it("handles zero participants and zero duration in MeetingAnalyticsModal", () => {
      const emptyAnalytics: any = {
        total_duration_seconds: 0,
        total_speech_seconds: 0,
        total_silence_seconds: 0,
        silence_percentage: 0,
        total_words: 0,
        average_wpm: 0,
        meeting_balance_score: 0,
        speaker_stats: [],
        dominant_speaker: null,
        dominant_speaker_percentage: 0,
        meeting_pace_label: "Unknown",
        key_insights: [],
      };

      const { container } = render(
        <I18nProvider>
          <MeetingAnalyticsModal
            isOpen={true}
            onClose={vi.fn()}
            analytics={emptyAnalytics}
            meetingTitle=""
          />
        </I18nProvider>,
      );

      expect(container).toBeInTheDocument();
      expect(screen.getByText("%0")).toBeInTheDocument();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. Adversarial User Inputs & XSS / Injection Tests                         */
  /* -------------------------------------------------------------------------- */
  describe("2. Adversarial & Chaotic Input Handling", () => {
    it("handles adversarial titles and prompt injections in CustomTemplateModal", async () => {
      const onSaveMock = vi.fn();

      render(
        <I18nProvider>
          <CustomTemplateModal
            isOpen={true}
            onClose={vi.fn()}
            onSaveTemplate={onSaveMock}
          />
        </I18nProvider>,
      );

      const titleInput = screen.getByPlaceholderText(/Örn: Haftalık Pazarlama Değerlendirmesi/i);
      const promptInput = screen.getByPlaceholderText(/SEN KIDEMLİ BİR PAZARLAMA/i);
      const saveBtn = screen.getByRole("button", { name: /Şablonu Kaydet/i });

      // Test 1: Empty input submission should be prevented (disabled or ignored)
      fireEvent.change(titleInput, { target: { value: "   " } });
      fireEvent.change(promptInput, { target: { value: "" } });
      fireEvent.click(saveBtn);
      expect(onSaveMock).not.toHaveBeenCalled();

      // Test 2: Adversarial XSS input
      for (const adv of adversarialStrings) {
        fireEvent.change(titleInput, { target: { value: adv } });
        fireEvent.change(promptInput, { target: { value: adv } });
        await act(async () => {
          fireEvent.click(saveBtn);
        });
        if (adv.trim().length > 0) {
          expect(onSaveMock).toHaveBeenCalledWith(
            expect.objectContaining({
              name: adv.trim(),
              systemPrompt: adv.trim(),
            }),
          );
          onSaveMock.mockClear();
        }
      }
    });

    it("handles adversarial search queries in GlobalAssistantModal without exception", async () => {
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === "get_cross_meeting_memory_stats") {
          return Promise.resolve({
            total_meetings: 10,
            total_segments: 100,
            total_words: 5000,
            unique_speakers: ["Ali", "Veli"],
          });
        }
        if (cmd === "search_cross_meeting_memory") {
          return Promise.resolve([]);
        }
        return Promise.resolve();
      });

      render(
        <I18nProvider>
          <GlobalAssistantModal
            isOpen={true}
            onClose={vi.fn()}
          />
        </I18nProvider>,
      );

      // Switch to search tab
      const searchTab = screen.getByRole("button", { name: /Ara\.\.\./i });
      fireEvent.click(searchTab);

      const searchInput = screen.getByPlaceholderText(/Tüm toplantı başlıkları/i);

      for (const query of adversarialStrings) {
        await act(async () => {
          fireEvent.change(searchInput, { target: { value: query } });
        });
        if (query.trim().length > 0) {
          expect(invoke).toHaveBeenCalledWith(
            "search_cross_meeting_memory",
            expect.objectContaining({
              options: expect.objectContaining({
                query: query.trim(),
              }),
            }),
          );
        }
      }
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. Rapid Monkey Clicking & Concurrency Simulation                          */
  /* -------------------------------------------------------------------------- */
  describe("3. Rapid Actions & Monkey Testing", () => {
    it("handles rapid language switching and simultaneous clicks without crashing", async () => {
      (invoke as any).mockImplementation(() => Promise.resolve([]));

      render(
        <I18nProvider>
          <App />
        </I18nProvider>,
      );

      // Rapidly switch languages across all options
      const langSelect = screen.getByRole("combobox");
      const languages = ["tr", "en", "de", "fr", "es", "tr"];
      for (const lang of languages) {
        await act(async () => {
          fireEvent.change(langSelect, { target: { value: lang } });
        });
      }

      // Spam click recording toggle / available action buttons
      const buttons = screen.getAllByRole("button");
      for (let i = 0; i < Math.min(buttons.length, 5); i++) {
        await act(async () => {
          fireEvent.click(buttons[i]);
        });
      }
    });

    it("handles rapid tab switching in TranscriptViewer", async () => {
      (invoke as any).mockImplementation(() => Promise.resolve());

      const mockPastMeeting: any = {
        id: "m-rapid",
        title: "Rapid Tab Meeting",
        date_formatted: "01.01.2026",
        duration_seconds: 120,
        duration_formatted: "02:00",
        segments: [
          {
            id: 1,
            speaker_id: "spk1",
            speaker_name: "Can",
            start_time_ms: 0,
            end_time_ms: 2000,
            timestamp_formatted: "00:00",
            text: "Hızlı geçiş testi yapılıyor.",
          },
        ],
        summary: "Özet metni",
        key_decisions: ["Karar 1"],
        action_items: [{ task: "Görev 1", is_completed: false }],
      };

      render(
        <I18nProvider>
          <TranscriptViewer
            isRecording={false}
            isSpeaking={false}
            selectedLanguage="tr"
            onLanguageChange={vi.fn()}
            selectedPastMeeting={mockPastMeeting}
          />
        </I18nProvider>,
      );

      const streamTab = screen.getByRole("button", { name: /Konuşma Akışı/i });
      const reportTab = screen.getByRole("button", { name: /Toplantı Raporu/i });
      const tasksTab = screen.getByRole("button", { name: /Görevler & Kararlar/i });

      // Rapid cycle 10 times
      for (let i = 0; i < 10; i++) {
        await act(async () => {
          fireEvent.click(reportTab);
          fireEvent.click(tasksTab);
          fireEvent.click(streamTab);
        });
      }

      expect(screen.getByText("Hızlı geçiş testi yapılıyor.")).toBeInTheDocument();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. Complete Backend Failure / Error Resilience                             */
  /* -------------------------------------------------------------------------- */
  describe("4. IPC & Network Failure Resilience", () => {
    it("gracefully catches all backend IPC rejections across all features", async () => {
      // Backend is down / throwing errors on every invoke
      (invoke as any).mockRejectedValue(new Error("IPC Network Bridge Disconnected"));

      const mockPastMeeting: any = {
        id: "m-fail",
        title: "Failing Meeting",
        date_formatted: "01.01.2026",
        duration_seconds: 60,
        duration_formatted: "01:00",
        segments: [
          {
            id: 1,
            speaker_id: "spk1",
            speaker_name: "Test",
            start_time_ms: 0,
            end_time_ms: 1000,
            timestamp_formatted: "00:00",
            text: "Hata testi",
          },
        ],
        summary: "Özet",
        key_decisions: ["Karar"],
        action_items: [{ task: "Aksiyon", is_completed: false }],
      };

      render(
        <I18nProvider>
          <TranscriptViewer
            isRecording={false}
            isSpeaking={false}
            selectedLanguage="tr"
            onLanguageChange={vi.fn()}
            selectedPastMeeting={mockPastMeeting}
          />
        </I18nProvider>,
      );

      // 1. Cleaner toggle with backend error
      const cleanerBtn = screen.queryByRole("button", { name: /Konuşmayı Netleştir/i });
      if (cleanerBtn) {
        await act(async () => {
          fireEvent.click(cleanerBtn);
        });
      }

      // 2. Soundbite clip with backend error
      const clipBtn = screen.queryByTitle(/Ses Parçası Kırp/i);
      if (clipBtn) {
        await act(async () => {
          fireEvent.click(clipBtn);
        });
      }

      // 3. Analytics button with backend error
      const analyticsBtn = screen.queryByRole("button", { name: /Katılımcı & Toplantı Analitiği/i });
      if (analyticsBtn) {
        await act(async () => {
          fireEvent.click(analyticsBtn);
        });
      }

      // UI must remain intact and functional
      expect(screen.getByText("Hata testi")).toBeInTheDocument();
    });
  });
});
