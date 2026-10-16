import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Stethoscope } from "lucide-react";
import { useI18n } from "../locales/i18nContext";
import { isLiveTranscriptionEnabled } from "../services/liveTranscription";

/**
 * Settings card: writes a diagnostics report (system, GPUs, settings and the
 * app log; no recordings or transcript text) for a tester to send.
 */
export const DiagnosticsCard: React.FC = () => {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await invoke<string>("create_diagnostic_report", {
        liveTranscription: isLiveTranscriptionEnabled(),
      });
      setPath(typeof saved === "string" ? saved : null);
    } catch (e) {
      setPath(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3"
      data-testid="diagnostics-card"
    >
      <div className="text-slate-200 font-semibold flex items-center gap-2">
        <Stethoscope className="w-4 h-4 text-cyan-400" />
        <span>{t("diagnostics.title")}</span>
      </div>
      <p className="text-slate-400 text-xs leading-relaxed">
        {t("diagnostics.desc")}
      </p>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-[11px]">
          {path && (
            <span className="text-emerald-300 break-all">
              {t("diagnostics.saved", { path })}
            </span>
          )}
          {error && (
            <span role="alert" className="text-rose-300">
              {t("diagnostics.error", { error })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={create}
          disabled={busy}
          data-testid="diagnostics-create-btn"
          className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium shrink-0 disabled:opacity-50"
        >
          {busy ? t("diagnostics.creating") : t("diagnostics.create")}
        </button>
      </div>
    </div>
  );
};
