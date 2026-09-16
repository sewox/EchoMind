import React, { useState, useEffect } from "react";
import {
  Sparkles,
  ArrowRight,
  ExternalLink,
  X,
  Calendar,
  CheckCircle2,
  FileText,
  Clock,
  Download,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "../locales/i18nContext";

export interface ReleaseAsset {
  name: string;
  size: number;
  download_url: string;
  content_type: string;
}

export interface UpdateCheckResult {
  is_update_available: boolean;
  current_version: string;
  latest_version: string;
  release_name: string;
  release_notes: string;
  published_at: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export interface UpdateProgressPayload {
  percentage: number;
  downloaded_bytes: number;
  total_bytes: number;
  status: "downloading" | "installing" | "completed" | "error";
  error?: string;
}

interface UpdateModalProps {
  isOpen: boolean;
  updateInfo: UpdateCheckResult | null;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  updateInfo,
  onClose,
}) => {
  const { t } = useI18n();
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [progress, setProgress] = useState<UpdateProgressPayload | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    if (isOpen) {
      setProgress(null);
      setDownloadError(null);
      setIsUpdating(false);

      listen<UpdateProgressPayload>("update-download-progress", (event) => {
        if (event && event.payload) {
          setProgress(event.payload);
          if (event.payload.status === "error" && event.payload.error) {
            setDownloadError(event.payload.error);
            setIsUpdating(false);
          }
        }
      })
        .then((fn) => {
          unlisten = fn;
        })
        .catch((err) => {
          console.error("Failed to register update progress listener:", err);
        });
    }

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [isOpen]);

  if (!isOpen || !updateInfo) return null;

  const handleDownloadAndInstall = async () => {
    setIsUpdating(true);
    setDownloadError(null);

    if (dontShowAgain) {
      localStorage.setItem(
        "echomind_skip_update_version",
        updateInfo.latest_version,
      );
    }

    try {
      await invoke("download_and_install_update", {
        downloadUrl: null,
        filename: null,
      });
    } catch (err: unknown) {
      const errMsg =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : String(err);
      console.error("Failed to download and install update:", errMsg);
      setDownloadError(errMsg);
      setIsUpdating(false);
    }
  };

  const handleOpenGitHubRelease = async () => {
    try {
      await invoke("open_release_url", {
        url: updateInfo.html_url,
      });
      onClose();
    } catch (err) {
      console.error("Failed to open release URL:", err);
    }
  };

  const handleRemindLater = () => {
    if (dontShowAgain) {
      localStorage.setItem(
        "echomind_skip_update_version",
        updateInfo.latest_version,
      );
    }
    onClose();
  };

  const formatPublishDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const formatBytesToMB = (bytes: number) => {
    if (!bytes || isNaN(bytes)) return "0";
    return (bytes / (1024 * 1024)).toFixed(1);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
      data-testid="update-modal-backdrop"
    >
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-cyan-500/30 bg-slate-900/95 p-6 shadow-2xl shadow-cyan-950/50 backdrop-blur-xl animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
      >
        {/* Top Glow Background */}
        <div className="absolute -top-24 -left-24 w-60 h-60 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-60 h-60 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 p-0.5 shadow-lg shadow-cyan-900/40 flex items-center justify-center">
              <div className="w-full h-full bg-slate-950/80 rounded-[10px] flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-cyan-400 animate-pulse" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3
                  id="update-modal-title"
                  className="text-lg font-bold text-white tracking-tight"
                >
                  {t("updater.modalTitle") || "Yeni Güncelleme Mevcut!"}
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/40 text-[10px] font-bold text-cyan-300 uppercase tracking-wider">
                  {t("updater.newVersionBadge") || "YENİ SÜRÜM"}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {t("updater.modalSubtitle") ||
                  "EchoMind'ın en yeni özellikleri ve geliştirmeleri hazır."}
              </p>
            </div>
          </div>

          <button
            onClick={handleRemindLater}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition"
            aria-label={t("common.close") || "Kapat"}
            data-testid="update-modal-close-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Version Compare Banner */}
        <div className="my-5 p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-3">
            <div className="text-center">
              <span className="block text-[10px] uppercase font-semibold text-slate-500">
                {t("updater.currentVersion") || "Mevcut Sürüm"}
              </span>
              <span className="text-sm font-bold text-slate-400">
                v{updateInfo.current_version}
              </span>
            </div>

            <ArrowRight className="w-4 h-4 text-cyan-500/60" />

            <div className="text-center">
              <span className="block text-[10px] uppercase font-semibold text-cyan-400">
                {t("updater.latestVersion") || "En Son Sürüm"}
              </span>
              <span className="text-base font-extrabold text-cyan-300">
                v{updateInfo.latest_version}
              </span>
            </div>
          </div>

          {updateInfo.published_at && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 border-l border-slate-800 pl-4">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>{formatPublishDate(updateInfo.published_at)}</span>
            </div>
          )}
        </div>

        {/* Active In-App Download / Install Progress Bar */}
        {isUpdating && (
          <div
            className="mb-5 p-4 rounded-xl bg-cyan-950/40 border border-cyan-500/30 relative z-10 animate-in fade-in duration-200"
            data-testid="update-progress-container"
          >
            <div className="flex items-center justify-between text-xs font-semibold mb-2">
              <span className="flex items-center gap-2 text-cyan-300">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                {progress?.status === "installing"
                  ? t("updater.installing") ||
                    "Paket Doğrulanıyor ve Kuruluma Hazırlanıyor..."
                  : progress?.status === "completed"
                    ? t("updater.completed") || "Kurulum Başlatıldı"
                    : t("updater.downloading") || "Güncelleme İndiriliyor..."}
              </span>
              <span className="text-cyan-400 font-mono">
                {progress?.percentage ?? 0}%
              </span>
            </div>

            {/* Visual Progress Bar */}
            <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(5, progress?.percentage ?? 0)}%` }}
              />
            </div>

            {progress?.total_bytes ? (
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span>
                  {formatBytesToMB(progress.downloaded_bytes)} MB /{" "}
                  {formatBytesToMB(progress.total_bytes)} MB
                </span>
                {progress.status === "completed" && (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    {t("updater.completedDesc") || "Yükleyici çalıştırıldı"}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Download Error Banner & Manual Fallback */}
        {downloadError && (
          <div
            className="mb-5 p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2.5 relative z-10"
            data-testid="update-error-banner"
          >
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1.5 flex-1">
              <div className="font-semibold">
                {t("updater.downloadFailed") ||
                  "Güncelleme indirilemedi. Lütfen internet bağlantınızı kontrol edin."}
              </div>
              <div className="text-[11px] text-rose-300/80 font-mono break-all">
                {downloadError}
              </div>
              <button
                type="button"
                onClick={handleOpenGitHubRelease}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-cyan-200 underline mt-1 cursor-pointer"
              >
                <ExternalLink className="w-3 h-3" />
                {t("updater.manualDownloadFallback") ||
                  "Doğrudan GitHub'dan İndir"}
              </button>
            </div>
          </div>
        )}

        {/* Release Notes */}
        {!isUpdating && (
          <div className="space-y-2 mb-5 relative z-10">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <FileText className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                {t("updater.releaseNotes") || "Sürüm Notları & Yenilikler"}:
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl bg-slate-950/90 border border-slate-800/80 p-3.5 text-xs text-slate-300 space-y-2 leading-relaxed custom-scrollbar font-mono select-text">
              {updateInfo.release_name &&
                updateInfo.release_name !== updateInfo.latest_version && (
                  <div className="font-bold text-cyan-200 border-b border-slate-800 pb-1 mb-2 font-sans">
                    {updateInfo.release_name}
                  </div>
                )}
              {updateInfo.release_notes ? (
                <div className="whitespace-pre-wrap font-sans text-slate-300">
                  {updateInfo.release_notes}
                </div>
              ) : (
                <div className="text-slate-500 italic font-sans flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Performans iyileştirmeleri ve hata düzeltmeleri.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Checkbox: Don't show again */}
        <div className="mb-6 flex items-center gap-2.5 relative z-10">
          <input
            type="checkbox"
            id="dont-show-update-checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-cyan-500/50 cursor-pointer"
            data-testid="dont-show-update-checkbox"
          />
          <label
            htmlFor="dont-show-update-checkbox"
            className="text-xs text-slate-400 hover:text-slate-300 cursor-pointer select-none"
          >
            {t("updater.dontShowAgainForVersion") ||
              "Bu sürümü açılışta bir daha gösterme"}
          </label>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-white/10 relative z-10">
          <button
            type="button"
            onClick={handleOpenGitHubRelease}
            className="text-xs text-slate-500 hover:text-slate-300 transition flex items-center gap-1 cursor-pointer"
            title="GitHub Release"
          >
            <ExternalLink className="w-3 h-3" />
            <span className="hidden sm:inline">GitHub</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRemindLater}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer"
              data-testid="update-remind-later-btn"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{t("updater.remindLater") || "Sonra Hatırlat"}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadAndInstall}
              disabled={isUpdating}
              className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-900/40 hover:shadow-cyan-800/60 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
              data-testid="update-now-btn"
            >
              {isUpdating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t("updater.downloading") || "İndiriliyor..."}</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {t("updater.downloadAndUpdate") || "İndir ve Güncelle"}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
