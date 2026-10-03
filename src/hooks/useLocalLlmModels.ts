import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface LocalLlmModel {
  key: string;
  name: string;
  size_bytes: number;
  installed: boolean;
  recommended: boolean;
  active: boolean;
}

export interface LocalLlmDownload {
  percent: number;
  status: "downloading" | "completed" | "error";
  error?: string | null;
}

interface ProgressPayload {
  model_key: string;
  percentage: number;
  status: LocalLlmDownload["status"];
  error?: string | null;
}

/**
 * On-device report models: the list, download progress per model, and
 * download/remove actions. Downloads continue in the backend if the view
 * closes; progress is picked up again from the event stream.
 */
export function useLocalLlmModels() {
  const [models, setModels] = useState<LocalLlmModel[]>([]);
  const [downloads, setDownloads] = useState<Record<string, LocalLlmDownload>>(
    {},
  );

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<LocalLlmModel[]>("get_llm_models");
      setModels(Array.isArray(list) ? list : []);
    } catch {
      setModels([]);
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    refresh();
    (async () => {
      unlisten = await listen<ProgressPayload>(
        "llm-model-download-progress",
        (event) => {
          const { model_key, percentage, status, error } = event.payload;
          setDownloads((prev) => ({
            ...prev,
            [model_key]: { percent: percentage, status, error },
          }));
          if (status === "completed") refresh();
        },
      );
      if (cancelled) unlisten();
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [refresh]);

  const download = useCallback(async (key: string) => {
    setDownloads((prev) => ({
      ...prev,
      [key]: { percent: prev[key]?.percent ?? 0, status: "downloading" },
    }));
    try {
      await invoke("download_llm_model", { key });
    } catch (err) {
      setDownloads((prev) => ({
        ...prev,
        [key]: {
          percent: 0,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  }, []);

  const remove = useCallback(
    async (key: string) => {
      try {
        await invoke("delete_llm_model", { key });
      } finally {
        setDownloads((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        refresh();
      }
    },
    [refresh],
  );

  return { models, downloads, download, remove, refresh };
}

export const formatGb = (bytes: number) =>
  (bytes / 1_000_000_000).toFixed(1).replace(/\.0$/, "");
