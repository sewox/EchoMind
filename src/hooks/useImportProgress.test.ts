import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { estimateEtaSeconds, useImportProgress } from "./useImportProgress";
import { globalTestEventListeners } from "../test/setup";

const emit = (payload: { stage: string; percent: number | null }) => {
  act(() => {
    (globalTestEventListeners["import-progress"] || []).forEach((cb) =>
      cb({ payload }),
    );
  });
};

const listening = () =>
  waitFor(() =>
    expect(globalTestEventListeners["import-progress"]?.length).toBe(1),
  );

describe("estimateEtaSeconds", () => {
  it("waits for enough progress and time before estimating", () => {
    expect(estimateEtaSeconds(null, 60_000)).toBeNull();
    expect(estimateEtaSeconds(5, 60_000)).toBeNull();
    expect(estimateEtaSeconds(50, 1_000)).toBeNull();
    expect(estimateEtaSeconds(100, 60_000)).toBeNull();
  });

  it("projects the remaining time from the pace so far", () => {
    expect(estimateEtaSeconds(50, 30_000)).toBe(30);
    expect(estimateEtaSeconds(25, 10_000)).toBe(30);
  });
});

describe("useImportProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete globalTestEventListeners["import-progress"];
    (invoke as any).mockResolvedValue(false);
  });
  afterEach(() => vi.useRealTimers());

  it("tracks stages and calls onFinished when the import ends", async () => {
    const onFinished = vi.fn();
    const { result } = renderHook(() => useImportProgress(onFinished));
    await listening();
    expect(result.current).toBeNull();

    emit({ stage: "decoding", percent: 2 });
    expect(result.current).toMatchObject({ stage: "decoding", percent: 2 });

    emit({ stage: "transcribing", percent: 40 });
    expect(result.current).toMatchObject({
      stage: "transcribing",
      percent: 40,
    });

    emit({ stage: "finished", percent: 100 });
    expect(result.current).toBeNull();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("never moves the bar backwards", async () => {
    const { result } = renderHook(() => useImportProgress());
    await listening();
    emit({ stage: "transcribing", percent: 60 });
    emit({ stage: "transcribing", percent: 55 });
    expect(result.current?.percent).toBe(60);
  });

  it("shows an indeterminate bar for engines without progress", async () => {
    const { result } = renderHook(() => useImportProgress());
    await listening();
    emit({ stage: "transcribing", percent: null });
    expect(result.current).toMatchObject({
      stage: "transcribing",
      percent: null,
      etaSeconds: null,
    });
  });

  it("estimates the time left once the import is under way", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const { result } = renderHook(() => useImportProgress());
    await listening();
    emit({ stage: "decoding", percent: 2 });
    now.mockReturnValue(1_030_000);
    emit({ stage: "transcribing", percent: 50 });
    expect(result.current?.etaSeconds).toBe(30);
    now.mockRestore();
  });

  it("restores the bar for an import already running after a reload", async () => {
    (invoke as any).mockResolvedValue(true);
    const { result } = renderHook(() => useImportProgress());
    await waitFor(() =>
      expect(result.current).toMatchObject({
        stage: "transcribing",
        percent: null,
      }),
    );
    expect(invoke).toHaveBeenCalledWith("is_import_running");
  });

  it("works with a backend that lacks is_import_running", async () => {
    (invoke as any).mockRejectedValue(new Error("unknown command"));
    const { result } = renderHook(() => useImportProgress());
    await listening();
    await act(async () => {});
    expect(result.current).toBeNull();
  });

  it("stops listening when unmounted", async () => {
    const { unmount } = renderHook(() => useImportProgress());
    await listening();
    unmount();
    expect(globalTestEventListeners["import-progress"]).toHaveLength(0);
  });
});
