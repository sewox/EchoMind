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
