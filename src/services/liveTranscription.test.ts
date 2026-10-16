import { beforeEach, describe, expect, it } from "vitest";
import {
  isLiveTranscriptionEnabled,
  setLiveTranscriptionEnabled,
} from "./liveTranscription";

describe("live transcription preference", () => {
  beforeEach(() => localStorage.clear());

  it("is on by default", () => {
    expect(isLiveTranscriptionEnabled()).toBe(true);
  });

  it("remembers being turned off and on", () => {
    setLiveTranscriptionEnabled(false);
    expect(isLiveTranscriptionEnabled()).toBe(false);
    setLiveTranscriptionEnabled(true);
    expect(isLiveTranscriptionEnabled()).toBe(true);
  });
});
