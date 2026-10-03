import React from "react";
import {
  FileText,
  Download,
  Trash2,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useI18n } from "../locales/i18nContext";
import { formatGb, useLocalLlmModels } from "../hooks/useLocalLlmModels";

/** Model Hub section: the on-device model that writes meeting reports. */
export const LocalLlmSection: React.FC = () => {
  const { t } = useI18n();
  const { models, downloads, download, remove } = useLocalLlmModels();

  if (models.length === 0) return null;

  return (
    <section
      className="pt-4 mt-2 border-t border-slate-800/80 space-y-3"
      data-testid="local-llm-section"
    >
      <div>
        <h3 className="font-semibold text-white text-sm flex items-center gap-2">
          <FileText className="w-4 h-4 text-cyan-400" />
          {t("localLlm.title")}
        </h3>
        <p className="text-xs text-slate-400 mt-1">{t("localLlm.desc")}</p>
      </div>

      {models.map((m) => {
        const dl = downloads[m.key];
        const busy = dl?.status === "downloading";
        return (
          <div
            key={m.key}
            data-testid={`local-llm-${m.key}`}
            className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
              m.active
                ? "bg-slate-800/90 border-emerald-500/70"
                : "bg-slate-900/60 border-slate-800"
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-white">{m.name}</span>
                {m.recommended && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                    {t("localLlm.recommended")}
                  </span>
                )}
                {m.active && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    {t("localLlm.active")}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                {formatGb(m.size_bytes)} GB
              </div>
              {busy && (
                <div className="mt-2 h-1.5 w-48 max-w-full rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                    style={{ width: `${Math.max(2, dl.percent)}%` }}
                  />
                </div>
              )}
              {dl?.status === "error" && (
                <p
                  role="alert"
                  className="text-[11px] text-rose-300 mt-1 [overflow-wrap:anywhere]"
                >
                  {t("localLlm.error", { error: dl.error ?? "" })}
                </p>
              )}
            </div>

            <div className="shrink-0">
              {m.installed ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t("localLlm.installed")}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(m.key)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-slate-800"
                    title={t("localLlm.delete")}
                    aria-label={t("localLlm.delete")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => download(m.key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-60 flex items-center gap-1.5 whitespace-nowrap"
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {t("localLlm.downloading", {
                        percent: Math.round(dl.percent),
                      })}
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      {t("localLlm.download", { size: formatGb(m.size_bytes) })}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
};

/**
 * Shown in the report view while no on-device report model is installed:
 * reports then come from the simple keyword extractor.
 */
export const LocalLlmHint: React.FC<{ onOpenModelHub?: () => void }> = ({
  onOpenModelHub,
}) => {
  const { t } = useI18n();
  const { models } = useLocalLlmModels();
  if (models.length === 0 || models.some((m) => m.installed)) return null;
  const rec = models.find((m) => m.recommended) ?? models[0];
  return (
    <div
      data-testid="local-llm-hint"
      className="mx-4 mt-3 px-3 py-2 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-100 text-xs flex items-center justify-between gap-3"
    >
      <span>{t("localLlm.hint", { size: formatGb(rec.size_bytes) })}</span>
      {onOpenModelHub && (
        <button
          type="button"
          onClick={onOpenModelHub}
          className="shrink-0 px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium whitespace-nowrap"
        >
          {t("localLlm.openModelHub")}
        </button>
      )}
    </div>
  );
};
