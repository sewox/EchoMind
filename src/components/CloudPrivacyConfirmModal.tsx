import React, { useState } from "react";
import { ShieldAlert, Zap, ShieldCheck, ArrowRight } from "lucide-react";
import { ModalShell } from "./ui/ModalShell";
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
    <ModalShell
      onClose={onClose}
      icon={ShieldAlert}
      title={t("cloudWarning.title")}
      subtitle={t("cloudWarning.subtitle")}
      closeLabel={t("common.close")}
      footer={
        <>
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
        </>
      }
    >
      {/* Informative Body */}
      <div className="text-xs text-slate-300 leading-relaxed bg-slate-950/70 border border-slate-800/80 p-4 rounded-xl space-y-2.5">
        <p>{t("cloudWarning.providerSelected", { provider: providerName })}</p>
        <p className="text-slate-400">{t("cloudWarning.cloudDesc")}</p>
        <p className="text-slate-400">{t("cloudWarning.localAlternative")}</p>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
    </ModalShell>
  );
};
