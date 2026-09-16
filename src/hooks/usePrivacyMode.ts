import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  PrivacyMode,
  PRIVACY_PROFILES,
  PrivacyModeConfig,
} from "../types/privacy";

const STORAGE_KEY = "echomind_privacy_mode";
const EVENT_NAME = "echomind:privacy-mode-changed";

export function usePrivacyMode() {
  const [mode, setModeState] = useState<PrivacyMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (
      saved === "paranoid" ||
      saved === "balanced" ||
      saved === "max_intelligence"
    ) {
      return saved as PrivacyMode;
    }
    return "balanced";
  });

  const syncBackendPrivacyMode = useCallback((targetMode: PrivacyMode) => {
    try {
      const res = invoke("set_privacy_mode", { mode: targetMode });
      if (res && typeof res.catch === "function") {
        res.catch((err) => {
          console.warn("Failed to sync privacy mode to Rust backend:", err);
        });
      }
    } catch {
      // Graceful fallback for non-promise mocked invoke environments
    }
  }, []);

  const setPrivacyMode = useCallback((newMode: PrivacyMode) => {
    localStorage.setItem(STORAGE_KEY, newMode);
    setModeState(newMode);
    syncBackendPrivacyMode(newMode);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: newMode }));
  }, [syncBackendPrivacyMode]);

  useEffect(() => {
    // Initial sync to Rust backend
    syncBackendPrivacyMode(mode);
  }, [mode, syncBackendPrivacyMode]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        if (
          e.newValue === "paranoid" ||
          e.newValue === "balanced" ||
          e.newValue === "max_intelligence"
        ) {
          setModeState(e.newValue as PrivacyMode);
        }
      }
    };

    const handleCustomEvent = (e: Event) => {
      const customEvt = e as CustomEvent<PrivacyMode>;
      if (customEvt.detail) {
        setModeState(customEvt.detail);
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(EVENT_NAME, handleCustomEvent);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(EVENT_NAME, handleCustomEvent);
    };
  }, []);

  const config: PrivacyModeConfig = PRIVACY_PROFILES[mode];

  return {
    mode,
    setPrivacyMode,
    config,
    isParanoid: mode === "paranoid",
    isBalanced: mode === "balanced",
    isMaxIntelligence: mode === "max_intelligence",
    allowCloud: config.allowCloud,
    forceLocalOnly: config.forceLocalOnly,
    strictDlp: config.strictDlp,
  };
}
