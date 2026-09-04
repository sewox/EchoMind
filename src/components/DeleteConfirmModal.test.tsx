import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { MeetingRecord } from "../App";

vi.mock("../locales/i18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "sidebar.deleteMeetingTitle": "Toplantıyı Sil",
        "sidebar.deleteMeetingConfirm":
          "Bu toplantıyı silmek istediğinize emin misiniz?",
        "common.cancel": "Vazgeç",
        "common.delete": "Sil",
        "common.close": "Kapat",
      };
      return translations[key] || key;
    },
  }),
}));

const mockMeeting: MeetingRecord = {
  id: "test-mtg-1",
  title: "Strateji Toplantısı",
  date_formatted: "03 Eylül 2026, 12:00",
  duration_seconds: 180,
  duration_formatted: "03:00",
  audio_file_path: "/path/to/audio.flac",
  segments: [],
  summary: "Özet metin",
  key_decisions: [],
};

describe("DeleteConfirmModal Component", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <DeleteConfirmModal
        isOpen={false}
        meeting={mockMeeting}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders meeting title and warning when open", () => {
    render(
      <DeleteConfirmModal
        isOpen={true}
        meeting={mockMeeting}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Toplantıyı Sil")).toBeInTheDocument();
    expect(screen.getByText("Strateji Toplantısı")).toBeInTheDocument();
    expect(screen.getByText("03 Eylül 2026, 12:00")).toBeInTheDocument();
  });

  it("calls onConfirm and onClose when Delete button is clicked", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <DeleteConfirmModal
        isOpen={true}
        meeting={mockMeeting}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    const deleteBtn = screen.getByRole("button", { name: /Sil/i });
    fireEvent.click(deleteBtn);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Cancel button is clicked", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <DeleteConfirmModal
        isOpen={true}
        meeting={mockMeeting}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    const cancelBtn = screen.getByRole("button", { name: /Vazgeç/i });
    fireEvent.click(cancelBtn);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
