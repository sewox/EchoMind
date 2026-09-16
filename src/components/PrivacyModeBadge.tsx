import React, { useState, useRef, useEffect } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Zap,
  ChevronDown,
  Check,
} from "lucide-react";
import { usePrivacyMode } from "../hooks/usePrivacyMode";
import { PrivacyMode } from "../types/privacy";
import { useI18n } from "../locales/i18nContext";

interface PrivacyModeBadgeProps {
  compact?: boolean;
}

export const PrivacyModeBadge: React.FC<PrivacyModeBadgeProps> = ({
  compact = false,
}) => {
  const { setPrivacyMode, isParanoid, isBalanced, isMaxIntelligence } =
    usePrivacyMode();
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelectMode = (newMode: PrivacyMode) => {
    setPrivacyMode(newMode);
    setIsOpen(false);
  };

  const currentIcon = isParanoid ? (
    <ShieldAlert className="w-3.5 h-3.5 text-purple-400 shrink-0 animate-pulse" />
  ) : isBalanced ? (
    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
  ) : (
    <Zap className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
  );

  const currentLabel = isParanoid
    ? t("privacyModes.paranoid.name")
    : isBalanced
      ? t("privacyModes.balanced.name")
      : t("privacyModes.maxIntelligence.name");

  const currentBadgeStyles = isParanoid
    ? "bg-purple-950/60 border-purple-500/40 text-purple-200 hover:bg-purple-900/60 hover:border-purple-400"
    : isBalanced
      ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-200 hover:bg-emerald-900/60 hover:border-emerald-400"
      : "bg-cyan-950/60 border-cyan-500/40 text-cyan-200 hover:bg-cyan-900/60 hover:border-cyan-400";

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        data-testid="privacy-mode-badge-button"
        title={t("privacyModes.quickSwitch")}
        className={`flex items-center gap-1.5 rounded-full border transition-all duration-200 cursor-pointer shadow-sm ${currentBadgeStyles} ${
          compact
            ? "px-2 py-0.5 text-[10px]"
            : "px-2.5 py-1 text-xs font-medium"
        }`}
      >
        {currentIcon}
        <span className="font-semibold">{currentLabel}</span>
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-200 opacity-70 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          data-testid="privacy-mode-dropdown"
          className="absolute left-0 mt-1.5 w-72 rounded-2xl bg-slate-900/95 border border-white/10 p-2 shadow-2xl backdrop-blur-xl z-50 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="px-2.5 py-1.5 border-b border-white/5 mb-1.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              {t("privacyModes.title")}
            </span>
          </div>

          {/* 1. Paranoid Mode */}
          <button
            type="button"
            data-testid="privacy-option-paranoid"
            onClick={() => handleSelectMode("paranoid")}
            className={`w-full text-left p-2.5 rounded-xl transition flex items-start justify-between gap-2.5 ${
              isParanoid
                ? "bg-purple-950/70 border border-purple-500/50 text-purple-200"
                : "hover:bg-slate-800/80 text-slate-300"
            }`}
          >
            <div className="flex gap-2">
              <ShieldAlert className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-xs text-white">
                    {t("privacyModes.paranoid.name")}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">
                    Air-Gapped
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  {t("privacyModes.paranoid.desc")}
                </p>
              </div>
            </div>
            {isParanoid && (
              <Check className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
            )}
          </button>

          {/* 2. Balanced Mode */}
          <button
            type="button"
            data-testid="privacy-option-balanced"
            onClick={() => handleSelectMode("balanced")}
            className={`w-full text-left p-2.5 rounded-xl transition flex items-start justify-between gap-2.5 mt-1 ${
              isBalanced
                ? "bg-emerald-950/70 border border-emerald-500/50 text-emerald-200"
                : "hover:bg-slate-800/80 text-slate-300"
            }`}
          >
            <div className="flex gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-xs text-white">
                    {t("privacyModes.balanced.name")}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                    Önerilen
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  {t("privacyModes.balanced.desc")}
                </p>
              </div>
            </div>
            {isBalanced && (
              <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            )}
          </button>

          {/* 3. Max Intelligence Mode */}
          <button
            type="button"
            data-testid="privacy-option-max-intelligence"
            onClick={() => handleSelectMode("max_intelligence")}
            className={`w-full text-left p-2.5 rounded-xl transition flex items-start justify-between gap-2.5 mt-1 ${
              isMaxIntelligence
                ? "bg-cyan-950/70 border border-cyan-500/50 text-cyan-200"
                : "hover:bg-slate-800/80 text-slate-300"
            }`}
          >
            <div className="flex gap-2">
              <Zap className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-xs text-white">
                    {t("privacyModes.maxIntelligence.name")}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono">
                    Yüksek Hız
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                  {t("privacyModes.maxIntelligence.desc")}
                </p>
              </div>
            </div>
            {isMaxIntelligence && (
              <Check className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            )}
          </button>
        </div>
      )}
    </div>
  );
};
