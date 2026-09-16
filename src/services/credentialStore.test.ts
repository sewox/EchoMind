import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CredentialStore } from "./credentialStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("CredentialStore Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    CredentialStore.clearCache();
  });

  it("retrieves key from native secure vault if available", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("sk-encrypted-vault-secret");

    const result = await CredentialStore.get("echomind_openai_key");
    expect(invoke).toHaveBeenCalledWith("get_secure_credential", {
      keyName: "echomind_openai_key",
    });
    expect(result).toBe("sk-encrypted-vault-secret");
  });

  it("falls back to localStorage if native invoke fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("IPC unavailable"));
    localStorage.setItem("echomind_groq_key", "gsk_fallback_key");

    const result = await CredentialStore.get("echomind_groq_key");
    expect(result).toBe("gsk_fallback_key");
  });

  it("saves key to native vault and purges plaintext from localStorage", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    localStorage.setItem("echomind_gemini_key", "old_plaintext");

    await CredentialStore.set("echomind_gemini_key", "AIzaSy_secure_gemini");
    expect(invoke).toHaveBeenCalledWith("save_secure_credential", {
      keyName: "echomind_gemini_key",
      keyValue: "AIzaSy_secure_gemini",
    });
    // Plaintext MUST NOT exist in localStorage
    expect(localStorage.getItem("echomind_gemini_key")).toBeNull();
    // But in-memory and get() must return the key
    expect(CredentialStore.getSync("echomind_gemini_key")).toBe("AIzaSy_secure_gemini");
  });

  it("handles empty key removal gracefully", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    localStorage.setItem("echomind_key", "old_val");

    await CredentialStore.set("echomind_key", "");
    expect(localStorage.getItem("echomind_key")).toBeNull();
  });

  it("deletes key from native vault and localStorage", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    localStorage.setItem("echomind_key", "to_delete");

    await CredentialStore.delete("echomind_key");
    expect(invoke).toHaveBeenCalledWith("delete_secure_credential", {
      keyName: "echomind_key",
    });
    expect(localStorage.getItem("echomind_key")).toBeNull();
  });

  it("migrates legacy localStorage keys to native vault and cleans up", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    localStorage.setItem("echomind_groq_key", "gsk_legacy_to_migrate");

    await CredentialStore.migrateLegacyStorage();
    expect(invoke).toHaveBeenCalledWith("save_secure_credential", {
      keyName: "echomind_groq_key",
      keyValue: "gsk_legacy_to_migrate",
    });
    expect(localStorage.getItem("echomind_groq_key")).toBeNull();
  });
});
