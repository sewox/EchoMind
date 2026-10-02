import React from "react";
import { useI18n } from "../locales/i18nContext";
import type { ImportProgressState } from "../hooks/useImportProgress";

interface ImportProgressBarProps {
  progress: ImportProgressState;
}

/** Stage, percentage and time left of the running audio import. */
export const ImportProgressBar: React.FC<ImportProgressBarProps> = ({
  progress,
}) => {
  const { t } = useI18n();
  const { stage, percent, etaSeconds } = progress;

  const remaining =
    etaSeconds === null
      ? null
      : etaSeconds >= 90
        ? t("importProgress.remainingMinutes", {
            n: Math.round(etaSeconds / 60),
          })
        : t("importProgress.remainingSeconds", {
            n: Math.max(5, Math.round(etaSeconds / 5) * 5),
          });

  return (
    <div
      className="w-full max-w-md"
      data-testid="import-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent === null ? undefined : Math.round(percent)}
    >
      <div className="flex items-center justify-between gap-3 text-[11px] text-slate-400 mb-1.5">
        <span className="truncate">{t(`importProgress.${stage}`)}</span>
        <span className="shrink-0 font-mono tabular-nums">
          {percent === null ? "" : `${Math.round(percent)}%`}
          {remaining && (
            <span className="ml-2 text-slate-500">{remaining}</span>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-800 border border-slate-700/60 overflow-hidden">
        {percent === null ? (
          <div
            className="h-full w-1/3 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 animate-pulse"
            data-testid="import-progress-indeterminate"
          />
        ) : (
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
            style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
          />
        )}
      </div>
    </div>
  );
};
