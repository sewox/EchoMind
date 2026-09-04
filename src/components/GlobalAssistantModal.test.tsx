import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  GlobalAssistantModal,
  GlobalSearchResult,
} from "./GlobalAssistantModal";
import { I18nProvider } from "../locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";
import { MeetingRecord } from "../App";

const mockMeetings: MeetingRecord[] = [
  {
    id: "mtg-001",
    title: "Q3 Bütçe ve Lojistik",
    date_formatted: "01.09.2026",
    duration_seconds: 300,
    duration_formatted: "05:00",
    audio_file_path: "/path/to/meeting.flac",
    segments: [],
    summary: "Depo yatırımı için onay alındı.",
    key_decisions: ["Depo yatırımı onaylandı."],
    meeting_goal: "Bütçe onaylamak",
    action_items: [
      {
        task: "Kontrat imzalanacak",
        assignee: "Ahmet",
        source_citations: [],
        is_completed: false,
      },
    ],
  },
];

const mockSearchResults: GlobalSearchResult[] = [
  {
    meeting_id: "mtg-001",
    meeting_title: "Q3 Bütçe ve Lojistik",
    date_formatted: "01.09.2026",
    duration_formatted: "05:00",
    score: 95,
    matches: [
      {
        match_type: "decision",
        matched_text: "Depo yatırımı onaylandı.",
        snippet: "Depo yatırımı onaylandı.",
        timestamp_formatted: "02:15",
      },
    ],
  },
];

describe("GlobalAssistantModal Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    pastMeetings: mockMeetings,
    onSelectMeeting: vi.fn(),
  };

  it("renders chat interface, sends prompt questions, and handles citation clicks", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "ask_global_assistant") {
        return Promise.resolve({
          answer: "Alınan karar: Depo yatırımı onaylandı.",
          cited_meeting_ids: ["mtg-001"],
          provider_used: "Groq Cloud Llama-3.3-70B",
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <GlobalAssistantModal {...defaultProps} />
      </I18nProvider>,
    );

    expect(
      screen.getAllByText(/EchoMind Akıllı Asistan/i).length,
    ).toBeGreaterThan(0);

    // 1. Click on a quick prompt chip
    const promptChip = screen.getByText(/Alınan Tüm Kritik Kararlar/i);
    await act(async () => {
      fireEvent.click(promptChip);
    });

    expect(invoke).toHaveBeenCalledWith(
      "ask_global_assistant",
      expect.objectContaining({
        query: expect.any(String),
      }),
    );

    // Answer should be rendered
    expect(
      await screen.findByText(/Alınan karar: Depo yatırımı onaylandı/i),
    ).toBeInTheDocument();

    // Citation button click
    const citationBtn = await screen.findByRole("button", {
      name: /Toplantıyı Aç/i,
    });
    await act(async () => {
      fireEvent.click(citationBtn);
    });
    expect(defaultProps.onSelectMeeting).toHaveBeenCalledWith("mtg-001");
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("handles chat question submission from input field and handles assistant errors", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "ask_global_assistant") {
        return Promise.reject("API bağlantı zaman aşımı");
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <GlobalAssistantModal {...defaultProps} />
      </I18nProvider>,
    );

    const input = screen.getByPlaceholderText(
      /Toplantılarım hakkında bir şey sor/i,
    );
    fireEvent.change(input, { target: { value: "Bütçe onaylandı mı?" } });

    const submitBtn = screen.getByRole("button", { name: /^Sor$/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(
      await screen.findByText(/⚠️ Soru yanıtlanırken bir hata oluştu/i),
    ).toBeInTheDocument();
  });

  it("allows switching to global search tab, filtering by categories, and jumping to search results", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "global_search_meetings") {
        return Promise.resolve(mockSearchResults);
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <GlobalAssistantModal {...defaultProps} />
      </I18nProvider>,
    );

    // Switch to Search Tab
    const searchTab = screen.getByRole("button", { name: /Ara\.\.\./i });
    await act(async () => {
      fireEvent.click(searchTab);
    });

    const searchInput = screen.getByPlaceholderText(/Tüm toplantı başlıkları/i);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "Bütçe" } });
    });

    expect(await screen.findByText("Q3 Bütçe ve Lojistik")).toBeInTheDocument();
    expect(
      await screen.findByText(/Depo yatırımı onaylandı/i),
    ).toBeInTheDocument();

    // Filter by Decision pill
    const decisionPill = screen.getByRole("button", { name: /⚡ Kararlar/i });
    fireEvent.click(decisionPill);

    // Filter by Action Items pill
    const actionPill = screen.getByRole("button", {
      name: /✅ Eylem Maddeleri/i,
    });
    fireEvent.click(actionPill);

    // Filter by All
    const allPill = screen.getByRole("button", { name: "Tümü" });
    fireEvent.click(allPill);

    // Click on result "Toplantıya Git" button
    const goToMeetingBtn = screen.getByRole("button", {
      name: /Toplantıya Git/i,
    });
    await act(async () => {
      fireEvent.click(goToMeetingBtn);
    });
    expect(defaultProps.onSelectMeeting).toHaveBeenCalledWith("mtg-001");

    // Switch back to Chat Tab
    const chatTab = screen.getByRole("button", {
      name: /EchoMind Akıllı Asistan/i,
    });
    fireEvent.click(chatTab);
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <I18nProvider>
        <GlobalAssistantModal {...defaultProps} isOpen={false} />
      </I18nProvider>,
    );

    expect(container.firstChild).toBeNull();
  });
});
