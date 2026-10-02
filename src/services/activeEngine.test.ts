import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  getActiveEngine,
  storeActiveEngine,
  syncActiveEngine,
} from "./activeEngine";

const invokeMock = vi.mocked(invoke);

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

  it("falls back to local Whisper when storage is unavailable", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });
    expect(getActiveEngine()).toBe("local");
    spy.mockRestore();
  });
});

describe("storeActiveEngine", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("saves the choice locally and in the backend", async () => {
    storeActiveEngine("cloud_groq");
    await Promise.resolve();
    expect(localStorage.getItem("echomind_active_engine")).toBe("cloud_groq");
    expect(invokeMock).toHaveBeenCalledWith("set_asr_engine", {
      engine: "cloud_groq",
    });
  });

  it("still tells the backend when storage is unavailable", async () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });
    storeActiveEngine("local");
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("set_asr_engine", {
      engine: "local",
    });
    spy.mockRestore();
  });
});

describe("syncActiveEngine", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
  });

  const backend = (state: object) =>
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "get_asr_engine" ? state : undefined,
    );

  it("adopts the saved backend choice", async () => {
    localStorage.setItem("echomind_active_engine", "local");
    backend({ engine: "apple_speech", stored: true, apple_available: true });
    await expect(syncActiveEngine()).resolves.toBe("apple_speech");
    expect(localStorage.getItem("echomind_active_engine")).toBe("apple_speech");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "set_asr_engine",
      expect.anything(),
    );
  });

  it("defaults to Apple dictation on first launch where available", async () => {
    localStorage.setItem("echomind_active_engine", "local");
    backend({ engine: "apple_speech", stored: false, apple_available: true });
    await expect(syncActiveEngine()).resolves.toBe("apple_speech");
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("set_asr_engine", {
      engine: "apple_speech",
    });
  });

  it("keeps the UI choice where Apple dictation is unavailable", async () => {
    localStorage.setItem("echomind_active_engine", "cloud_openai");
    backend({ engine: "local", stored: false, apple_available: false });
    await expect(syncActiveEngine()).resolves.toBe("cloud_openai");
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("set_asr_engine", {
      engine: "cloud_openai",
    });
  });

  it("tolerates unavailable storage when adopting the backend choice", async () => {
    backend({ engine: "local", stored: true, apple_available: false });
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });
    await expect(syncActiveEngine()).resolves.toBe("local");
    spy.mockRestore();
  });
});
