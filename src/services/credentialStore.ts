import { invoke } from "@tauri-apps/api/core";

// In-memory cache for fast synchronous access without exposing keys in web storage
const memoryVault: Record<string, string> = {};

const KNOWN_KEY_NAMES = [
  "echomind_groq_key",
  "echomind_gemini_key",
  "echomind_openai_key",
  "echomind_anthropic_key",
  "echomind_cloud_key",
];

/**
 * Secure Credential Storage Service
 * Stores API keys exclusively in the native encrypted vault (Rust backend)
 * and volatile in-memory cache. NEVER writes plaintext keys to localStorage.
 */
export const CredentialStore = {
  /**
   * Synchronous retrieval from in-memory cache
   */
  getSync(keyName: string): string {
    return memoryVault[keyName] || "";
  },

  /**
   * Asynchronous retrieval from native secure vault, migrating any legacy localStorage keys
   */
  async get(keyName: string): Promise<string> {
    // 1. Check in-memory vault first
    if (memoryVault[keyName]) {
      return memoryVault[keyName];
    }

    // 2. Query native Rust encrypted vault
    try {
      const val = await invoke<string | null>("get_secure_credential", {
        keyName,
      });
      if (val !== null && val !== undefined && val !== "") {
        memoryVault[keyName] = val;
        // Purge any accidental plaintext artifact in localStorage
        try {
          localStorage.removeItem(keyName);
        } catch {}
        return val;
      }
    } catch {
      // In non-Tauri / mock test environment
    }

    // 3. Migrate legacy localStorage plaintext keys if present
    try {
      const legacyVal = localStorage.getItem(keyName);
      if (legacyVal) {
        memoryVault[keyName] = legacyVal;
        // Persist to native vault and delete plaintext from storage
        invoke("save_secure_credential", {
          keyName,
          keyValue: legacyVal,
        }).catch(() => {});
        localStorage.removeItem(keyName);
        return legacyVal;
      }
    } catch {}

    return memoryVault[keyName] || "";
  },

  /**
   * Securely saves API key to native encrypted vault and memory.
   * Purges plaintext from localStorage to guarantee zero plaintext leak.
   */
  async set(keyName: string, keyValue: string): Promise<void> {
    const trimmed = (keyValue || "").trim();
    if (trimmed) {
      memoryVault[keyName] = trimmed;
    } else {
      delete memoryVault[keyName];
    }

    try {
      await invoke("save_secure_credential", { keyName, keyValue: trimmed });
    } catch {
      // Non-Tauri fallback: memoryVault already updated
    }

    // ALWAYS ensure localStorage does NOT contain the plaintext key
    try {
      localStorage.removeItem(keyName);
    } catch {}
  },

  /**
   * Deletes credential from native vault and memory
   */
  async delete(keyName: string): Promise<void> {
    delete memoryVault[keyName];
    try {
      await invoke("delete_secure_credential", { keyName });
    } catch {}
    try {
      localStorage.removeItem(keyName);
    } catch {}
  },

  /**
   * Clears all in-memory cached credentials (useful for testing and user logout/session reset)
   */
  clearCache(): void {
    for (const k of Object.keys(memoryVault)) {
      delete memoryVault[k];
    }
  },

  /**
   * Migrates all legacy plaintext API keys from localStorage into the secure vault
   * and completely purges all sensitive keys from WebKit localStorage.
   */
  async migrateLegacyStorage(): Promise<void> {
    try {
      const keysToPurge = new Set<string>(KNOWN_KEY_NAMES);

      try {
        for (const k of Object.keys(localStorage)) {
          if (
            k.toLowerCase().includes("key") ||
            k.toLowerCase().includes("token") ||
            k.toLowerCase().includes("secret")
          ) {
            keysToPurge.add(k);
          }
        }
      } catch {}

      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (
            k &&
            (k.toLowerCase().includes("key") ||
              k.toLowerCase().includes("token") ||
              k.toLowerCase().includes("secret"))
          ) {
            keysToPurge.add(k);
          }
        }
      } catch {}

      for (const k of Array.from(keysToPurge)) {
        const val = localStorage.getItem(k);
        if (val && val.trim()) {
          await this.set(k, val.trim());
        }
        localStorage.removeItem(k);
      }
    } catch (err) {
      console.error("Failed to migrate legacy credentials:", err);
    }
  },
};
