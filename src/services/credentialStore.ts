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
        invoke("save_secure_credential", { keyName, keyValue: legacyVal }).catch(() => {});
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
   * Migrates all known legacy plaintext API keys from localStorage into the secure vault
   */
  async migrateLegacyStorage(): Promise<void> {
    for (const key of KNOWN_KEY_NAMES) {
      try {
        const legacyVal = localStorage.getItem(key);
        if (legacyVal && legacyVal.trim()) {
          await this.set(key, legacyVal.trim());
          localStorage.removeItem(key);
        }
      } catch {}
    }
  },
};

