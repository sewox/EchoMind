import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "../locales/i18nContext";

interface HistoryRecoveryNoticeBannerProps {
  visible: boolean;
  onDismiss: () => void;
}

/**
 * One-time notice after a data-at-rest key rotation left undecryptable history
 * backed up as `.corrupt*`. Dismiss is persisted by the Rust backend.
 */
export const HistoryRecoveryNoticeBanner: React.FC<
  HistoryRecoveryNoticeBannerProps
> = ({ visible, onDismiss }) => {
  const { t } = useI18n();

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-5 left-5 z-50 w-[min(24rem,calc(100vw-2.5rem))] animate-in fade-in slide-in-from-bottom-4 duration-300"
      data-testid="history-recovery-notice-banner"
      role="status"
    >
      <div className="rounded-2xl bg-slate-900/95 border border-amber-500/35 shadow-2xl shadow-amber-950/40 backdrop-blur-xl p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-slate-200 leading-relaxed">
              {t("common.historyRecoveryNotice")}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition shrink-0"
            title={t("common.close")}
            aria-label={t("common.close")}
            data-testid="history-recovery-notice-dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
