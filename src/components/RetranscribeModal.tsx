import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  RotateCw,
  Cpu,
  Zap,
  Globe,
  Sparkles,
  Check,
  AlertCircle,
  Loader2,
  ShieldCheck,
  AudioLines,
} from "lucide-react";
import { MeetingRecord } from "../App";
import { useI18n } from "../locales/i18nContext";

interface RetranscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: MeetingRecord;
  onRetranscribeSuccess: (updatedMeeting: MeetingRecord) => void;
}

export const RetranscribeModal: React.FC<RetranscribeModalProps> = ({
  isOpen,
  onClose,
  meeting,
  onRetranscribeSuccess,
}) => {
  const { t } = useI18n();
  const [engineType, setEngineType] = useState<"local" | "cloud">("local");
  const [localModel, setLocalModel] = useState<string>("small");
  const [cloudProvider, setCloudProvider] = useState<
    "groq" | "openai" | "gemini"
  >("groq");
  const [language, setLanguage] = useState<string>("auto");

  // Summary engine preference
  const [summaryEngine, setSummaryEngine] = useState<
    "ollama" | "gemini" | "openai" | "groq" | "heuristic"
  >("ollama");

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      // Auto-detect if user has cloud keys
      const groqKey = localStorage.getItem("echomind_groq_key");
      const openaiKey = localStorage.getItem("echomind_openai_key");
      const geminiKey = localStorage.getItem("echomind_gemini_key");

      if (groqKey) {
        setCloudProvider("groq");
      } else if (openaiKey) {
        setCloudProvider("openai");
      } else if (geminiKey) {
        setCloudProvider("gemini");
      }

      const activeEngine = localStorage.getItem("echomind_active_engine");
      if (activeEngine && activeEngine.startsWith("cloud_")) {
        setEngineType("cloud");
      } else {
        setEngineType("local");
      }

      const activeModel =
        localStorage.getItem("echomind_active_model") || "small";
      setLocalModel(activeModel);

      // Default to Ollama summary if available
      const ollamaEndpoint = localStorage.getItem("echomind_ollama_endpoint");
      if (ollamaEndpoint) {
        setSummaryEngine("ollama");
      } else if (geminiKey) {
        setSummaryEngine("gemini");
      } else if (openaiKey) {
        setSummaryEngine("openai");
      } else if (groqKey) {
        setSummaryEngine("groq");
      } else {
        setSummaryEngine("heuristic");
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleStartRetranscribe = async () => {
    if (!meeting.audio_file_path) {
      setErrorMessage("Bu toplantıya ait orijinal ses dosyası bulunamadı.");
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      let cloudProv: string | null = null;
      let apiKey: string | null = null;
      let modelVer: string | null = null;

      if (engineType === "cloud") {
        cloudProv = cloudProvider;
        if (cloudProvider === "groq") {
          apiKey = localStorage.getItem("echomind_groq_key");
          modelVer =
            localStorage.getItem("echomind_groq_model_version") ||
            "whisper-large-v3-turbo";
        } else if (cloudProvider === "openai") {
          apiKey = localStorage.getItem("echomind_openai_key");
          modelVer =
            localStorage.getItem("echomind_openai_model_version") ||
            "whisper-1";
        } else if (cloudProvider === "gemini") {
          apiKey = localStorage.getItem("echomind_gemini_key");
          modelVer =
            localStorage.getItem("echomind_gemini_model_version") ||
            "gemini-1.5-flash";
        }

        if (!apiKey) {
          throw new Error(
            `Seçilen ${cloudProvider.toUpperCase()} bulut servisi için Ayarlar bölümünden API Anahtarı girmelisiniz.`,
          );
        }
      } else {
        if (localModel === "apple_speech" || localModel === "sensevoice") {
          cloudProv = localModel;
        } else {
          modelVer = localModel;
        }
      }

      // Summary API Key & Endpoints
      let sumApiKey: string | null = null;
      let customEndpoint: string | null = null;
      let customModel: string | null = null;

      if (summaryEngine === "gemini") {
        sumApiKey = localStorage.getItem("echomind_gemini_key");
      } else if (summaryEngine === "openai") {
        sumApiKey = localStorage.getItem("echomind_openai_key");
      } else if (summaryEngine === "groq") {
        sumApiKey = localStorage.getItem("echomind_groq_key");
      } else if (summaryEngine === "ollama") {
        customEndpoint =
          localStorage.getItem("echomind_ollama_endpoint") ||
          "http://127.0.0.1:11434";
        customModel =
          localStorage.getItem("echomind_ollama_model") || "llama3.2";
      }

      const updated = await invoke<MeetingRecord>("retranscribe_meeting", {
        meetingId: meeting.id,
        audioFilePath: meeting.audio_file_path,
        cloudProvider: cloudProv,
        apiKey,
        modelVersion: modelVer,
        language: language === "auto" ? null : language,
        summaryProvider: summaryEngine,
        summaryApiKey: sumApiKey,
        customEndpoint,
        customModel,
      });

      onRetranscribeSuccess(updated);
      onClose();
    } catch (err: any) {
      console.error("Yeniden transkribe hatası:", err);
      const msg =
        typeof err === "string"
          ? err
          : err?.message || "Yeniden transkripsiyon sırasında bir hata oluştu.";
      setErrorMessage(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-3xl bg-gradient-to-b from-slate-900/95 via-[#0c162d]/95 to-slate-950/95 border border-cyan-500/30 shadow-2xl shadow-cyan-950/60 p-6 md:p-8 flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <RotateCw
                className={`w-6 h-6 ${isProcessing ? "animate-spin" : ""}`}
              />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                {t("retranscribe.title")}
              </h3>
              <p className="text-xs text-slate-400">
                {t("retranscribe.subtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMessage && (
          <div className="p-4 mb-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">{errorMessage}</div>
          </div>
        )}

        {isProcessing ? (
          <div className="py-8 px-4 flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
            {/* Glowing Activity Orb */}
            <div className="relative flex items-center justify-center">
              <div className="absolute w-24 h-24 rounded-full bg-cyan-500/20 blur-xl" />
              <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-tr from-cyan-500/20 via-blue-500/20 to-purple-500/20 border border-cyan-500/40 flex items-center justify-center shadow-xl shadow-cyan-950/50">
                <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
              </div>
            </div>

            {/* Title and Subtitle */}
            <div className="max-w-md space-y-2">
              <h4 className="text-lg sm:text-xl font-bold text-white">
                {t("retranscribe.processingTitle")}
              </h4>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                {t("retranscribe.processingDesc")}
              </p>
            </div>

            {/* Step Progress Checklist */}
            <div className="w-full max-w-lg space-y-2.5 bg-slate-900/80 border border-cyan-500/20 rounded-2xl p-4 text-left">
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30">
                <div className="w-7 h-7 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
                  <AudioLines className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-cyan-200">
                    {t("retranscribe.step1Title")}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {t("retranscribe.step1Desc")}
                  </div>
                </div>
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              </div>

              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-blue-950/40 border border-blue-500/30">
                <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-blue-200">
                    {t("retranscribe.step2Title")}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {t("retranscribe.step2Desc")}
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-medium">
                  {t("retranscribe.processingButton")}
                </span>
              </div>

              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/40 border border-slate-800">
                <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-300">
                    {t("retranscribe.step3Title")}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {t("retranscribe.step3Desc")}
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">
                  Sırada
                </span>
              </div>
            </div>

            {/* Note */}
            <div className="flex items-center gap-2 text-[11px] text-slate-400 max-w-md pt-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>{t("retranscribe.processingNote")}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-6 flex-1">
              {/* 1. Engine Selection Tab */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5">
                  {t("retranscribe.methodStep")}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEngineType("local")}
                    className={`p-4 rounded-2xl border transition text-left flex items-start gap-3 ${
                      engineType === "local"
                        ? "bg-cyan-500/15 border-cyan-500/60 shadow-lg shadow-cyan-950/40 text-cyan-200"
                        : "bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-400"
                    }`}
                  >
                    <Cpu
                      className={`w-5 h-5 mt-0.5 ${engineType === "local" ? "text-cyan-400" : "text-slate-500"}`}
                    />
                    <div>
                      <div className="text-sm font-bold text-white mb-0.5">
                        {t("retranscribe.localCardTitle")}
                      </div>
                      <div className="text-xs text-slate-400">
                        {t("retranscribe.localCardDesc")}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEngineType("cloud")}
                    className={`p-4 rounded-2xl border transition text-left flex items-start gap-3 ${
                      engineType === "cloud"
                        ? "bg-amber-500/15 border-amber-500/60 shadow-lg shadow-amber-950/40 text-amber-200"
                        : "bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-400"
                    }`}
                  >
                    <Zap
                      className={`w-5 h-5 mt-0.5 ${engineType === "cloud" ? "text-amber-400" : "text-slate-500"}`}
                    />
                    <div>
                      <div className="text-sm font-bold text-white mb-0.5">
                        {t("retranscribe.cloudCardTitle")}
                      </div>
                      <div className="text-xs text-slate-400">
                        {t("retranscribe.cloudCardDesc")}
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* 2. Model Specific Options */}
              {engineType === "local" ? (
                <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-3">
                  <label className="block text-xs font-semibold text-slate-300">
                    {t("retranscribe.modelStep")}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {[
                      {
                        id: "apple_speech",
                        name: "🍎 macOS Yerel Ses Tanıma",
                        desc: "0 MB RAM, sıfır gecikme (Apple Dikte / ANE)",
                      },
                      {
                        id: "sensevoice",
                        name: "⚡ SenseVoice Small",
                        desc: "Ultra hızlı non-autoregressive (Sıfır halüsinasyon)",
                      },
                      {
                        id: "small",
                        name: t("retranscribe.smallName"),
                        desc: t("retranscribe.smallDesc"),
                      },
                      {
                        id: "medium",
                        name: t("retranscribe.mediumName"),
                        desc: t("retranscribe.mediumDesc"),
                      },
                      {
                        id: "large-v3-turbo",
                        name: t("retranscribe.largeName"),
                        desc: t("retranscribe.largeDesc"),
                      },
                      {
                        id: "base",
                        name: t("retranscribe.baseName"),
                        desc: t("retranscribe.baseDesc"),
                      },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setLocalModel(m.id)}
                        className={`p-3 rounded-xl border text-left transition flex items-center justify-between ${
                          localModel === m.id
                            ? "bg-cyan-500/20 border-cyan-500 text-cyan-200"
                            : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300"
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold text-white">
                            {m.name}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {m.desc}
                          </div>
                        </div>
                        {localModel === m.id && (
                          <Check className="w-4 h-4 text-cyan-400 shrink-0 ml-2" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-3">
                  <label className="block text-xs font-semibold text-slate-300">
                    {t("retranscribe.cloudStep")}
                  </label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {[
                      {
                        id: "groq" as const,
                        name: t("retranscribe.groqName"),
                        desc: t("retranscribe.groqDesc"),
                      },
                      {
                        id: "openai" as const,
                        name: t("retranscribe.openaiName"),
                        desc: t("retranscribe.openaiDesc"),
                      },
                      {
                        id: "gemini" as const,
                        name: t("retranscribe.geminiName"),
                        desc: t("retranscribe.geminiDesc"),
                      },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setCloudProvider(p.id)}
                        className={`p-3 rounded-xl border text-left transition ${
                          cloudProvider === p.id
                            ? "bg-amber-500/20 border-amber-500 text-amber-200"
                            : "bg-slate-950/60 border-slate-800 hover:border-slate-700 text-slate-300"
                        }`}
                      >
                        <div className="text-xs font-bold text-white">
                          {p.name}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {p.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. Language & Summary Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" />
                    {t("retranscribe.speechLanguage")}
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-200 focus:outline-none focus:border-cyan-500/70"
                  >
                    <option value="auto">{t("retranscribe.autoDetect")}</option>
                    <option value="tr">🇹🇷 Türkçe</option>
                    <option value="en">🇬🇧 English</option>
                    <option value="de">🇩🇪 Deutsch</option>
                    <option value="fr">🇫🇷 Français</option>
                    <option value="es">🇪🇸 Español</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    {t("retranscribe.summaryProviderTitle")}
                  </label>
                  <select
                    value={summaryEngine}
                    onChange={(e) => setSummaryEngine(e.target.value as any)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-200 focus:outline-none focus:border-cyan-500/70"
                  >
                    <option value="ollama">
                      {t("retranscribe.ollamaProvider")}
                    </option>
                    <option value="gemini">
                      {t("retranscribe.geminiProvider")}
                    </option>
                    <option value="openai">
                      {t("retranscribe.openaiProvider")}
                    </option>
                    <option value="groq">
                      {t("retranscribe.groqProvider")}
                    </option>
                    <option value="heuristic">
                      {t("retranscribe.heuristicProvider")}
                    </option>
                  </select>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="mt-8 pt-4 border-t border-slate-800/80 flex items-center justify-between">
              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                {t("retranscribe.privacyNotice")}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-xs sm:text-sm font-medium transition"
                >
                  {t("retranscribe.cancelButton")}
                </button>

                <button
                  type="button"
                  onClick={handleStartRetranscribe}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs sm:text-sm font-semibold transition flex items-center gap-2 shadow-lg shadow-cyan-900/30"
                >
                  <RotateCw className="w-4 h-4" />
                  <span>{t("retranscribe.submitButton")}</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
export default RetranscribeModal;
