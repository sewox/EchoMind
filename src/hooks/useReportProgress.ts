import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface ReportProgressEvent {
  meeting_id: string;
  /** 0–100 while generating, null once finished. */
  percent: number | null;
}

/** Progress (0–100) of the background report for `meetingId`, or null. */
export function useReportProgress(meetingId: string | undefined) {
  const [progress, setProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      unlisten = await listen<ReportProgressEvent>(
        "report-progress",
        (event) => {
          const { meeting_id, percent } = event.payload;
          setProgress((prev) => {
            const next = { ...prev };
            if (percent === null) delete next[meeting_id];
            else next[meeting_id] = percent;
            return next;
          });
        },
      );
      if (cancelled) unlisten();
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return meetingId !== undefined && meetingId in progress
    ? progress[meetingId]
    : null;
}
