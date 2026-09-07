import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AudioMemoPlayer } from "./AudioMemoPlayer";
import { SummaryResult } from "../TranscriptViewer";
import { I18nProvider } from "../../locales/i18nContext";

class MockSpeechSynthesisUtterance {
  text: string;
  lang: string = "";
  rate: number = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const mockSummary: SummaryResult = {
  meeting_goal: "Yeni özellikleri canlıya almak ve sprinti kapatmak",
  key_highlights: ["CI/CD hızı 2 dakikanın altına indirildi"],
  action_items: [
    {
      task: "Sürüm notlarını hazırla",
      assignee: "Sercan",
      source_citations: [],
      is_completed: false,
    },
    {
      task: "Genel görev",
      assignee: undefined,
      source_citations: [],
      is_completed: false,
    },
  ],
  phase1_agreed: [],
  phase2_deferred: [],
  detailed_topics: [],
  participants: ["Sercan", "Burak"],
  summary: "Toplantı çok verimli geçti.",
  key_decisions: ["v0.1.0 bu hafta yayınlanacak"],
  agenda_topics: [],
  provider_used: "EchoMind",
  generation_time_ms: 120,
};

describe("AudioMemoPlayer Component", () => {
  let mockUtteranceInstance: MockSpeechSynthesisUtterance | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).SpeechSynthesisUtterance = class extends MockSpeechSynthesisUtterance {
      constructor(text: string) {
        super(text);
        mockUtteranceInstance = this;
      }
    };
    (window as any).speechSynthesis = {
      speak: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    };
  });

  it("renders null when summary is not provided", () => {
    const { container } = render(
      <I18nProvider>
        <AudioMemoPlayer summary={null} />
      </I18nProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders audio memo bar and controls correctly", () => {
    render(
      <I18nProvider>
        <AudioMemoPlayer
          summary={mockSummary}
          meetingTitle="Sprint Demo"
          langCode="tr"
        />
      </I18nProvider>
    );

    expect(screen.getByText(/Sesli Bülteni Dinle/i)).toBeInTheDocument();
    expect(screen.getByText("1x")).toBeInTheDocument();
  });

  it("triggers play, pause, resume, speed toggle and stop with speechSynthesis", () => {
    render(
      <I18nProvider>
        <AudioMemoPlayer
          summary={mockSummary}
          meetingTitle="Sprint Demo"
          langCode="tr"
        />
      </I18nProvider>
    );

    const playBtn = screen.getByRole("button", { name: /Dinle/i });
    fireEvent.click(playBtn);

    expect(window.speechSynthesis.speak).toHaveBeenCalled();

    // Speed toggle while playing
    const speedBtn = screen.getByRole("button", { name: /1x/i });
    fireEvent.click(speedBtn);
    expect(screen.getByText("1.25x")).toBeInTheDocument();

    // Pause toggle
    const pauseBtn = screen.getByRole("button", { name: /Duraklatıldı/i });
    fireEvent.click(pauseBtn);
    expect(window.speechSynthesis.pause).toHaveBeenCalled();

    // Resume toggle
    fireEvent.click(pauseBtn);
    expect(window.speechSynthesis.resume).toHaveBeenCalled();

    // Trigger onend
    if (mockUtteranceInstance?.onend) {
      act(() => {
        mockUtteranceInstance?.onend?.();
      });
    }

    // Now it should show Dinle again
    const restartPlayBtn = screen.getByRole("button", { name: /Dinle/i });
    fireEvent.click(restartPlayBtn);

    // Stop
    const stopBtn = screen.getByTitle(/Durdur/i);
    fireEvent.click(stopBtn);
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  it("handles english summary narrative properly and empty fields", () => {
    const fullEnglishSummary: SummaryResult = {
      ...mockSummary,
      meeting_goal: "Launch Q3 Features",
      key_decisions: ["Adopt Next.js", "Deploy to Vercel"],
      action_items: [
        {
          task: "Write docs",
          assignee: "Alice",
          source_citations: [],
          is_completed: false,
        },
        {
          task: "Run QA",
          assignee: undefined,
          source_citations: [],
          is_completed: false,
        },
      ],
      summary: "Great progress achieved.",
    };

    render(
      <I18nProvider>
        <AudioMemoPlayer
          summary={fullEnglishSummary}
          meetingTitle="Q3 Planning"
          langCode="en"
        />
      </I18nProvider>
    );

    const playBtn = screen.getByRole("button", { name: /Dinle/i });
    fireEvent.click(playBtn);
    expect(window.speechSynthesis.speak).toHaveBeenCalled();

    // Speed toggle through all cycles while playing: 1 -> 1.25 -> 1.5 -> 2 -> 1
    const speedBtn = screen.getByRole("button", { name: /1x/i });
    fireEvent.click(speedBtn); // 1.25x
    fireEvent.click(speedBtn); // 1.5x
    fireEvent.click(speedBtn); // 2x
    fireEvent.click(speedBtn); // 1x

    if (mockUtteranceInstance?.onend) {
      act(() => {
        mockUtteranceInstance?.onend?.();
      });
    }

    // Toggle speed when not playing
    fireEvent.click(speedBtn);
    expect(screen.getByText("1.25x")).toBeInTheDocument();

    // Trigger error when playing
    fireEvent.click(playBtn);
    if (mockUtteranceInstance?.onerror) {
      act(() => {
        mockUtteranceInstance?.onerror?.();
      });
    }
  });

  it("handles empty fields in summary properly", () => {
    const emptySummary: SummaryResult = {
      ...mockSummary,
      meeting_goal: "",
      key_decisions: [],
      action_items: [],
      summary: "",
    };

    render(
      <I18nProvider>
        <AudioMemoPlayer
          summary={emptySummary}
          langCode="tr"
        />
      </I18nProvider>
    );

    const playBtn = screen.getByRole("button", { name: /Dinle/i });
    fireEvent.click(playBtn);
    expect(window.speechSynthesis.speak).toHaveBeenCalled();
  });

  it("handles browser unsupported alert gracefully", () => {
    const originalSynthesis = (window as any).speechSynthesis;
    delete (window as any).speechSynthesis;
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(
      <I18nProvider>
        <AudioMemoPlayer
          summary={mockSummary}
          langCode="tr"
        />
      </I18nProvider>
    );

    const playBtn = screen.getByRole("button", { name: /Dinle/i });
    fireEvent.click(playBtn);
    expect(alertSpy).toHaveBeenCalled();

    alertSpy.mockRestore();
    (window as any).speechSynthesis = originalSynthesis;
  });
});
