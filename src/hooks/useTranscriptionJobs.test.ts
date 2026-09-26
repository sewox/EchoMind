import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  useTranscriptionJobs,
  TranscriptionJob,
} from "./useTranscriptionJobs";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const sampleJob = (overrides: Partial<TranscriptionJob> = {}): TranscriptionJob => ({
  meeting_id: "mtg_1",
  audio_path: "/data/recordings/mtg_1.flac",
  state: "queued",
  attempts: 0,
  max_attempts: 3,
  last_error: null,
  created_at_ms: 1,
  updated_at_ms: 1,
  ...overrides,
});

describe("useTranscriptionJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listen as any).mockResolvedValue(() => {});
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "list_transcription_jobs") return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });

  it("loads jobs when storage is ready", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "list_transcription_jobs") {
        return Promise.resolve([sampleJob({ state: "running" })]);
      }
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useTranscriptionJobs(true));

    await waitFor(() => {
      expect(result.current.getJob("mtg_1")?.state).toBe("running");
    });
  });

  it("does not fetch while storage is locked", async () => {
    renderHook(() => useTranscriptionJobs(false));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(invoke).not.toHaveBeenCalledWith("list_transcription_jobs");
  });

  it("upserts jobs from transcription-job-updated events", async () => {
    let handler: ((e: { payload: TranscriptionJob }) => void) | undefined;
    (listen as any).mockImplementation(
      (event: string, cb: (e: { payload: TranscriptionJob }) => void) => {
        if (event === "transcription-job-updated") handler = cb;
        return Promise.resolve(() => {});
      },
    );

    const { result } = renderHook(() => useTranscriptionJobs(true));

    await waitFor(() => expect(handler).toBeDefined());

    await act(async () => {
      handler!({
        payload: sampleJob({ state: "failed", last_error: "missing FLAC" }),
      });
    });

    expect(result.current.getJob("mtg_1")?.state).toBe("failed");
    expect(result.current.getJob("mtg_1")?.last_error).toContain("FLAC");
  });

  it("enqueueRetranscribe invokes backend and stores the job", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "list_transcription_jobs") return Promise.resolve([]);
      if (cmd === "enqueue_meeting_transcription") {
        return Promise.resolve(sampleJob({ state: "queued" }));
      }
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useTranscriptionJobs(true));

    const enqueued = await act(async () => {
      return result.current.enqueueRetranscribe("mtg_1");
    });

    expect(invoke).toHaveBeenCalledWith("enqueue_meeting_transcription", {
      meetingId: "mtg_1",
    });
    expect(enqueued?.state).toBe("queued");
    expect(result.current.getJob("mtg_1")?.meeting_id).toBe("mtg_1");
  });
});
