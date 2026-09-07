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
    vi.stubGlobal("open", vi.fn());
  });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    meetingId: "mtg-001",
    meetingTitle: "Haftalık Sprint Toplantısı",
    activeSummary: mockSummary,
    langCode: "tr",
  };

  it("handles 1-click follow-up email, Slack export, and Linear/Notion tasks", async () => {
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === "open_meeting_html_report")
        return Promise.resolve("/tmp/report.html");
      if (cmd === "save_meeting_export_file")
        return Promise.resolve(`/tmp/saved.${args.exportType}`);
      if (cmd === "export_meeting_notes")
        return Promise.resolve("# Notes Markdown");
      if (cmd === "export_meeting_notes_slack")
        return Promise.resolve("*Slack Markdown*");
      if (cmd === "export_meeting_action_items_markdown")
        return Promise.resolve("- [ ] Task 1");
      if (cmd === "export_meeting_followup_email")
        return Promise.resolve({
          subject: "Takip & Notlar",
          body: "Toplantı özeti",
          mailto_url: "mailto:?subject=Takip&body=Ozet",
        });
      if (cmd === "export_meeting_email_digest")
        return Promise.resolve("Subject: Email Digest");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <ExportModal {...defaultProps} />
      </I18nProvider>,
    );

    // 1. Follow-up Email Client Open
    const openEmailBtn = screen.getByRole("button", {
      name: /E-Posta İstemcisinde Aç/i,
    });
    await act(async () => {
      fireEvent.click(openEmailBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "export_meeting_followup_email",
      expect.any(Object),
    );
    expect(screen.getByText(/E-posta istemcisi açıldı/i)).toBeInTheDocument();

    // 2. Open / Print HTML report
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

    // 3. Download buttons (html, md, tasks_csv, slack, txt, json)
    const downloadBtns = screen.getAllByRole("button", { name: /İndir|\.txt|\.json/i });
    for (const btn of downloadBtns) {
      await act(async () => {
        fireEvent.click(btn);
      });
    }
    expect(invoke).toHaveBeenCalledWith(
      "save_meeting_export_file",
      expect.objectContaining({ exportType: "tasks_csv" }),
    );
    expect(invoke).toHaveBeenCalledWith(
      "save_meeting_export_file",
      expect.objectContaining({ exportType: "html" }),
    );

    // 4. Copy buttons (Slack, Tasks md, Followup email, Markdown, Transcript)
    const copySlackBtn = screen.getByRole("button", {
      name: /Slack Formatında Kopyala/i,
    });
    await act(async () => {
      fireEvent.click(copySlackBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "export_meeting_notes_slack",
      expect.any(Object),
    );

    const copyTasksBtn = screen.getByRole("button", {
      name: /Görevleri Kopyala/i,
    });
    await act(async () => {
      fireEvent.click(copyTasksBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "export_meeting_action_items_markdown",
      expect.any(Object),
    );

    const copyEmailBtn = screen.getByRole("button", {
      name: /E-Posta Metnini Kopyala/i,
    });
    await act(async () => {
      fireEvent.click(copyEmailBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "export_meeting_followup_email",
      expect.any(Object),
    );

    // Copy all other buttons (Markdown and Transcript)
    const allCopyBtns = screen.getAllByRole("button", { name: /Kopyala/i });
    for (const btn of allCopyBtns) {
      await act(async () => {
        fireEvent.click(btn);
      });
    }
    expect(invoke).toHaveBeenCalledWith(
      "export_meeting_notes",
      expect.any(Object),
    );
  });

  it("handles empty mailto_url and empty props gracefully", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "export_meeting_followup_email") {
        return Promise.resolve({
          subject: "Konu",
          body: "Gövde",
          mailto_url: "",
        });
      }
      return Promise.resolve("");
    });

    render(
      <I18nProvider>
        <ExportModal
          isOpen={true}
          onClose={vi.fn()}
          meetingId="mtg-002"
          meetingTitle=""
          activeSummary={null}
          langCode={undefined}
        />
      </I18nProvider>,
    );

    const openEmailBtn = screen.getByRole("button", {
      name: /E-Posta İstemcisinde Aç/i,
    });
    await act(async () => {
      fireEvent.click(openEmailBtn);
    });
    expect(invoke).toHaveBeenCalledWith("export_meeting_followup_email", {
      meetingId: "mtg-002",
      customSummary: null,
      langCode: null,
    });
  });

  it("handles error states during email open, print, save, and copy", async () => {
    (invoke as any).mockRejectedValue(new Error("Export failed"));

    render(
      <I18nProvider>
        <ExportModal {...defaultProps} />
      </I18nProvider>,
    );

    // Email open error
    const openEmailBtn = screen.getByRole("button", {
      name: /E-Posta İstemcisinde Aç/i,
    });
    await act(async () => {
      fireEvent.click(openEmailBtn);
    });
    expect(screen.getByText(/E-posta istemcisi açılamadı/i)).toBeInTheDocument();

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
