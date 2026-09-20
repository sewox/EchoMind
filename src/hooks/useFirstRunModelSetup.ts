import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ModelInfo } from "../components/ModelHubModal";

const STORAGE_KEY = "echomind_model_setup_done";

export interface ModelDownloadProgressPayload {
  model_key: string;
  percentage: number;
  downloaded_bytes: number;
  total_bytes: number;
  status: "downloading" | "completed" | "error";
  error?: string | null;
}

/**
 * Runs once per installation: if no Whisper model has ever been downloaded yet,
 * silently fetches the tier recommended for this machine's RAM (see
 * recommended_model_key() in transcriber.rs) in the background, so a first-time
 * user gets working local transcription without having to find and click
 * "download" in the Model Hub themselves. Never re-triggers once a model exists
 * or the first attempt has run (success or failure) — after that, manual
 * management via the Model Hub takes over as before.
 */
export function useFirstRunModelSetup() {
  const [progress, setProgress] = useState<ModelDownloadProgressPayload | null>(
    null,
  );
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (localStorage.getItem(STORAGE_KEY) === "true") return;
    startedRef.current = true;

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const markDone = () => localStorage.setItem(STORAGE_KEY, "true");

    (async () => {
      try {
        const models = await invoke<ModelInfo[]>("get_available_models");
        if (models.some((m) => m.is_downloaded)) {
          markDone();
          return;
        }

        const recommendedKey = await invoke<string>("get_recommended_model_key");
        if (cancelled) return;

        unlisten = await listen<ModelDownloadProgressPayload>(
          "model-download-progress",
          (event) => {
            if (event.payload.model_key !== recommendedKey) return;
            setProgress(event.payload);
          },
        );

        setProgress({
          model_key: recommendedKey,
          percentage: 0,
          downloaded_bytes: 0,
          total_bytes: 0,
          status: "downloading",
        });

        await invoke("download_whisper_model", { modelKey: recommendedKey });
      } catch {
        // Silent by design — this is a convenience, not a required step. The
        // user can always download a model manually from the Model Hub.
        setProgress((prev) =>
          prev ? { ...prev, status: "error" } : prev,
        );
      } finally {
        if (!cancelled) markDone();
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const dismiss = () => setProgress(null);

  return { progress, dismiss };
}
