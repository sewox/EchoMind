import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type TranscriptionJobState =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export interface TranscriptionJob {
  meeting_id: string;
  audio_path: string;
  state: TranscriptionJobState;
  attempts: number;
  max_attempts: number;
  last_error?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

/**
 * Tracks durable FLAC transcription jobs keyed by meeting id.
 * Auto-refreshes on `transcription-job-updated` and after storage unlock.
 */
export function useTranscriptionJobs(storageReady = true) {
  const [jobsByMeetingId, setJobsByMeetingId] = useState<
    Record<string, TranscriptionJob>
  >({});

  const upsertJob = useCallback((job: TranscriptionJob) => {
    setJobsByMeetingId((prev) => ({
      ...prev,
      [job.meeting_id]: job,
    }));
  }, []);

  const refreshJobs = useCallback(async () => {
    if (!storageReady) return;
    try {
      const jobs = await invoke<TranscriptionJob[]>("list_transcription_jobs");
      const map: Record<string, TranscriptionJob> = {};
      for (const job of jobs || []) {
        map[job.meeting_id] = job;
      }
      setJobsByMeetingId(map);
    } catch {
      // storage_not_ready or non-Tauri — ignore
    }
  }, [storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    refreshJobs();
  }, [storageReady, refreshJobs]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen<TranscriptionJob>("transcription-job-updated", (event) => {
      if (!cancelled && event.payload) {
        upsertJob(event.payload);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [upsertJob]);

  const enqueueRetranscribe = useCallback(
    async (meetingId: string): Promise<TranscriptionJob | null> => {
      try {
        const job = await invoke<TranscriptionJob>(
          "enqueue_meeting_transcription",
          { meetingId },
        );
        if (job) upsertJob(job);
        return job;
      } catch (err) {
        console.error("Failed to enqueue transcription:", err);
        return null;
      }
    },
    [upsertJob],
  );

  const getJob = useCallback(
    (meetingId: string): TranscriptionJob | undefined =>
      jobsByMeetingId[meetingId],
    [jobsByMeetingId],
  );

  return {
    jobsByMeetingId,
    getJob,
    enqueueRetranscribe,
    refreshJobs,
  };
}
