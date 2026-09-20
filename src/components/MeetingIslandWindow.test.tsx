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
    expect(screen.getByTestId("island-status-badge")).toHaveTextContent(
      "Beklemede",
    );
  });

  it("transitions to idle/Beklemede when periodic heartbeat detects no active apps", async () => {
    vi.useFakeTimers();
    let currentStatus = {
      is_active: true,
      detected_apps: [
        {
          app_id: "meet",
          display_name: "Google Meet",
          process_name: "Google Chrome",
          is_running: true,
          recommended_title: "Google Meet",
        },
      ],
    };

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_detector_status") {
        return Promise.resolve(currentStatus);
      }
      return Promise.resolve();
    });

    render(<MeetingIslandWindow />);

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(screen.getByTestId("island-status-badge")).toHaveTextContent(
      "Aktif",
    );

    // Meet closes, next heartbeat receives empty apps
    currentStatus = {
      is_active: false,
      detected_apps: [],
    };

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(screen.getByTestId("island-status-badge")).toHaveTextContent(
      "Beklemede",
    );
    expect(invoke).toHaveBeenCalledWith("hide_island_window");

    vi.useRealTimers();
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

  it("handles live-suggestion-event and displays mini suggestion in Island", async () => {
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText");

    render(<MeetingIslandWindow />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const suggestionListeners =
      globalTestEventListeners["live-suggestion-event"] || [];
    expect(suggestionListeners.length).toBeGreaterThan(0);

    await act(async () => {
      suggestionListeners[suggestionListeners.length - 1]({
        payload: {
          id: "sug-island-1",
          text: "Soru Önerisi",
          rationale: "Detaylı maliyet dağılımını sorabilir miyiz?",
          category: "question",
          timestamp_ms: 1000,
        },
      });
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(screen.getByText("Soru Önerisi")).toBeInTheDocument();

    // Copy suggestion
    const copyBtn = screen.getByTitle(/Kopyala|Copy/i);
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(writeTextSpy).toHaveBeenCalledWith(
      "Soru Önerisi\nDetaylı maliyet dağılımını sorabilir miyiz?",
    );

    // Dismiss suggestion
    const dismissBtn = screen.getByTitle(/Kapat|Dismiss/i);
    await act(async () => {
      fireEvent.click(dismissBtn);
    });
    expect(screen.queryByText("Soru Önerisi")).not.toBeInTheDocument();
  });
});
