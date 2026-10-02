import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "echomind_active_engine";

/**
 * Engines that no longer exist. "sensevoice" never had its own model: it ran
 * local Whisper under another name, so users who picked it move to "local".
 */
const RETIRED_ENGINES = new Set(["sensevoice"]);

/** The transcription engine the user selected ("local" by default). */
export function getActiveEngine(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) || "local";
    if (RETIRED_ENGINES.has(stored)) {
      localStorage.setItem(STORAGE_KEY, "local");
      return "local";
    }
    return stored;
  } catch {
    return "local";
  }
}

/**
 * Saves the engine choice in the UI and in the backend, which uses it for the
 * background transcription of finished recordings.
 */
export function storeActiveEngine(engine: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, engine);
  } catch {
    // Storage unavailable: the backend copy still applies.
  }
  // Best effort: an unavailable backend must never break the selection.
  Promise.resolve()
    .then(() => invoke("set_asr_engine", { engine }))
    .catch(() => {});
}

interface AsrEngineState {
  engine: string;
  stored: boolean;
  apple_available: boolean;
}

/**
 * Aligns the UI with the backend preference at startup. The backend copy wins
 * once it exists; on the first launch with it, Apple dictation becomes the
 * engine where the Mac supports it (better Turkish than Whisper Small, no
 * hallucinations on silence), otherwise the UI's current choice is kept.
 */
export async function syncActiveEngine(): Promise<string> {
  const state = await invoke<AsrEngineState>("get_asr_engine");
  let engine: string;
  if (state.stored) {
    engine = state.engine;
    try {
      localStorage.setItem(STORAGE_KEY, engine);
    } catch {
      // ignore
    }
  } else {
    engine = state.apple_available ? "apple_speech" : getActiveEngine();
    storeActiveEngine(engine);
  }
  return engine;
}
