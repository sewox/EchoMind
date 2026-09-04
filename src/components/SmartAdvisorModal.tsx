import React, { useState, useEffect } from "react";
import {
  Zap,
  ShieldCheck,
  Sparkles,
  X,
  Key,
  ArrowRight,
  AlertCircle,
  FileAudio,
  Settings as SettingsIcon,
  Check,
  Globe,
} from "lucide-react";
import { useI18n } from "../locales/i18nContext";

export interface PickedFileInfo {
  path: string;
  file_name: string;
  file_size_mb: number;
  is_large_file: boolean;
}

interface SmartAdvisorModalProps {
  isOpen: boolean;
  fileInfo: PickedFileInfo | null;
  onConfirm: (
    engine: "local" | "cloud_groq" | "cloud_gemini" | "cloud_openai",
    apiKey?: string,
    modelVersion?: string,
    language?: string,
  ) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}

export const SmartAdvisorModal: React.FC<SmartAdvisorModalProps> = ({
  isOpen,
  fileInfo,
  onConfirm,
  onClose,
  onOpenSettings,
}) => {
  const { t } = useI18n();
  const [groqKey, setGroqKey] = useState<string>("");
  const [geminiKey, setGeminiKey] = useState<string>("");
  const [openaiKey, setOpenaiKey] = useState<string>("");
  const [inlineKeyInput, setInlineKeyInput] = useState<string>("");
  const [selectedCloudProvider, setSelectedCloudProvider] = useState<
    "groq" | "gemini" | "openai"
  >("groq");
  const [showKeyInputForm, setShowKeyInputForm] = useState<boolean>(false);
  const [rememberChoice, setRememberChoice] = useState<boolean>(false);
  const [importLanguage, setImportLanguage] = useState<string>("auto");

  useEffect(() => {
    if (isOpen) {
      const storedGroq = localStorage.getItem("echomind_groq_key") || "";
      const storedGemini = localStorage.getItem("echomind_gemini_key") || "";
      const storedOpenai = localStorage.getItem("echomind_openai_key") || "";
      setGroqKey(storedGroq);
      setGeminiKey(storedGemini);
      setOpenaiKey(storedOpenai);
      setShowKeyInputForm(false);
      setInlineKeyInput("");
      setImportLanguage("auto");
    }
  }, [isOpen]);

  if (!isOpen || !fileInfo) return null;

  const getActiveKey = () => {
    if (selectedCloudProvider === "groq") return groqKey;
    if (selectedCloudProvider === "gemini") return geminiKey;
    return openaiKey;
  };

  const getModelVersion = () => {
    if (selectedCloudProvider === "groq") {
      return (
        localStorage.getItem("echomind_groq_model_version") ||
        "whisper-large-v3-turbo"
      );
    }
    if (selectedCloudProvider === "gemini") {
      return (
        localStorage.getItem("echomind_gemini_model_version") ||
        "gemini-1.5-flash"
      );
    }
    return localStorage.getItem("echomind_openai_model_version") || "whisper-1";
  };

  const hasAnyKey =
    groqKey.trim().length > 0 ||
    geminiKey.trim().length > 0 ||
    openaiKey.trim().length > 0;
  const currentKey = getActiveKey();

  const handleSelectCloud = () => {
    if (currentKey.trim().length > 0) {
      const engine = `cloud_${selectedCloudProvider}` as
        "cloud_groq" | "cloud_gemini" | "cloud_openai";
      if (rememberChoice) {
        localStorage.setItem("echomind_active_engine", engine);
      }
      onConfirm(engine, currentKey, getModelVersion(), importLanguage);
    } else {
      setShowKeyInputForm(true);
    }
  };

  const handleSaveInlineKeyAndProceed = () => {
    const trimmed = inlineKeyInput.trim();
    if (!trimmed) return;

    if (selectedCloudProvider === "groq") {
      localStorage.setItem("echomind_groq_key", trimmed);
      setGroqKey(trimmed);
    } else if (selectedCloudProvider === "gemini") {
      localStorage.setItem("echomind_gemini_key", trimmed);
      setGeminiKey(trimmed);
    } else {
      localStorage.setItem("echomind_openai_key", trimmed);
      setOpenaiKey(trimmed);
    }

    const engine = `cloud_${selectedCloudProvider}` as
      "cloud_groq" | "cloud_gemini" | "cloud_openai";
    if (rememberChoice) {
      localStorage.setItem("echomind_active_engine", engine);
    }
    onConfirm(engine, trimmed, getModelVersion(), importLanguage);
  };

  const handleSelectLocal = () => {
    if (rememberChoice) {
      localStorage.setItem("echomind_active_engine", "local");
    }
    onConfirm("local", undefined, undefined, importLanguage);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 relative overflow-hidden flex flex-col gap-5 text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow Ambient */}
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-60 h-60 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 border border-amber-500/30 text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base">
                {t("smartAdvisor.title")}
              </h3>
              <p className="text-xs text-slate-400">
                {t("smartAdvisor.subtitle")}
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

        {/* File Details Card */}
        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileAudio className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="font-medium text-slate-200 truncate">
              {fileInfo.file_name}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0 text-slate-400">
            <span className="px-2 py-0.5 rounded-md bg-slate-800 text-cyan-300 font-mono text-[11px]">
              {fileInfo.file_size_mb} MB
            </span>
          </div>
        </div>

        {/* Meeting Spoken Language Selector */}
        <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <Globe className="w-4 h-4 text-cyan-400" />
            <span className="font-medium">
              {t("smartAdvisor.speechLanguage")}
            </span>
          </div>
          <select
            value={importLanguage}
            onChange={(e) => setImportLanguage(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:border-cyan-500 cursor-pointer"
          >
            <option value="auto">🌐 {t("retranscribe.autoDetect")}</option>
            <option value="tr">🇹🇷 Türkçe</option>
            <option value="en">🇬🇧 English</option>
            <option value="de">🇩🇪 Deutsch</option>
            <option value="fr">🇫🇷 Français</option>
            <option value="es">🇪🇸 Español</option>
          </select>
        </div>

        {/* Description Banner */}
        <div className="text-xs text-slate-300 leading-relaxed bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-xl flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-200">
              {t("smartAdvisor.largeFileAlert")}
            </p>
            <p className="text-slate-300 mt-1">
              {t("smartAdvisor.largeFileDesc")}
            </p>
          </div>
        </div>

        {/* Decision Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Cloud Option */}
          <button
            onClick={handleSelectCloud}
            className="p-4 rounded-xl border border-cyan-500/30 bg-gradient-to-b from-cyan-950/30 to-slate-900/80 hover:border-cyan-500/70 transition duration-200 text-left flex flex-col justify-between group shadow-lg hover:shadow-cyan-950/40 relative overflow-hidden"
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  <Zap className="w-4 h-4" />
                </span>
                <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300">
                  {t("smartAdvisor.cloudBadge")}
                </span>
              </div>
              <h4 className="text-sm font-semibold text-white group-hover:text-cyan-200 transition">
                {t("smartAdvisor.cloudCardTitle")}
              </h4>
              <p className="text-[11px] text-slate-400 leading-snug">
                {t("smartAdvisor.cloudCardDesc")}
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-cyan-400 font-medium">
              <span>
                {hasAnyKey
                  ? t("smartAdvisor.startWithCloud")
                  : t("smartAdvisor.startWithKey")}
              </span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
            </div>
          </button>

          {/* Local Offline Option */}
          <button
            onClick={handleSelectLocal}
            className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-emerald-500/50 hover:bg-slate-900/80 transition duration-200 text-left flex flex-col justify-between group"
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <ShieldCheck className="w-4 h-4" />
                </span>
                <span className="text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
                  {t("smartAdvisor.localBadge")}
                </span>
              </div>
              <h4 className="text-sm font-semibold text-white group-hover:text-emerald-200 transition">
                {t("smartAdvisor.localCardTitle")}
              </h4>
              <p className="text-[11px] text-slate-400 leading-snug">
                {t("smartAdvisor.localCardDesc")}
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-300 font-medium">
              <span>{t("smartAdvisor.continueDevice")}</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition text-emerald-400" />
            </div>
          </button>
        </div>

        {/* Inline Key Input Form if Cloud selected without key */}
        {showKeyInputForm && (
          <div className="p-4 rounded-xl bg-slate-950 border border-cyan-500/40 space-y-3 animate-in fade-in-50 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-semibold text-white">
                  {t("smartAdvisor.enterKeyTitle")}
                </span>
              </div>
              <button
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
                className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
              >
                <SettingsIcon className="w-3 h-3" />{" "}
                {t("smartAdvisor.manageSettings")}
              </button>
            </div>

            <p className="text-[11px] text-slate-400">
              {t("smartAdvisor.enterKeyDesc")}
            </p>

            <div className="flex gap-2 text-xs flex-wrap">
              <button
                onClick={() => setSelectedCloudProvider("groq")}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  selectedCloudProvider === "groq"
                    ? "bg-amber-600 text-white"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                Groq
              </button>
              <button
                onClick={() => setSelectedCloudProvider("gemini")}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  selectedCloudProvider === "gemini"
                    ? "bg-cyan-600 text-white"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                Google Gemini
              </button>
              <button
                onClick={() => setSelectedCloudProvider("openai")}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  selectedCloudProvider === "openai"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                OpenAI
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="password"
                value={inlineKeyInput}
                onChange={(e) => setInlineKeyInput(e.target.value)}
                placeholder={
                  selectedCloudProvider === "groq"
                    ? "gsk_..."
                    : selectedCloudProvider === "gemini"
                      ? "AIzaSy..."
                      : "sk-proj-..."
                }
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
              <button
                onClick={handleSaveInlineKeyAndProceed}
                disabled={!inlineKeyInput.trim()}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-semibold transition flex items-center gap-1.5 shrink-0"
              >
                <Check className="w-3.5 h-3.5" />{" "}
                {t("smartAdvisor.startButton")}
              </button>
            </div>
          </div>
        )}

        {/* Footer: Remember choice checkbox */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 text-cyan-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-[11px] text-slate-400 hover:text-slate-300">
              {t("smartAdvisor.rememberChoice")}
            </span>
          </label>
          <button
            onClick={onClose}
            className="text-[11px] text-slate-400 hover:text-white transition"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
};
