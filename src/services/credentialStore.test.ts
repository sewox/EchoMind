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
  });

  it("retrieves key from native secure vault if available", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("sk-encrypted-vault-secret");

    const result = await CredentialStore.get("echomind_openai_key");
    expect(invoke).toHaveBeenCalledWith("get_secure_credential", { keyName: "echomind_openai_key" });
    expect(result).toBe("sk-encrypted-vault-secret");
  });

  it("falls back to localStorage if native invoke fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("IPC unavailable"));
    localStorage.setItem("echomind_groq_key", "gsk_fallback_key");

    const result = await CredentialStore.get("echomind_groq_key");
    expect(result).toBe("gsk_fallback_key");
  });

  it("saves key to both native vault and localStorage", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await CredentialStore.set("echomind_gemini_key", "AIzaSy_secure_gemini");
    expect(invoke).toHaveBeenCalledWith("save_secure_credential", {
      keyName: "echomind_gemini_key",
      keyValue: "AIzaSy_secure_gemini",
    });
    expect(localStorage.getItem("echomind_gemini_key")).toBe("AIzaSy_secure_gemini");
  });

  it("handles empty key removal gracefully", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    localStorage.setItem("echomind_key", "old_val");

    await CredentialStore.set("echomind_key", "");
    expect(localStorage.getItem("echomind_key")).toBeNull();
  });

  it("deletes key from both native vault and localStorage", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    localStorage.setItem("echomind_key", "to_delete");

    await CredentialStore.delete("echomind_key");
    expect(invoke).toHaveBeenCalledWith("delete_secure_credential", { keyName: "echomind_key" });
    expect(localStorage.getItem("echomind_key")).toBeNull();
  });
});
