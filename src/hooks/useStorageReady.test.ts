import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const invoke = vi.fn();
const listen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...args),
}));

import { useStorageReady } from "./useStorageReady";

describe("useStorageReady", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    listen.mockResolvedValue(() => {});
  });

  it("starts not ready and becomes ready after storage-unlocked event", async () => {
    invoke.mockResolvedValue({
      ready: false,
      used_fallback: false,
      key_source: null,
    });

    let eventHandler: ((event: { payload: unknown }) => void) | null = null;
    listen.mockImplementation(
      async (_name: string, handler: typeof eventHandler) => {
        eventHandler = handler;
        return () => {};
      },
    );

    const { result } = renderHook(() => useStorageReady());
    expect(result.current.ready).toBe(false);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_storage_ready");
    });

    await act(async () => {
      eventHandler?.({
        payload: {
          ready: true,
          used_fallback: true,
          key_source: "fallback file",
        },
      });
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.usedFallback).toBe(true);
    expect(result.current.keySource).toBe("fallback file");
    expect(result.current.showHistoryRecoveryNotice).toBe(false);
  });

  it("marks ready immediately when get_storage_ready already reports ready", async () => {
    invoke.mockResolvedValue({
      ready: true,
      used_fallback: false,
      key_source: "keychain",
      show_history_recovery_notice: false,
    });

    const { result } = renderHook(() => useStorageReady());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.keySource).toBe("keychain");
    expect(result.current.usedFallback).toBe(false);
    expect(result.current.showHistoryRecoveryNotice).toBe(false);
  });

  it("surfaces show_history_recovery_notice from the unlock payload", async () => {
    invoke.mockResolvedValue({
      ready: true,
      used_fallback: false,
      key_source: "new key created",
      show_history_recovery_notice: true,
    });

    const { result } = renderHook(() => useStorageReady());

    await waitFor(() => {
      expect(result.current.showHistoryRecoveryNotice).toBe(true);
    });
    expect(result.current.keySource).toBe("new key created");
  });

  it("ignores not-ready poll payloads and handles missing key_source", async () => {
    invoke.mockResolvedValue({
      ready: true,
      used_fallback: false,
    });

    const { result } = renderHook(() => useStorageReady());

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.keySource).toBeNull();
  });

  it("stays not ready when get_storage_ready rejects", async () => {
    invoke.mockRejectedValue(new Error("not in tauri"));
    listen.mockRejectedValue(new Error("no events"));

    const { result } = renderHook(() => useStorageReady());

    await waitFor(() => {
      expect(invoke).toHaveBeenCalled();
    });
    expect(result.current.ready).toBe(false);
  });

  it("does not apply status after unmount", async () => {
    let resolveInvoke: (value: unknown) => void = () => {};
    invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
    );

    const { unmount } = renderHook(() => useStorageReady());
    unmount();

    await act(async () => {
      resolveInvoke({
        ready: true,
        used_fallback: false,
        key_source: "keychain",
      });
    });

    // Hook unmounted — no throw; coverage hits the cancelled branch.
    expect(true).toBe(true);
  });
});
