import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { I18nProvider } from "../locales/i18nContext";
import { DiagnosticsCard } from "./DiagnosticsCard";

const renderCard = () =>
  render(
    <I18nProvider>
      <DiagnosticsCard />
    </I18nProvider>,
  );

describe("DiagnosticsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("creates the report with the live transcription setting and shows where it went", async () => {
    localStorage.setItem("echomind_live_transcription_enabled", "false");
    (invoke as any).mockResolvedValue("C:\\Users\\a\\Downloads\\r.txt");
    renderCard();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rapor oluştur" }));
    });
    expect(invoke).toHaveBeenCalledWith("create_diagnostic_report", {
      liveTranscription: false,
    });
    expect(
      screen.getByText("Kaydedildi: C:\\Users\\a\\Downloads\\r.txt"),
    ).toBeInTheDocument();
  });

  it("shows the error when the report cannot be written", async () => {
    (invoke as any).mockRejectedValue("Rapor yazılamadı: disk dolu");
    renderCard();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rapor oluştur" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("disk dolu");
  });
});
