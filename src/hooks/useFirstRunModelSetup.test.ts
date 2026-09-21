import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  useFirstRunModelSetup,
  ModelDownloadProgressPayload,
} from "./useFirstRunModelSetup";
import { globalTestEventListeners } from "../test/setup";

const DONE_KEY = "echomind_model_setup_done";
const ATTEMPTS_KEY = "echomind_model_setup_attempts";

const emitProgress = (payload: ModelDownloadProgressPayload) => {
  const listeners = globalTestEventListeners["model-download-progress"] || [];
  act(() => {
    listeners.forEach((cb) => cb({ payload }));
  });
};

describe("useFirstRunModelSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    delete globalTestEventListeners["model-download-progress"];
  });

  it("does nothing if a model is already downloaded, and marks setup done", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models")
        return Promise.resolve([
          { key: "small", is_downloaded: true },
          { key: "base", is_downloaded: false },
        ]);
      return Promise.resolve();
    });

    const { result } = renderHook(() => useFirstRunModelSetup());

    await waitFor(() => {
      expect(localStorage.getItem(DONE_KEY)).toBe("true");
    });
    expect(result.current.progress).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith(
      "download_whisper_model",
      expect.anything(),
    );
  });

  it("does nothing if setup already ran before", async () => {
    localStorage.setItem(DONE_KEY, "true");
    (invoke as any).mockResolvedValue([]);

    renderHook(() => useFirstRunModelSetup());

    expect(invoke).not.toHaveBeenCalledWith(
      "get_available_models",
      undefined,
    );
  });

  it("shows a placeholder banner immediately, before the first invoke resolves", () => {
    (invoke as any).mockImplementation(() => new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useFirstRunModelSetup());

    expect(result.current.progress).not.toBeNull();
    expect(result.current.progress?.status).toBe("downloading");
  });

  it("downloads the recommended model and tracks progress when none is present", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models")
        return Promise.resolve([{ key: "small", is_downloaded: false }]);
      if (cmd === "get_recommended_model_key") return Promise.resolve("small");
      if (cmd === "download_whisper_model")
        return Promise.resolve("small başarıyla indirildi!");
      return Promise.resolve();
    });

    const { result } = renderHook(() => useFirstRunModelSetup());

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("download_whisper_model", {
        modelKey: "small",
      });
    });

    emitProgress({
      model_key: "small",
      percentage: 42,
      downloaded_bytes: 200,
      total_bytes: 500,
      status: "downloading",
    });

    await waitFor(() => {
      expect(result.current.progress?.percentage).toBe(42);
    });

    await waitFor(() => {
      expect(localStorage.getItem(DONE_KEY)).toBe("true");
    });
    expect(localStorage.getItem(ATTEMPTS_KEY)).toBeNull();
  });

  it("ignores progress events for a different model key", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models")
        return Promise.resolve([{ key: "small", is_downloaded: false }]);
      if (cmd === "get_recommended_model_key") return Promise.resolve("small");
      return Promise.resolve();
    });

    const { result } = renderHook(() => useFirstRunModelSetup());

    await waitFor(() => {
      expect(globalTestEventListeners["model-download-progress"]?.length).toBe(
        1,
      );
    });

    emitProgress({
      model_key: "tiny",
      percentage: 99,
      downloaded_bytes: 1,
      total_bytes: 1,
      status: "downloading",
    });

    expect(result.current.progress?.model_key).toBe("small");
    expect(result.current.progress?.percentage).toBe(0);
  });

  it("dismiss clears the progress state", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models")
        return Promise.resolve([{ key: "small", is_downloaded: false }]);
      if (cmd === "get_recommended_model_key") return Promise.resolve("small");
      return Promise.resolve();
    });

    const { result } = renderHook(() => useFirstRunModelSetup());

    await waitFor(() => {
      expect(result.current.progress).not.toBeNull();
    });

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.progress).toBeNull();
  });

  it("shows a visible, logged error and does NOT mark done after a single failure", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models")
        return Promise.resolve([{ key: "small", is_downloaded: false }]);
      if (cmd === "get_recommended_model_key") return Promise.resolve("small");
      if (cmd === "download_whisper_model")
        return Promise.reject(new Error("network down"));
      return Promise.resolve();
    });

    const { result } = renderHook(() => useFirstRunModelSetup());

    await waitFor(() => {
      expect(result.current.progress?.status).toBe("error");
    });
    expect(result.current.progress?.error).toBe("network down");
    expect(consoleSpy).toHaveBeenCalled();

    // A single failure must not permanently disable the feature.
    expect(localStorage.getItem(DONE_KEY)).not.toBe("true");
    expect(localStorage.getItem(ATTEMPTS_KEY)).toBe("1");
    consoleSpy.mockRestore();
  });

  it("shows a visible error even when the failure happens before any progress event (e.g. get_recommended_model_key throws)", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models")
        return Promise.resolve([{ key: "small", is_downloaded: false }]);
      if (cmd === "get_recommended_model_key")
        return Promise.reject(new Error("hardware detect failed"));
      return Promise.resolve();
    });

    const { result } = renderHook(() => useFirstRunModelSetup());

    await waitFor(() => {
      expect(result.current.progress?.status).toBe("error");
    });
    expect(result.current.progress?.error).toBe("hardware detect failed");
  });

  it("gives up and marks done only after MAX_ATTEMPTS separate failed launches", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models")
        return Promise.resolve([{ key: "small", is_downloaded: false }]);
      if (cmd === "get_recommended_model_key")
        return Promise.reject(new Error("still down"));
      return Promise.resolve();
    });

    // Simulate 3 separate app launches, each its own hook instance.
    for (let i = 1; i <= 3; i++) {
      const { unmount } = renderHook(() => useFirstRunModelSetup());
      await waitFor(() => {
        expect(localStorage.getItem(ATTEMPTS_KEY)).toBe(String(i));
      });
      unmount();
      cleanup();
    }

    expect(localStorage.getItem(DONE_KEY)).toBe("true");

    // A 4th launch must not attempt again.
    (invoke as any).mockClear();
    renderHook(() => useFirstRunModelSetup());
    expect(invoke).not.toHaveBeenCalled();
  });
});
