import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMeetingDetector, MeetingAppInfo } from "./useMeetingDetector";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("useMeetingDetector Hook", () => {
  let detectedCallback:
    ((event: { payload: MeetingAppInfo[] }) => void) | null = null;
  let endedCallback: ((event: { payload: MeetingAppInfo[] }) => void) | null =
    null;

  beforeEach(() => {
    vi.clearAllMocks();
    detectedCallback = null;
    endedCallback = null;

    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_detector_status") {
        return Promise.resolve({
          is_active: true,
          detected_apps: [],
          active_count: 0,
          last_check_timestamp: "12:00:00",
          settings: {
            enabled: true,
            auto_start_record: false,
            auto_stop_on_app_close: true,
            ignored_apps: [],
          },
        });
      }
      if (cmd === "update_detector_settings") {
        return Promise.resolve({
          is_active: true,
          detected_apps: [],
          active_count: 0,
          last_check_timestamp: "12:00:00",
          settings: {
            enabled: true,
            auto_start_record: true,
            auto_stop_on_app_close: false,
            ignored_apps: ["discord"],
          },
        });
      }
      return Promise.resolve();
    });

    vi.mocked(listen).mockImplementation((event: string, cb: any) => {
      if (event === "meeting-detected") {
        detectedCallback = cb;
      }
      if (event === "meeting-ended") {
        endedCallback = cb;
      }
      return Promise.resolve(vi.fn());
    });
  });

  const mockApp: MeetingAppInfo = {
    app_id: "zoom",
    display_name: "Zoom",
    process_name: "zoom.us",
    is_running: true,
    recommended_title: "Zoom Toplantısı - 02 Eylül 2026",
  };

  it("initializes and fetches detector status", async () => {
    const { result } = renderHook(() =>
      useMeetingDetector({ isRecording: false }),
    );

    await act(async () => {
      await result.current.fetchStatus();
    });

    expect(invoke).toHaveBeenCalledWith("start_meeting_detector");
    expect(invoke).toHaveBeenCalledWith("get_detector_status");
    expect(result.current.isMonitoring).toBe(true);
  });

  it("sets promptApp when meeting-detected event is received and not recording", async () => {
    const onAutoStart = vi.fn();
    const { result } = renderHook(() =>
      useMeetingDetector({
        isRecording: false,
        onAutoStartMeeting: onAutoStart,
      }),
    );

    // Wait for setup promises to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Trigger meeting-detected event
    await act(async () => {
      detectedCallback?.({ payload: [mockApp] });
    });

    expect(result.current.promptApp).toEqual(mockApp);
    expect(onAutoStart).not.toHaveBeenCalled();

    // Dismiss prompt
    act(() => {
      result.current.dismissPrompt(mockApp.app_id);
    });

    expect(result.current.promptApp).toBeNull();
  });

  it("calls onAutoStartMeeting when auto_start_record is true", async () => {
    const onAutoStart = vi.fn();
    const { result } = renderHook(() =>
      useMeetingDetector({
        isRecording: false,
        onAutoStartMeeting: onAutoStart,
      }),
    );

    // Wait for setup promises to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Update settings to auto start
    await act(async () => {
      await result.current.updateSettings({ auto_start_record: true });
    });

    // Trigger meeting-detected event
    await act(async () => {
      detectedCallback?.({ payload: [mockApp] });
    });

    expect(onAutoStart).toHaveBeenCalledWith(mockApp);
  });

  it("calls onAutoStopMeeting when meeting-ended event is received while recording", async () => {
    const onAutoStop = vi.fn();
    renderHook(() =>
      useMeetingDetector({
        isRecording: true,
        onAutoStopMeeting: onAutoStop,
      }),
    );

    // Wait for setup promises to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Trigger meeting-ended event
    await act(async () => {
      endedCallback?.({ payload: [mockApp] });
    });

    expect(onAutoStop).toHaveBeenCalled();
  });
});
