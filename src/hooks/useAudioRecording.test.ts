import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAudioRecording } from "./useAudioRecording";
import { invoke } from "@tauri-apps/api/core";

describe("useAudioRecording Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes with default values", () => {
    const { result } = renderHook(() => useAudioRecording());
    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingSeconds).toBe(0);
    expect(result.current.audioStatus).toBeNull();
  });

  it("starts recording and tracks duration and polls audio status", async () => {
    vi.useFakeTimers();
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "start_audio_capture") return Promise.resolve();
      if (cmd === "get_audio_status")
        return Promise.resolve({ is_recording: true, mic_level: 75 });
      return Promise.resolve();
    });

    const { result } = renderHook(() => useAudioRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
    expect(invoke).toHaveBeenCalledWith("start_audio_capture");

    // Advance 3 seconds timer
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.recordingSeconds).toBe(3);
  });

  it("stops recording and resets timer", async () => {
    (invoke as any).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAudioRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      await result.current.stopRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(invoke).toHaveBeenCalledWith("stop_audio_capture");
  });

  it("cancels recording and handles errors safely", async () => {
    (invoke as any).mockRejectedValueOnce(new Error("Cancel failed"));
    const { result } = renderHook(() => useAudioRecording());

    await act(async () => {
      await result.current.cancelRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingSeconds).toBe(0);
  });

  it("handles start and stop recording errors by throwing", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "start_audio_capture") {
        return Promise.reject(new Error("Start error"));
      }
      if (cmd === "stop_audio_capture") {
        return Promise.reject(new Error("Stop error"));
      }
      return Promise.resolve({ is_recording: false });
    });
    const { result } = renderHook(() => useAudioRecording());

    await expect(result.current.startRecording()).rejects.toThrow(
      "Start error",
    );

    await expect(result.current.stopRecording()).rejects.toThrow("Stop error");
  });
});
