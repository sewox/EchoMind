import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ImportStage =
  | "decoding"
  | "transcribing"
  | "diarizing"
  | "summarizing"
  | "saving"
  | "finished";

interface ImportProgressEvent {
  stage: ImportStage;
  /** Overall 0–100, or null when the engine reports no progress (cloud). */
  percent: number | null;
}

export interface ImportProgressState {
  stage: Exclude<ImportStage, "finished">;
  percent: number | null;
  /** Estimated seconds left, once enough progress was seen to tell. */
  etaSeconds: number | null;
}

/** Remaining time from the pace so far; null until it means something. */
export function estimateEtaSeconds(
  percent: number | null,
  elapsedMs: number,
): number | null {
  if (percent === null || percent < 8 || percent >= 100 || elapsedMs < 5000) {
    return null;
  }
  return Math.max(
    1,
    Math.round(((elapsedMs / 1000) * (100 - percent)) / percent),
  );
}

/**
 * Streams the backend's `import-progress` events. Also picks up an import
 * that is already running when the window (re)loads, so the bar survives a
 * reload. `onFinished` fires when the backend reports the import ended.
 */
export function useImportProgress(onFinished?: () => void) {
  const [progress, setProgress] = useState<ImportProgressState | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      unlisten = await listen<ImportProgressEvent>(
        "import-progress",
        (event) => {
          const { stage, percent } = event.payload;
          if (stage === "finished") {
            startedAtRef.current = null;
            setProgress(null);
            onFinishedRef.current?.();
            return;
          }
          const now = Date.now();
          if (startedAtRef.current === null) startedAtRef.current = now;
          setProgress((prev) => ({
            stage,
            // Never step backwards (an estimate may lag a measured stage).
            percent:
              percent === null ? null : Math.max(percent, prev?.percent ?? 0),
            etaSeconds: estimateEtaSeconds(
              percent,
              now - (startedAtRef.current ?? now),
            ),
          }));
        },
      );
      if (cancelled) {
        unlisten();
        return;
      }
      try {
        const running = await invoke<boolean>("is_import_running");
        if (running && !cancelled) {
          setProgress(
            (prev) =>
              prev ?? {
                stage: "transcribing",
                percent: null,
                etaSeconds: null,
              },
          );
        }
      } catch {
        // Older backend without the command: events alone still work.
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  return progress;
}
