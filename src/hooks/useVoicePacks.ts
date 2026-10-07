import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface VoicePack {
  key: string;
  lang: string;
  name: string;
  size_bytes: number;
  installed: boolean;
  downloadable: boolean;
}

export interface VoicePackDownload {
  percent: number;
  status: "downloading" | "completed" | "error";
  error?: string | null;
}

interface ProgressPayload {
  key: string;
  percentage: number;
  status: VoicePackDownload["status"];
  error?: string | null;
}

export const ENGLISH_VOICES = ["af_heart", "bf_emma"] as const;
export type EnglishVoice = (typeof ENGLISH_VOICES)[number];
const VOICE_KEY = "echomind_english_voice";

/** The English voice the briefing uses (saved per user). */
export function englishVoice(): EnglishVoice {
  try {
    const v = localStorage.getItem(VOICE_KEY);
    if (v && (ENGLISH_VOICES as readonly string[]).includes(v))
      return v as EnglishVoice;
  } catch {
    /* storage unavailable: default voice */
  }
  return ENGLISH_VOICES[0];
}

export function setEnglishVoice(v: EnglishVoice) {
  try {
    localStorage.setItem(VOICE_KEY, v);
  } catch {
    /* not saved: still used for this session */
  }
}

/**
 * Natural voices for the audio briefing: the packs, their download progress
 * and download/remove actions (downloads continue if the view closes).
 */
export function useVoicePacks() {
  const [packs, setPacks] = useState<VoicePack[]>([]);
  const [downloads, setDownloads] = useState<Record<string, VoicePackDownload>>(
    {},
  );

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<VoicePack[]>("get_voice_packs");
      setPacks(Array.isArray(list) ? list : []);
    } catch {
      setPacks([]);
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    refresh();
    (async () => {
      unlisten = await listen<ProgressPayload>(
        "voice-pack-download-progress",
        (event) => {
          const { key, percentage, status, error } = event.payload;
          setDownloads((prev) => ({
            ...prev,
            [key]: { percent: percentage, status, error },
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
      await invoke("download_voice_pack", { key });
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
        await invoke("delete_voice_pack", { key });
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

  return { packs, downloads, download, remove };
}
