import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ExportModal } from "./ExportModal";
import { I18nProvider } from "../locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";

const mockSummary = {
  meeting_goal: "Q3 Bütçe hedeflerini onaylamak",
  summary: "Tüm departman bütçeleri onaylandı.",
  executive_summary: "Tüm departman bütçeleri onaylandı.",
  key_decisions: ["Depo yatırımı için 500k bütçe ayrıldı."],
  action_items: [
    {
      task: "Kira sözleşmesini imzala",
      assignee: "Ahmet",
      source_citations: [],
      is_completed: false,
    },
  ],
  key_highlights: ["Yeni depo lokasyonu seçildi"],
  detailed_topics: [],
  agenda_topics: [],
  phase1_agreed: [],
  phase2_deferred: [],
  participants: ["Ahmet"],
  provider_used: "Gemini",
  generation_time_ms: 1200,
};

describe("ExportModal Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    meetingId: "mtg-001",
    meetingTitle: "Haftalık Sprint Toplantısı",
    activeSummary: mockSummary,
    langCode: "tr",
  };

  it("handles html report printing, file saving, and copy operations", async () => {
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === "open_meeting_html_report")
        return Promise.resolve("/tmp/report.html");
      if (cmd === "save_meeting_export_file")
        return Promise.resolve(`/tmp/saved.${args.exportType}`);
      if (cmd === "export_meeting_notes")
        return Promise.resolve("# Notes Markdown");
      if (cmd === "export_meeting_email_digest")
        return Promise.resolve("Subject: Email Digest");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <ExportModal {...defaultProps} />
      </I18nProvider>,
    );

    // 1. Open / Print HTML report
    const printBtn = screen.getByRole("button", {
      name: /Raporu Aç \/ Yazdır/i,
    });
    await act(async () => {
      fireEvent.click(printBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "open_meeting_html_report",
      expect.any(Object),
    );
    expect(
      screen.getByText(/Görsel rapor varsayılan tarayıcınızda açıldı/i),
    ).toBeInTheDocument();

    // 2. Download each format (.html, .md, .txt, .json)
    const downloadBtns = screen.getAllByRole("button", { name: /İndir/i });
    for (const btn of downloadBtns) {
      await act(async () => {
        fireEvent.click(btn);
      });
    }
    expect(invoke).toHaveBeenCalledWith(
      "save_meeting_export_file",
      expect.objectContaining({ exportType: "html" }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "save_meeting_export_file",
      expect.objectContaining({ exportType: "md" }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "save_meeting_export_file",
      expect.objectContaining({ exportType: "txt" }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "save_meeting_export_file",
      expect.objectContaining({ exportType: "json" }),
    );

    // 3. Copy operations
    const copyBtns = screen.getAllByRole("button", { name: /Kopyala/i });
    for (const btn of copyBtns) {
      await act(async () => {
        fireEvent.click(btn);
      });
    }
    expect(invoke).toHaveBeenCalledWith(
      "export_meeting_notes",
      expect.any(Object),
    );
    expect(invoke).toHaveBeenCalledWith(
      "export_meeting_email_digest",
      expect.any(Object),
    );
  });

  it("handles error states during print, save, and copy", async () => {
    (invoke as any).mockRejectedValue(new Error("Export failed"));

    render(
      <I18nProvider>
        <ExportModal {...defaultProps} />
      </I18nProvider>,
    );

    // Print error
    const printBtn = screen.getByRole("button", {
      name: /Raporu Aç \/ Yazdır/i,
    });
    await act(async () => {
      fireEvent.click(printBtn);
    });
    expect(screen.getByText(/Görsel rapor açılamadı/i)).toBeInTheDocument();

    // Save error
    const downloadBtns = screen.getAllByRole("button", { name: /İndir/i });
    await act(async () => {
      fireEvent.click(downloadBtns[0]);
    });
    expect(screen.getByText(/Dosya kaydedilemedi/i)).toBeInTheDocument();

    // Copy error
    const copyBtns = screen.getAllByRole("button", { name: /Kopyala/i });
    await act(async () => {
      fireEvent.click(copyBtns[0]);
    });
    expect(screen.getByText(/Kopyalama başarısız oldu/i)).toBeInTheDocument();
  });

  it("handles user cancelling the file save dialog gracefully", async () => {
    (invoke as any).mockRejectedValue("Kullanıcı dosya kaydetmeyi iptal etti");

    render(
      <I18nProvider>
        <ExportModal {...defaultProps} />
      </I18nProvider>,
    );

    const downloadBtns = screen.getAllByRole("button", { name: /İndir/i });
    await act(async () => {
      fireEvent.click(downloadBtns[0]);
    });
    // Should not show error alert
    expect(screen.queryByText(/Dosya kaydedilemedi/i)).toBeNull();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <I18nProvider>
        <ExportModal {...defaultProps} isOpen={false} />
      </I18nProvider>,
    );

    expect(container.firstChild).toBeNull();
  });
});
