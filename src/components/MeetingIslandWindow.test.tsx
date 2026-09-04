import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MeetingIslandWindow } from "./MeetingIslandWindow";
import { invoke } from "@tauri-apps/api/core";
import { act } from "react";
import { globalTestEventListeners } from "../test/setup";

describe("MeetingIslandWindow Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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

  it("handles always auto start click", async () => {
    render(<MeetingIslandWindow />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const autoStartBtn = screen.getByTitle(/Her Zaman Otomatik Başlat/i);
    await act(async () => {
      fireEvent.click(autoStartBtn);
    });

    expect(invoke).toHaveBeenCalledWith("update_detector_settings", {
      settings: {
        enabled: true,
        auto_start_record: true,
        auto_stop_on_app_close: true,
        ignored_apps: [],
      },
    });
  });

  it("handles meeting-detected and meeting-ended event listeners", async () => {
    render(<MeetingIslandWindow />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const detectedListeners =
      globalTestEventListeners["meeting-detected"] || [];
    expect(detectedListeners.length).toBeGreaterThan(0);
    await act(async () => {
      detectedListeners[detectedListeners.length - 1]({
        payload: [
          {
            app_id: "zoom",
            display_name: "Zoom Workplace",
            process_name: "zoom.us",
            is_running: true,
            recommended_title: "Zoom Toplantısı",
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText("Zoom Workplace")).toBeInTheDocument();

    const endedListeners = globalTestEventListeners["meeting-ended"] || [];
    expect(endedListeners.length).toBeGreaterThan(0);
    await act(async () => {
      endedListeners[endedListeners.length - 1]({});
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(invoke).toHaveBeenCalledWith("hide_island_window");
  });

  it("handles start and auto-start error catch blocks gracefully", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "start_meeting_recording")
        return Promise.reject("Start error");
      if (cmd === "update_detector_settings")
        return Promise.reject("Update error");
      return Promise.resolve();
    });

    render(<MeetingIslandWindow />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const startBtn = screen.getByRole("button", { name: /Dinlemeyi Başlat/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    const autoStartBtn = screen.getByTitle(/Her Zaman Otomatik Başlat/i);
    await act(async () => {
      fireEvent.click(autoStartBtn);
    });
  });
});
