import { invoke } from "@tauri-apps/api/core";

/**
 * Secure Credential Storage Service
 * Stores API keys in the native encrypted vault (Rust backend)
 * with graceful fallback to localStorage when running in web/mock environments.
 */
export const CredentialStore = {
  async get(keyName: string): Promise<string> {
    try {
      const val = await invoke<string | null>("get_secure_credential", {
        keyName,
      });
      if (val !== null && val !== undefined) {
        return val;
      }
    } catch {
      // Fallback to localStorage in non-Tauri / test environments
    }
    return localStorage.getItem(keyName) || "";
  },

  async set(keyName: string, keyValue: string): Promise<void> {
    try {
      await invoke("save_secure_credential", { keyName, keyValue });
    } catch {
      // Fallback
    }
    if (!keyValue) {
      localStorage.removeItem(keyName);
    } else {
      localStorage.setItem(keyName, keyValue);
    }
  },

  async delete(keyName: string): Promise<void> {
    try {
      await invoke("delete_secure_credential", { keyName });
    } catch {
      // Fallback
    }
    localStorage.removeItem(keyName);
  },
};
