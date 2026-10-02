import { describe, it, expect } from "vitest";
import { shortEngineLabel } from "./engineLabel";

describe("shortEngineLabel", () => {
  it("drops the symbol and the on-device wrapper", () => {
    expect(shortEngineLabel("🔒 Bilgisayarınızda (Standart Mod)")).toBe(
      "Standart Mod",
    );
    expect(shortEngineLabel("Cihazda (Whisper Small)")).toBe("Whisper Small");
  });

  it("keeps other engine names readable", () => {
    expect(shortEngineLabel("🍎 macOS Yerel Ses Tanıma")).toBe(
      "macOS Yerel Ses Tanıma",
    );
    expect(shortEngineLabel("⚡ Bulut Zekası (GROQ)")).toBe(
      "Bulut Zekası (GROQ)",
    );
  });

  it("falls back to the default local model", () => {
    expect(shortEngineLabel(undefined)).toBe("Whisper Small");
    expect(shortEngineLabel("🔒 ")).toBe("Whisper Small");
  });
});
