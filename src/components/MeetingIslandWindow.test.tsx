import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MeetingIslandWindow } from "./MeetingIslandWindow";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act } from "react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
  emit: vi.fn(() => Promise.resolve()),
}));

describe("MeetingIslandWindow Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(listen).mockImplementation(() => {
      return Promise.resolve(vi.fn());
    });

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_detector_status") {
        return Promise.resolve({
          is_active: true,
          detected_apps: [
            {
              app_id: "meet",
              display_name: "Google Meet",
              process_name: "Google Chrome",
              is_running: true,
              recommended_title: "Google Meet Toplantısı - 02 Eylül 2026",
            },
          ],
        });
      }
      return Promise.resolve();
    });
  });

  it("renders detected meeting island pill and handles start click", async () => {
    render(<MeetingIslandWindow />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(screen.getByText("Google Meet")).toBeInTheDocument();
    expect(screen.getByText("Aktif")).toBeInTheDocument();

    const startBtn = screen.getByRole("button", { name: /Dinlemeyi Başlat/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(invoke).toHaveBeenCalledWith("start_meeting_recording", {
      deviceName: undefined,
      meetingTitle: "Google Meet Toplantısı - 02 Eylül 2026",
    });
  });

  it("handles dismiss click", async () => {
    render(<MeetingIslandWindow />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const dismissBtn = screen.getByTitle("Yoksay");
    await act(async () => {
      fireEvent.click(dismissBtn);
    });

    expect(invoke).toHaveBeenCalledWith("hide_island_window");
  });
});
