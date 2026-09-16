import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePrivacyMode } from "./usePrivacyMode";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("balanced"),
}));

describe("usePrivacyMode Hook", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("defaults to balanced mode when no storage exists", () => {
    const { result } = renderHook(() => usePrivacyMode());
    expect(result.current.mode).toBe("balanced");
    expect(result.current.isBalanced).toBe(true);
    expect(result.current.isParanoid).toBe(false);
    expect(result.current.isMaxIntelligence).toBe(false);
    expect(result.current.allowCloud).toBe(true);
    expect(result.current.forceLocalOnly).toBe(false);
  });

  it("loads paranoid mode from localStorage", () => {
    localStorage.setItem("echomind_privacy_mode", "paranoid");
    const { result } = renderHook(() => usePrivacyMode());
    expect(result.current.mode).toBe("paranoid");
    expect(result.current.isParanoid).toBe(true);
    expect(result.current.allowCloud).toBe(false);
    expect(result.current.forceLocalOnly).toBe(true);
  });

  it("updates mode and emits custom event", () => {
    const { result } = renderHook(() => usePrivacyMode());
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    act(() => {
      result.current.setPrivacyMode("max_intelligence");
    });

    expect(result.current.mode).toBe("max_intelligence");
    expect(result.current.isMaxIntelligence).toBe(true);
    expect(localStorage.getItem("echomind_privacy_mode")).toBe(
      "max_intelligence",
    );
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "echomind:privacy-mode-changed",
      }),
    );
  });

  it("syncs state on window storage and custom events", () => {
    const { result } = renderHook(() => usePrivacyMode());

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "echomind_privacy_mode",
          newValue: "paranoid",
        }),
      );
    });
    expect(result.current.mode).toBe("paranoid");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "echomind_privacy_mode",
          newValue: "max_intelligence",
        }),
      );
    });
    expect(result.current.mode).toBe("max_intelligence");

    // Ignored storage events (different key or null value)
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "other_key",
          newValue: "paranoid",
        }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "echomind_privacy_mode",
          newValue: null,
        }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "echomind_privacy_mode",
          newValue: "invalid_mode",
        }),
      );
    });
    expect(result.current.mode).toBe("max_intelligence");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("echomind:privacy-mode-changed", {
          detail: "balanced",
        }),
      );
    });
    expect(result.current.mode).toBe("balanced");
  });

  it("handles empty custom event gracefully", () => {
    const { result } = renderHook(() => usePrivacyMode());
    act(() => {
      window.dispatchEvent(
        new CustomEvent("echomind:privacy-mode-changed", {
          detail: null,
        }),
      );
    });
    expect(result.current.mode).toBe("balanced");
  });

  it("syncs privacy mode to Rust backend on initialize and update", () => {
    const { result } = renderHook(() => usePrivacyMode());
    expect(invoke).toHaveBeenCalledWith("set_privacy_mode", { mode: "balanced" });

    act(() => {
      result.current.setPrivacyMode("paranoid");
    });
    expect(invoke).toHaveBeenCalledWith("set_privacy_mode", { mode: "paranoid" });
  });
});
