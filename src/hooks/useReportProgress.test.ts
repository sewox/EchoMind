import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useReportProgress } from "./useReportProgress";
import { globalTestEventListeners } from "../test/setup";

const emit = (payload: { meeting_id: string; percent: number | null }) =>
  act(() => {
    (globalTestEventListeners["report-progress"] || []).forEach((cb) =>
      cb({ payload }),
    );
  });

describe("useReportProgress", () => {
  beforeEach(() => {
    delete globalTestEventListeners["report-progress"];
  });

  it("tracks the open meeting only and clears when finished", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id?: string }) => useReportProgress(id),
      { initialProps: { id: "m1" } as { id?: string } },
    );
    await waitFor(() =>
      expect(globalTestEventListeners["report-progress"]?.length).toBe(1),
    );
    expect(result.current).toBeNull();

    emit({ meeting_id: "m2", percent: 40 });
    expect(result.current).toBeNull();

    emit({ meeting_id: "m1", percent: 12.5 });
    expect(result.current).toBe(12.5);

    rerender({ id: "m2" });
    expect(result.current).toBe(40);

    emit({ meeting_id: "m2", percent: null });
    expect(result.current).toBeNull();

    rerender({ id: undefined });
    expect(result.current).toBeNull();
  });
});
