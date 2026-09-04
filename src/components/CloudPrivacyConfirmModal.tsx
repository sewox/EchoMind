import React, { useState } from "react";
import { ShieldAlert, Zap, ShieldCheck, X, ArrowRight } from "lucide-react";
import { useI18n } from "../locales/i18nContext";

interface CloudPrivacyConfirmModalProps {
  isOpen: boolean;
  providerName: string;
  onConfirmCloud: () => void;
  onSwitchToLocal: () => void;
  onClose: () => void;
}

export const CloudPrivacyConfirmModal: React.FC<
  CloudPrivacyConfirmModalProps
> = ({ isOpen, providerName, onConfirmCloud, onSwitchToLocal, onClose }) => {
  const { t } = useI18n();
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleProceedCloud = () => {
    if (dontShowAgain) {
      localStorage.setItem("echomind_suppress_cloud_warning", "true");
    }
    onConfirmCloud();
  };

  const handleProceedLocal = () => {
    if (dontShowAgain) {
      localStorage.setItem("echomind_suppress_cloud_warning", "true");
    }
    onSwitchToLocal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 relative overflow-hidden flex flex-col gap-5 text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ambient Glow */}
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base">
                {t("cloudWarning.title")}
              </h3>
              <p className="text-xs text-slate-400">
                {t("cloudWarning.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informative Body */}
        <div className="text-xs text-slate-300 leading-relaxed bg-slate-950/70 border border-slate-800/80 p-4 rounded-xl space-y-2.5">
          <p>
            {t("cloudWarning.providerSelected", { provider: providerName })}
          </p>
          <p className="text-slate-400">{t("cloudWarning.cloudDesc")}</p>
          <p className="text-slate-400">{t("cloudWarning.localAlternative")}</p>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* Proceed with Cloud */}
          <button
            onClick={handleProceedCloud}
            className="p-3.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-semibold shadow-lg shadow-amber-600/20 transition flex items-center justify-between group"
          >
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              <span>{t("cloudWarning.proceedCloudButton")}</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
          </button>

          {/* Switch to 100% Local Offline */}
          <button
            onClick={handleProceedLocal}
            className="p-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center justify-between group hover:border-emerald-500/40"
          >
            <div className="flex items-center gap-2 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              <span className="text-slate-200">
                {t("cloudWarning.proceedLocalButton")}
              </span>
            </div>
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition text-emerald-400" />
          </button>
        </div>

        {/* Checkbox: Don't show again */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 text-cyan-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-[11px] text-slate-400 hover:text-slate-300">
              {t("cloudWarning.dontShowAgain")}
            </span>
          </label>
        </div>
      </div>
    </div>
  );
};
