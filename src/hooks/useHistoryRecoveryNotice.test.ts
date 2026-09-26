import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { useHistoryRecoveryNotice } from "./useHistoryRecoveryNotice";

describe("useHistoryRecoveryNotice", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("stays hidden until unlock reports show_history_recovery_notice", () => {
    const { result, rerender } = renderHook(
      ({ show }) => useHistoryRecoveryNotice(show),
      { initialProps: { show: false } },
    );
    expect(result.current.visible).toBe(false);

    rerender({ show: true });
    expect(result.current.visible).toBe(true);
  });

  it("hides immediately on dismiss and persists via backend command", async () => {
    const { result } = renderHook(() => useHistoryRecoveryNotice(true));
    expect(result.current.visible).toBe(true);

    await act(async () => {
      result.current.dismiss();
    });

    expect(result.current.visible).toBe(false);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("dismiss_history_recovery_notice");
    });
  });

  it("never shows again after dismiss even if unlock flag stays true", async () => {
    const { result, rerender } = renderHook(
      ({ show }) => useHistoryRecoveryNotice(show),
      { initialProps: { show: true } },
    );

    await act(async () => {
      result.current.dismiss();
    });
    expect(result.current.visible).toBe(false);

    // Parent may re-render with the same unlock payload; stay dismissed.
    rerender({ show: true });
    expect(result.current.visible).toBe(false);
  });

  it("still hides locally when dismiss invoke rejects", async () => {
    invoke.mockRejectedValue(new Error("not in tauri"));
    const { result } = renderHook(() => useHistoryRecoveryNotice(true));

    await act(async () => {
      result.current.dismiss();
    });

    expect(result.current.visible).toBe(false);
  });
});
