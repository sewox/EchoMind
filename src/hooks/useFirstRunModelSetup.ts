import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ModelInfo } from "../components/ModelHubModal";

const DONE_KEY = "echomind_model_setup_done";
const ATTEMPTS_KEY = "echomind_model_setup_attempts";
const MAX_ATTEMPTS = 3;

export interface ModelDownloadProgressPayload {
  model_key: string;
  percentage: number;
  downloaded_bytes: number;
  total_bytes: number;
  status: "downloading" | "completed" | "error";
  error?: string | null;
}

const getAttempts = (): number =>
  Number(localStorage.getItem(ATTEMPTS_KEY) || "0") || 0;

/**
 * Runs once per app launch (up to MAX_ATTEMPTS launches, or until it succeeds /
 * a model already exists): if no Whisper model has ever been downloaded yet,
 * fetches the tier recommended for this machine's RAM (see
 * recommended_model_key() in transcriber.rs) in the background, so a first-time
 * user gets working local transcription without having to find and click
 * "download" in the Model Hub themselves.
 *
 * Grok Bot's v0.2.7 QA found this failing silently on a real Linux launch: some
 * step threw before any progress ever painted, and the old one-shot "mark done
 * no matter what" logic then permanently skipped the feature on every future
 * launch with zero visible signal. This version always shows *some* banner
 * state once it starts (so a failure is visible, not silent), logs the real
 * error for diagnosis, and only gives up permanently after MAX_ATTEMPTS failed
 * launches — a single transient failure (network blip, IPC hiccup) now gets
 * more than one chance instead of permanently bricking the feature.
 */
export function useFirstRunModelSetup() {
  const [progress, setProgress] = useState<ModelDownloadProgressPayload | null>(
    null,
  );
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (localStorage.getItem(DONE_KEY) === "true") return;
    if (getAttempts() >= MAX_ATTEMPTS) {
      localStorage.setItem(DONE_KEY, "true");
      return;
    }
    startedRef.current = true;

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const markDone = () => localStorage.setItem(DONE_KEY, "true");

    (async () => {
      // Visible from the very first tick: if anything below throws before its
      // own setProgress call, the user still sees "attempting" -> "error"
      // instead of nothing at all.
      setProgress({
        model_key: "",
        percentage: 0,
        downloaded_bytes: 0,
        total_bytes: 0,
        status: "downloading",
      });

      try {
        const models = await invoke<ModelInfo[]>("get_available_models");
        if (cancelled) return;
        if (models.some((m) => m.is_downloaded)) {
          markDone();
          setProgress(null);
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
        if (!cancelled) markDone();
      } catch (err) {
        if (cancelled) return;
        // This is a convenience feature, not a required step, so it never
        // blocks anything — but it must be diagnosable, unlike the old fully
        // silent catch that made the v0.2.7 first-run failure invisible.
        console.error("[useFirstRunModelSetup] auto-download failed:", err);
        const attempts = getAttempts() + 1;
        localStorage.setItem(ATTEMPTS_KEY, String(attempts));
        if (attempts >= MAX_ATTEMPTS) markDone();
        setProgress((prev) => ({
          model_key: prev?.model_key || "",
          percentage: prev?.percentage || 0,
          downloaded_bytes: prev?.downloaded_bytes || 0,
          total_bytes: prev?.total_bytes || 0,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        }));
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
