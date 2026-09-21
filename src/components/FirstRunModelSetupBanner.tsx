import React, { useEffect } from "react";
import { Download, CheckCircle2, X, AlertTriangle } from "lucide-react";
import type { ModelDownloadProgressPayload } from "../hooks/useFirstRunModelSetup";

interface FirstRunModelSetupBannerProps {
  progress: ModelDownloadProgressPayload | null;
  onDismiss: () => void;
}

const formatMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(0);

export const FirstRunModelSetupBanner: React.FC<
  FirstRunModelSetupBannerProps
> = ({ progress, onDismiss }) => {
  // Auto-dismiss a few seconds after success so it doesn't linger forever.
  useEffect(() => {
    if (progress?.status !== "completed") return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [progress?.status, onDismiss]);

  if (!progress) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 w-80 animate-in fade-in slide-in-from-bottom-4 duration-300"
      data-testid="first-run-model-setup-banner"
    >
      <div className="rounded-2xl bg-slate-900/95 border border-cyan-500/30 shadow-2xl shadow-cyan-950/50 backdrop-blur-xl p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 shrink-0">
            {progress.status === "completed" ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : progress.status === "error" ? (
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            ) : (
              <Download className="w-4 h-4" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-100">
              {progress.status === "completed"
                ? "Yerel model hazır"
                : progress.status === "error"
                  ? "Model indirilemedi"
                  : progress.model_key
                    ? `Yerel konuşma tanıma modeli indiriliyor (${progress.model_key})`
                    : "Yerel konuşma tanıma modeli hazırlanıyor…"}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {progress.status === "completed"
                ? "İlk kurulumda toplantılarınızı cihazınızda yazıya dökmek için en uygun model indirildi."
                : progress.status === "error"
                  ? "Şu an olmadı ama sorun değil — Ayarlar > Model Merkezi'nden istediğiniz zaman manuel indirebilirsiniz."
                  : "Arka planda çalışır, toplantı kaydına başlamanızı engellemez."}
            </p>
            {progress.status === "error" && progress.error && (
              <p
                className="text-[10px] text-rose-400/80 font-mono mt-1 break-all"
                data-testid="first-run-model-setup-error-detail"
              >
                {progress.error}
              </p>
            )}
            {progress.status === "downloading" && (
              <>
                <div className="mt-2 w-full h-1.5 rounded-full bg-slate-800 overflow-hidden border border-slate-700/60">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.max(3, progress.percentage)}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>{progress.percentage.toFixed(0)}%</span>
                  {progress.total_bytes > 0 && (
                    <span>
                      {formatMb(progress.downloaded_bytes)} /{" "}
                      {formatMb(progress.total_bytes)} MB
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            onClick={onDismiss}
            className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition shrink-0"
            title="Kapat"
            data-testid="first-run-model-setup-dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
