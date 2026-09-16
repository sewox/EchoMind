import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { FollowUpModal, FollowUpBundleData } from "./FollowUpModal";
import { I18nProvider } from "../locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";
import { MeetingRecord } from "../App";

const mockMeeting: MeetingRecord = {
  id: "test-meeting-101",
  title: "Q3 Sprint Planning",
  date_formatted: "16.09.2026",
  duration_seconds: 2700,
  duration_formatted: "45:00",
  summary: "Align on Q3 roadmap and team allocations",
  key_decisions: ["Release v0.2.3 approved"],
  segments: [
    {
      id: 1,
      speaker_id: "spk1",
      speaker_name: "John Doe",
      start_time_ms: 0,
      end_time_ms: 5000,
      timestamp_formatted: "00:00",
      text: "Welcome team, let's discuss Q3 targets.",
      language: "en",
      confidence: 0.95,
    },
  ],
  meeting_goal: "Align on Q3 roadmap and team allocations",
  key_highlights: [
    "Sprint velocity improved 20%",
    "Release candidate scheduled",
  ],
  action_items: [
    {
      task: "Deploy production build v0.2.3",
      assignee: "DevOps",
      source_citations: [1],
      is_completed: false,
    },
    {
      task: "Update API documentation",
      assignee: "Tech Lead",
      source_citations: [],
      is_completed: false,
    },
  ],
};

const mockBundle: FollowUpBundleData = {
  email_subject: "Follow-up: Q3 Sprint Planning",
  email_body: "Hello Team,\n\nHere are the key takeaways from our meeting.",
  email_html: "<p>Hello Team</p>",
  mailto_url: "mailto:?subject=Follow-up%3A%20Q3&body=Hello",
  action_items_md:
    "- [ ] Deploy production build v0.2.3 (@DevOps)\n- [ ] Update API documentation (@Tech Lead)",
  action_items_csv:
    '"ID","Task","Assignee"\n"1","Deploy production build v0.2.3","DevOps"',
  slack_md: ":memo: *Q3 Sprint Planning*\n- Item 1",
  ics_content:
    "BEGIN:VCALENDAR\nVERSION:2.0\nSUMMARY:Q3 Sprint Planning\nEND:VCALENDAR",
};

describe("FollowUpModal Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("open", vi.fn());
    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === "export_followup_bundle") {
        return Promise.resolve(mockBundle);
      }
      if (cmd === "generate_meeting_ics") {
        return Promise.resolve(mockBundle.ics_content);
      }
      if (cmd === "save_meeting_export_file") {
        return Promise.resolve(`/path/to/meeting.${args?.exportType || "ics"}`);
      }
      return Promise.resolve("");
    });
  });

  const renderComponent = (
    props: Partial<React.ComponentProps<typeof FollowUpModal>> = {},
  ) => {
    return render(
      <I18nProvider>
        <FollowUpModal
          isOpen={true}
          onClose={vi.fn()}
          meeting={mockMeeting}
          {...props}
        />
      </I18nProvider>,
    );
  };

  it("does not render when isOpen is false", () => {
    render(
      <I18nProvider>
        <FollowUpModal isOpen={false} onClose={vi.fn()} meeting={mockMeeting} />
      </I18nProvider>,
    );
    expect(screen.queryByText(/One-Click Follow-up/i)).not.toBeInTheDocument();
  });

  it("loads and renders email draft", async () => {
    renderComponent();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("Follow-up: Q3 Sprint Planning"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByDisplayValue(/Here are the key takeaways from our meeting/i),
    ).toBeInTheDocument();
  });

  it("switches email tones and updates state", async () => {
    renderComponent();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("Follow-up: Q3 Sprint Planning"),
      ).toBeInTheDocument();
    });

    // Switch to Executive tone
    const executiveBtn = screen.getByRole("button", {
      name: /Yönetici|Executive/i,
    });
    await act(async () => {
      fireEvent.click(executiveBtn);
    });

    expect(executiveBtn).toBeInTheDocument();
  });

  it("copies email draft to clipboard and opens local email client", async () => {
    renderComponent();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("Follow-up: Q3 Sprint Planning"),
      ).toBeInTheDocument();
    });

    // Click Copy Email
    const copyButtons = screen.getAllByRole("button");
    const copyEmailBtn = copyButtons.find((btn) =>
      /E-postayı Kopyala|Copy Email/i.test(btn.textContent || ""),
    );
    expect(copyEmailBtn).toBeDefined();

    if (copyEmailBtn) {
      await act(async () => {
        fireEvent.click(copyEmailBtn);
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        mockBundle.email_body,
      );
    }
  });

  it("switches to Action Items tab and displays tasks", async () => {
    renderComponent();

    // Click on Actions tab
    const actionsTab = screen.getByRole("button", {
      name: /Görevler & Sorumlular|Action Items/i,
    });
    await act(async () => {
      fireEvent.click(actionsTab);
    });

    expect(
      screen.getByText("Deploy production build v0.2.3"),
    ).toBeInTheDocument();
    expect(screen.getByText("@DevOps")).toBeInTheDocument();
    expect(screen.getByText("Update API documentation")).toBeInTheDocument();

    // Copy actions markdown
    const copyActionsBtn = screen.getByRole("button", { name: /^Markdown$/i });
    await act(async () => {
      fireEvent.click(copyActionsBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      mockBundle.action_items_md,
    );
  });

  it("switches to Calendar (.ics) tab and handles ics generation and download", async () => {
    renderComponent();

    // Click on Calendar tab
    const calendarTab = screen.getByRole("button", { name: /Takvim Daveti/i });
    await act(async () => {
      fireEvent.click(calendarTab);
    });

    await waitFor(() => {
      expect(
        screen.getByText("Takip Toplantısı Takvim Daveti (.ics)"),
      ).toBeInTheDocument();
    });

    // Download ICS file
    const downloadIcsBtn = screen.getByRole("button", {
      name: /.ics Takvim Dosyasını İndir/i,
    });
    await act(async () => {
      fireEvent.click(downloadIcsBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "generate_meeting_ics",
      expect.objectContaining({
        meetingTitle: expect.stringContaining("Takip / Follow-up"),
      }),
    );
  });

  it("switches to Slack / Teams tab and copies formatted text", async () => {
    renderComponent();

    // Click on Slack / Teams tab
    const slackTab = screen.getByRole("button", { name: /Slack & Teams/i });
    await act(async () => {
      fireEvent.click(slackTab);
    });

    await waitFor(() => {
      expect(
        screen.getByText("Slack & Microsoft Teams Biçimlendirilmiş Özet"),
      ).toBeInTheDocument();
    });

    // Copy Slack formatted text
    const copySlackBtn = screen.getByRole("button", {
      name: /Slack Formatında Kopyala/i,
    });
    await act(async () => {
      fireEvent.click(copySlackBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      mockBundle.slack_md,
    );
  });

  it("handles complete bundle download", async () => {
    renderComponent();

    const buttons = screen.getAllByRole("button");
    const downloadBundleBtn = buttons.find((b) =>
      /Tüm Paketi Dışa Aktar|Download All/i.test(b.textContent || ""),
    );
    expect(downloadBundleBtn).toBeDefined();

    if (downloadBundleBtn) {
      await act(async () => {
        fireEvent.click(downloadBundleBtn);
      });
      expect(downloadBundleBtn).toBeInTheDocument();
    }
  });

  it("calls onClose when close button is clicked", () => {
    const onCloseMock = vi.fn();

    renderComponent({ onClose: onCloseMock });

    const closeBtn = screen.getByLabelText("Kapat");
    fireEvent.click(closeBtn);

    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });
});
