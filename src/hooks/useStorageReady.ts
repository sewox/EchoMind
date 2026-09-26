import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface StorageReadyStatus {
  ready: boolean;
  used_fallback: boolean;
  key_source?: string | null;
}

/**
 * Waits for the Rust-side Keychain / secure-storage unlock to finish so the
 * main window can render while macOS may still show its Keychain prompt.
 */
export function useStorageReady() {
  const [ready, setReady] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);
  const [keySource, setKeySource] = useState<string | null>(null);

  const applyStatus = useCallback((status: StorageReadyStatus) => {
    if (status.ready) {
      setReady(true);
      setUsedFallback(Boolean(status.used_fallback));
      setKeySource(status.key_source ?? null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    invoke<StorageReadyStatus>("get_storage_ready")
      .then((status) => {
        if (!cancelled) applyStatus(status);
      })
      .catch(() => {
        // Non-Tauri / early boot — treat as not ready until the event arrives.
      });

    listen<StorageReadyStatus>("storage-unlocked", (event) => {
      if (!cancelled) applyStatus(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [applyStatus]);

  return { ready, usedFallback, keySource };
}
