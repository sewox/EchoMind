/**
 * Live transcription preference. When off, nothing is transcribed while
 * recording; the whole recording is transcribed in the background after it
 * is saved. Useful on machines where transcribing during a call is too heavy.
 */
const STORAGE_KEY = "echomind_live_transcription_enabled";

export function isLiveTranscriptionEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setLiveTranscriptionEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Storage unavailable: the default (on) applies next time.
  }
}
