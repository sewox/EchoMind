import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RelatedMeetingsCard } from "./RelatedMeetingsCard";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../locales/i18nContext", () => ({
  useI18n: () => ({
    t: (k: string) => k,
  }),
}));

describe("RelatedMeetingsCard Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and renders related meetings with similarity score", async () => {
    const mockRelated = [
      {
        id: "rel-1",
        title: "Q3 Bulut Altyapı Bütçe Planı",
        date_formatted: "15 Ağustos 2026",
        similarity_score: 0.85,
        shared_tags: ["Finans & Bütçe", "Yazılım & Teknoloji"],
        shared_participants: ["Ahmet", "Can"],
        reason: "Ortak etiketler ve katılımcılar",
      },
    ];

    (invoke as any).mockResolvedValueOnce(mockRelated);

    const onSelectMeeting = vi.fn();

    render(
      <RelatedMeetingsCard
        meetingId="curr-1"
        onSelectMeeting={onSelectMeeting}
      />,
    );

    expect(invoke).toHaveBeenCalledWith("get_related_meetings", {
      meetingId: "curr-1",
      maxResults: 4,
    });

    await waitFor(() => {
      expect(
        screen.getByText("Q3 Bulut Altyapı Bütçe Planı"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("%85 relatedMeetings.similarityScore"),
      ).toBeInTheDocument();
      expect(screen.getByText("Finans & Bütçe")).toBeInTheDocument();
      expect(screen.getByText("Ahmet, Can")).toBeInTheDocument();
    });

    const jumpButton = screen.getByText("relatedMeetings.jumpToMeeting");
    fireEvent.click(jumpButton);
    expect(onSelectMeeting).toHaveBeenCalledWith("rel-1");
  });

  it("renders low similarity score, missing tags or participants, and handles error catch", async () => {
    const mockLowScore = [
      {
        id: "rel-low",
        title: "Düşük Benzerlikli Toplantı",
        date_formatted: "10 Ağustos 2026",
        similarity_score: 0.35,
        shared_tags: [],
        shared_participants: ["Zeynep"],
        reason: "Katılımcı eşleşmesi",
      },
      {
        id: "rel-mid",
        title: "Orta Benzerlikli Toplantı",
        date_formatted: "12 Ağustos 2026",
        similarity_score: 0.55,
        shared_tags: ["Genel"],
        shared_participants: [],
        reason: "Etiket eşleşmesi",
      },
    ];

    (invoke as any).mockResolvedValueOnce(mockLowScore);

    const onSelectMeeting = vi.fn();

    render(
      <RelatedMeetingsCard
        meetingId="curr-low"
        onSelectMeeting={onSelectMeeting}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Düşük Benzerlikli Toplantı"),
      ).toBeInTheDocument();
      expect(screen.getByText("Orta Benzerlikli Toplantı")).toBeInTheDocument();
      expect(
        screen.getByText("%35 relatedMeetings.similarityScore"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("%55 relatedMeetings.similarityScore"),
      ).toBeInTheDocument();
    });

    const card = screen.getByText("Düşük Benzerlikli Toplantı").closest("div");
    if (card) fireEvent.click(card);
    expect(onSelectMeeting).toHaveBeenCalledWith("rel-low");
  });

  it("handles invoke rejection safely and sets empty state", async () => {
    (invoke as any).mockRejectedValueOnce(new Error("Database offline"));

    render(<RelatedMeetingsCard meetingId="curr-err" />);

    await waitFor(() => {
      expect(
        screen.getByText("relatedMeetings.noRelatedMeetings"),
      ).toBeInTheDocument();
    });
  });

  it("renders empty state when no related meetings exist", async () => {
    (invoke as any).mockResolvedValueOnce([]);

    render(<RelatedMeetingsCard meetingId="curr-empty" />);

    await waitFor(() => {
      expect(
        screen.getByText("relatedMeetings.noRelatedMeetings"),
      ).toBeInTheDocument();
    });
  });

  it("returns null when no meetingId is provided", () => {
    const { container } = render(<RelatedMeetingsCard meetingId={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
