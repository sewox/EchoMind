import { describe, it, expect, beforeEach } from "vitest";
import { getActiveEngine } from "./activeEngine";

describe("getActiveEngine", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to local Whisper", () => {
    expect(getActiveEngine()).toBe("local");
  });

  it("returns the stored engine", () => {
    localStorage.setItem("echomind_active_engine", "apple_speech");
    expect(getActiveEngine()).toBe("apple_speech");
  });

  it("migrates the retired SenseVoice selection to local Whisper", () => {
    localStorage.setItem("echomind_active_engine", "sensevoice");
    expect(getActiveEngine()).toBe("local");
    expect(localStorage.getItem("echomind_active_engine")).toBe("local");
  });
});
