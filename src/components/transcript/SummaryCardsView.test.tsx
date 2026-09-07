import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SummaryCardsView } from "./SummaryCardsView";
import { I18nProvider } from "../../locales/i18nContext";
import { SummaryResult } from "../TranscriptViewer";

describe("SummaryCardsView Component", () => {
  const mockRichSummary: SummaryResult = {
    meeting_goal: "Q3 Finansal hedefleri belirlemek",
    key_highlights: ["Yurt dışı depo yatırımı onaylandı"],
    action_items: [
      {
        task: "Kira sözleşmesi imzalanacak",
        assignee: "Ahmet",
        source_citations: [1],
        is_completed: false,
      },
    ],
    phase1_agreed: ["Q3 bütçesi onaylandı"],
    phase2_deferred: ["Ek personel alımı ertelendi"],
    detailed_topics: [
      {
        topic_title: "Bütçe Planlama",
        bullet_points: [
          "Maliyetler %20 düşürülecek",
          "Yeni tedarikçi aranacak",
        ],
      },
    ],
    participants: ["Ahmet", "Mehmet"],
    summary: "Genel toplantı özeti",
    key_decisions: ["Depo açılışı kararlaştırıldı"],
    agenda_topics: [],
    provider_used: "Gemini 2.0",
    generation_time_ms: 120,
  };

  const defaultProps = {
    richSummary: mockRichSummary,
    summaryLang: "tr",
    isTranslating: false,
    selectedPastMeeting: {
      id: "mtg-1",
      title: "Q3 Planlama",
      date_formatted: "01.09.2026",
      duration_seconds: 120,
      duration_formatted: "02:00",
      segments: [],
      summary: "",
      key_decisions: [],
    },
    onLanguageChange: vi.fn(),
    onToggleActionItem: vi.fn(),
    onJumpToCitation: vi.fn(),
    onGenerateSummary: vi.fn(),
    onOpenRetranscribe: vi.fn(),
    onExportNotes: vi.fn(),
    selectedTemplateId: "general",
    customTemplates: [],
    onSelectTemplate: vi.fn(),
    onOpenCreateCustom: vi.fn(),
    onDeleteCustomTemplate: vi.fn(),
  };

  it("renders executive summary cards and handles language translation, templates, and action buttons", () => {
    render(
      <I18nProvider>
        <SummaryCardsView {...defaultProps} />
      </I18nProvider>,
    );

    expect(screen.getByText("Q3 Finansal hedefleri belirlemek")).toBeInTheDocument();
    expect(screen.getByText("Yurt dışı depo yatırımı onaylandı")).toBeInTheDocument();
    expect(screen.getByText("Kira sözleşmesi imzalanacak")).toBeInTheDocument();
    expect(screen.getByText("Toplantı Şablonları:")).toBeInTheDocument();
    expect(screen.getByText("Bütçe Planlama")).toBeInTheDocument();
    expect(screen.getByText("Maliyetler %20 düşürülecek")).toBeInTheDocument();
    expect(screen.getByText("Ahmet")).toBeInTheDocument();

    // Export button click
    const exportBtn = screen.getByRole("button", { name: /Raporu İndir/i });
    fireEvent.click(exportBtn);
    expect(defaultProps.onExportNotes).toHaveBeenCalled();

    // Language selector change
    const langSelect = screen.getByRole("combobox");
    fireEvent.change(langSelect, { target: { value: "en" } });
    expect(defaultProps.onLanguageChange).toHaveBeenCalledWith("en");

    // Toggle Action Item Checkbox
    const toggleActionBtn = screen.getByRole("button", { name: "" });
    fireEvent.click(toggleActionBtn);
    expect(defaultProps.onToggleActionItem).toHaveBeenCalledWith(0);

    // Click Citation Badge
    const citeBadge = screen.getByTitle(/Transkript #1 referansına git/i);
    fireEvent.click(citeBadge);
    expect(defaultProps.onJumpToCitation).toHaveBeenCalledWith(1);
  });

  it("disables language selector when isTranslating is true", () => {
    render(
      <I18nProvider>
        <SummaryCardsView {...defaultProps} isTranslating={true} />
      </I18nProvider>,
    );

    const langSelect = screen.getByRole("combobox");
    expect(langSelect).toBeDisabled();
  });

  it("renders empty placeholder when richSummary is null and meeting has no summary", () => {
    render(
      <I18nProvider>
        <SummaryCardsView
          {...defaultProps}
          richSummary={null}
          selectedPastMeeting={null}
        />
      </I18nProvider>,
    );

    expect(
      screen.getByText(/Toplantı Raporu Henüz Hazırlanmadı/i),
    ).toBeInTheDocument();
  });
});
