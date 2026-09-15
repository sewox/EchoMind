import React, { useState } from "react";
import {
  Sparkles,
  ArrowRight,
  ExternalLink,
  X,
  Calendar,
  CheckCircle2,
  FileText,
  Clock,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
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

  if (!isOpen || !updateInfo) return null;

  const handleUpdateNow = async () => {
    setIsUpdating(true);
    try {
      if (dontShowAgain) {
        localStorage.setItem(
          "echomind_skip_update_version",
          updateInfo.latest_version,
        );
      }
      await invoke("open_release_url", {
        url: updateInfo.html_url,
      });
      onClose();
    } catch (err) {
      console.error("Failed to open update URL:", err);
    } finally {
      setIsUpdating(false);
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

        {/* Release Notes */}
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
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10 relative z-10">
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
            onClick={handleUpdateNow}
            disabled={isUpdating}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-900/40 hover:shadow-cyan-800/60 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            data-testid="update-now-btn"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>
              {isUpdating
                ? t("common.loading") || "Yükleniyor..."
                : t("updater.downloadAndUpdate") || "Şimdi Güncelle"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
