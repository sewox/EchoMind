import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Controls the one-time history-recovery banner. Visibility comes from the
 * storage-unlock payload (`show_history_recovery_notice`); dismiss persists
 * via the Rust `dismiss_history_recovery_notice` command so it never returns.
 */
export function useHistoryRecoveryNotice(showFromUnlock: boolean) {
  const [dismissedLocally, setDismissedLocally] = useState(false);

  const dismiss = useCallback(() => {
    setDismissedLocally(true);
    invoke("dismiss_history_recovery_notice").catch(() => {
      // Non-Tauri / early boot — local hide is enough for this session.
    });
  }, []);

  return {
    visible: showFromUnlock && !dismissedLocally,
    dismiss,
  };
}
