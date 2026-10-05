import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Cpu,
  Zap,
  CheckCircle2,
  Download,
  Sparkles,
  Layers,
  HardDrive,
  Loader2,
  Cloud,
  Globe,
  Key,
  Check,
  Edit3,
} from "lucide-react";

import { ModalShell } from "./ui/ModalShell";
import {
  GROQ_MODELS,
  GEMINI_MODELS,
  OPENAI_MODELS,
  modelLabel,
} from "./ModelHubModalConstants";
import { useI18n } from "../locales/i18nContext";
import { getActiveEngine, storeActiveEngine } from "../services/activeEngine";
import { CredentialStore } from "../services/credentialStore";

export interface ModelInfo {
  key: string;
  name: string;
  filename: string;
  size_mb: number;
  ram_required_mb: number;
  is_downloaded: boolean;
  is_active: boolean;
  description: string;
  accuracy_score: number;
  speed_score: number;
  download_url: string;
}

interface ModelHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModelChanged?: () => void;
}

export const ModelHubModal: React.FC<ModelHubModalProps> = ({
  isOpen,
  onClose,
  onModelChanged,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"local" | "cloud">("local");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeEngine, setActiveEngine] = useState<string>("local");

  // Selected Model Versions
  const [groqModelVersion, setGroqModelVersion] = useState<string>(
    "whisper-large-v3-turbo",
  );
  const [geminiModelVersion, setGeminiModelVersion] =
    useState<string>("gemini-1.5-flash");
  const [openaiModelVersion, setOpenaiModelVersion] =
    useState<string>("whisper-1");

  // Custom model text inputs
  const [customGroqModel, setCustomGroqModel] = useState<string>("");
  const [customGeminiModel, setCustomGeminiModel] = useState<string>("");
  const [customOpenaiModel, setCustomOpenaiModel] = useState<string>("");

  // Inline Key Inputs
  const [inlineKeyTarget, setInlineKeyTarget] = useState<string | null>(null);
  const [inlineKeyValue, setInlineKeyValue] = useState<string>("");

  const fetchModels = async () => {
    try {
      setLoading(true);
      const res = await invoke<ModelInfo[]>("get_available_models");
      setModels(res);
    } catch (e) {
      console.error("Model listesi alınamadı:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchModels();
      setStatusMessage(null);
      setInlineKeyTarget(null);
      setInlineKeyValue("");
      setActiveEngine(getActiveEngine());

      const storedGroq =
        localStorage.getItem("echomind_groq_model_version") ||
        "whisper-large-v3-turbo";
      const storedGemini =
        localStorage.getItem("echomind_gemini_model_version") ||
        "gemini-1.5-flash";
      const storedOpenai =
        localStorage.getItem("echomind_openai_model_version") || "whisper-1";

      if (GROQ_MODELS.some((m) => m.id === storedGroq)) {
        setGroqModelVersion(storedGroq);
      } else {
        setGroqModelVersion("custom");
        setCustomGroqModel(storedGroq);
      }

      if (GEMINI_MODELS.some((m) => m.id === storedGemini)) {
        setGeminiModelVersion(storedGemini);
      } else {
        setGeminiModelVersion("custom");
        setCustomGeminiModel(storedGemini);
      }

      if (OPENAI_MODELS.some((m) => m.id === storedOpenai)) {
        setOpenaiModelVersion(storedOpenai);
      } else {
        setOpenaiModelVersion("custom");
        setCustomOpenaiModel(storedOpenai);
      }
    }
  }, [isOpen]);

  const handleSwitch = async (key: string) => {
    try {
      setLoading(true);
      await invoke("switch_transcription_model", { modelKey: key });
      storeActiveEngine("local");
      setActiveEngine("local");
      await fetchModels();
      setStatusMessage("Yerel model başarıyla aktifleştirildi.");
      if (onModelChanged) onModelChanged();
    } catch (e: any) {
      setStatusMessage(`Hata: ${e.toString()}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOfflineEngine = (engine: "apple_speech") => {
    storeActiveEngine(engine);
    setActiveEngine(engine);
    const names: Record<string, string> = {
      apple_speech: "🍎 macOS Yerel Ses Tanıma (Apple Dikte / ANE)",
    };
    setStatusMessage(`${names[engine]} aktif çevrimdışı motor olarak seçildi!`);
    if (onModelChanged) onModelChanged();
  };

  const handleSelectCloudEngine = async (
    engine: "groq" | "gemini" | "openai",
  ) => {
    const keyStorageMap: Record<string, string> = {
      groq: "echomind_groq_key",
      gemini: "echomind_gemini_key",
      openai: "echomind_openai_key",
    };

    const keyName = keyStorageMap[engine];
    const storedKey = await CredentialStore.get(keyName);

    if (!storedKey.trim()) {
      setInlineKeyTarget(engine);
      setInlineKeyValue("");
      setStatusMessage(
        `Lütfen ${engine.toUpperCase()} API anahtarınızı girip onaylayın.`,
      );
      return;
    }

    const engineKey = `cloud_${engine}`;
    storeActiveEngine(engineKey);
    setActiveEngine(engineKey);
    setInlineKeyTarget(null);

    const nameMap: Record<string, string> = {
      groq: "Groq Cloud Whisper",
      gemini: "Google Gemini Flash",
      openai: "OpenAI Whisper-1",
    };

    setStatusMessage(
      `${nameMap[engine]} aktif yapay zeka motoru olarak seçildi!`,
    );
    if (onModelChanged) onModelChanged();
  };

  const handleSaveInlineKeyAndActivate = async (
    engine: "groq" | "gemini" | "openai",
  ) => {
    const trimmed = inlineKeyValue.trim();
    if (!trimmed) return;

    const keyStorageMap: Record<string, string> = {
      groq: "echomind_groq_key",
      gemini: "echomind_gemini_key",
      openai: "echomind_openai_key",
    };

    await CredentialStore.set(keyStorageMap[engine], trimmed);
    const engineKey = `cloud_${engine}`;
    storeActiveEngine(engineKey);
    setActiveEngine(engineKey);
    setInlineKeyTarget(null);
    setInlineKeyValue("");

    const nameMap: Record<string, string> = {
      groq: "Groq Cloud Whisper",
      gemini: "Google Gemini Flash",
      openai: "OpenAI Whisper-1",
    };

    setStatusMessage(
      `${nameMap[engine]} anahtarı kaydedildi ve aktif hale getirildi!`,
    );
    if (onModelChanged) onModelChanged();
  };

  const handleDownload = async (key: string) => {
    try {
      setDownloadingKey(key);
      setStatusMessage("Model indiriliyor, lütfen bekleyin...");
      const msg = await invoke<string>("download_whisper_model", {
        modelKey: key,
      });
      setStatusMessage(msg);
      await fetchModels();
    } catch (e: any) {
      setStatusMessage(`İndirme başarısız: ${e.toString()}`);
    } finally {
      setDownloadingKey(null);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalShell
      onClose={onClose}
      icon={Layers}
      title={t("modelHub.title")}
      subtitle={t("modelHub.subtitle")}
      closeLabel={t("common.close")}
      size="lg"
      height="fixed"
      tabs={[
        {
          id: "local",
          label: t("retranscribe.localCardTitle"),
          icon: HardDrive,
        },
        {
          id: "cloud",
          label: t("retranscribe.cloudCardTitle"),
          icon: Cloud,
        },
      ]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      footer={
        <>
          <span className="text-slate-400 min-w-0">
            {t("ui.modelHub.footnote")}
          </span>
          <button
            onClick={onClose}
            className="shrink-0 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold border border-slate-700 transition"
          >
            {t("ui.modelHub.done")}
          </button>
        </>
      }
    >
      {/* Status Alert */}
      {statusMessage && (
        <div className="p-3 rounded-xl bg-indigo-950/50 border border-indigo-500/30 text-indigo-200 text-xs flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Tab Content: Local Models */}
      {activeTab === "local" && (
        <div className="space-y-4">
          {/* Apple Native Speech Recognizer Card */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              activeEngine === "apple_speech"
                ? "bg-slate-800/90 border-emerald-500/80 shadow-lg shadow-emerald-500/10"
                : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                    {t("ui.modelHub.appleTitle")}
                  </h3>
                  {activeEngine === "apple_speech" && (
                    <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                      {t("ui.modelHub.inUse")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  {t("ui.modelHub.appleDesc")}
                </p>
                <div className="flex items-center gap-4 text-xs text-slate-400 pt-1">
                  <span className="flex items-center gap-1">
                    <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                    {t("ui.modelHub.zeroDownload")}
                  </span>
                  <span className="flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-slate-500" />
                    ~0 MB RAM
                  </span>
                  <span className="flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    {t("ui.modelHub.speedValue", { value: 100 })}
                  </span>
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    {t("ui.modelHub.accuracyValue", { value: 95 })}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button
                  onClick={() => handleSelectOfflineEngine("apple_speech")}
                  disabled={activeEngine === "apple_speech"}
                  aria-label={t("ui.modelHub.appleSelectAria")}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                    activeEngine === "apple_speech"
                      ? "bg-slate-800 text-slate-500 cursor-default"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20"
                  }`}
                >
                  {activeEngine === "apple_speech"
                    ? t("ui.modelHub.inUse")
                    : t("ui.modelHub.select")}
                </button>
              </div>
            </div>
          </div>

          {loading && (!models || models.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mb-2" />
              <p className="text-sm">{t("ui.modelHub.preparing")}</p>
            </div>
          ) : (
            (models || []).map((model) => {
              const isActiveThis = activeEngine === "local" && model.is_active;

              return (
                <div
                  key={model.key}
                  className={`p-4 rounded-xl border transition-all ${
                    isActiveThis
                      ? "bg-slate-800/90 border-cyan-500/80 shadow-lg shadow-cyan-500/10"
                      : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                          {model.name}
                        </h3>
                        {isActiveThis && (
                          <span className="text-[11px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-semibold">
                            {t("ui.modelHub.inUse")}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">
                        {model.description}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-slate-400 pt-1">
                        <span className="flex items-center gap-1">
                          <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                          {model.size_mb} MB
                        </span>
                        <span className="flex items-center gap-1">
                          <Cpu className="w-3.5 h-3.5 text-slate-500" />~
                          {model.ram_required_mb} MB RAM
                        </span>
                        <span className="flex items-center gap-1">
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          {t("ui.modelHub.speedValue", {
                            value: model.speed_score,
                          })}
                        </span>
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          {t("ui.modelHub.accuracyValue", {
                            value: model.accuracy_score,
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 shrink-0">
                      {model.is_downloaded ? (
                        <button
                          onClick={() => handleSwitch(model.key)}
                          disabled={loading || isActiveThis}
                          className={`px-4 py-2 rounded-xl text-xs font-semibold transition active:scale-95 ${
                            isActiveThis
                              ? "bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 cursor-default"
                              : "bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20"
                          }`}
                        >
                          {isActiveThis
                            ? t("ui.modelHub.activeModel")
                            : t("ui.modelHub.useThis")}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDownload(model.key)}
                          disabled={downloadingKey !== null}
                          className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition active:scale-95"
                        >
                          {downloadingKey === model.key ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                              {t("ui.modelHub.downloading")}
                            </>
                          ) : (
                            <>
                              <Download className="w-3.5 h-3.5 text-cyan-400" />
                              {t("ui.modelHub.downloadSize", {
                                size: model.size_mb,
                              })}
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab Content: Cloud AI Models */}
      {activeTab === "cloud" && (
        <div className="space-y-4 text-xs">
          {/* 1. Groq Cloud */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              activeEngine === "cloud_groq"
                ? "bg-slate-800/90 border-amber-500/80 shadow-lg shadow-amber-500/10"
                : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    {t("ui.modelHub.groqTitle")}
                  </h3>
                  {activeEngine === "cloud_groq" && (
                    <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                      {t("ui.modelHub.activeMode")}
                    </span>
                  )}
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-medium">
                    {t("ui.modelHub.groqBadge")}
                  </span>
                </div>
                <p className="text-slate-400">{t("ui.modelHub.groqDesc")}</p>

                {/* Standardized Metrics: Sadece "Sıfır Yük" */}
                <div className="flex items-center gap-4 text-slate-300 pt-1">
                  <span>
                    {t("ui.modelHub.cpuLoad")}{" "}
                    <strong className="text-emerald-400">
                      {t("ui.modelHub.zeroLoad")}
                    </strong>
                  </span>
                  <span>
                    {t("ui.modelHub.speedLabel")}{" "}
                    <strong className="text-amber-400">
                      {t("ui.modelHub.inSeconds")}
                    </strong>
                  </span>
                  <span>
                    {t("ui.modelHub.qualityLabel")}{" "}
                    <strong className="text-cyan-400">
                      {t("ui.modelHub.crystalClear")}
                    </strong>
                  </span>
                </div>

                {/* Model Version Selector */}
                <div className="pt-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 font-medium">
                      {t("ui.modelHub.modelVersion")}
                    </span>
                    <select
                      value={groqModelVersion}
                      onChange={(e) => {
                        const val = e.target.value;
                        setGroqModelVersion(val);
                        if (val !== "custom") {
                          localStorage.setItem(
                            "echomind_groq_model_version",
                            val,
                          );
                        }
                      }}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 font-medium focus:outline-none focus:border-amber-500"
                    >
                      {GROQ_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {modelLabel(m, t)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {groqModelVersion === "custom" && (
                    <div className="flex items-center gap-2">
                      <Edit3 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <input
                        type="text"
                        value={customGroqModel}
                        onChange={(e) => {
                          setCustomGroqModel(e.target.value);
                          localStorage.setItem(
                            "echomind_groq_model_version",
                            e.target.value.trim(),
                          );
                        }}
                        placeholder={t("ui.modelHub.examplePlaceholder", {
                          example: "whisper-large-v3-turbo",
                        })}
                        className="flex-1 px-2.5 py-1 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
                      />
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleSelectCloudEngine("groq")}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition active:scale-95 ${
                  activeEngine === "cloud_groq"
                    ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 cursor-default"
                    : "bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-lg shadow-amber-600/20"
                }`}
              >
                {activeEngine === "cloud_groq"
                  ? t("ui.modelHub.inUse")
                  : t("ui.modelHub.select")}
              </button>
            </div>

            {/* Inline Key Form if needed */}
            {inlineKeyTarget === "groq" && (
              <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-2 animate-fadeIn">
                <Key className="w-4 h-4 text-amber-400 shrink-0" />
                <input
                  type="password"
                  value={inlineKeyValue}
                  onChange={(e) => setInlineKeyValue(e.target.value)}
                  placeholder={t("ui.modelHub.pasteKey", {
                    provider: "Groq",
                    prefix: "gsk_...",
                  })}
                  className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={() => handleSaveInlineKeyAndActivate("groq")}
                  disabled={!inlineKeyValue.trim()}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />{" "}
                  {t("ui.modelHub.saveAndSelect")}
                </button>
              </div>
            )}
          </div>

          {/* 2. Google Gemini Flash / Pro Extended Family */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              activeEngine === "cloud_gemini"
                ? "bg-slate-800/90 border-cyan-500/80 shadow-lg shadow-cyan-500/10"
                : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    {t("ui.modelHub.geminiTitle")}
                  </h3>
                  {activeEngine === "cloud_gemini" && (
                    <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                      {t("ui.modelHub.activeMode")}
                    </span>
                  )}
                  <span className="text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded font-medium">
                    {t("ui.modelHub.geminiBadge")}
                  </span>
                </div>
                <p className="text-slate-400">{t("ui.modelHub.geminiDesc")}</p>

                {/* Standardized Metrics: Sadece "Sıfır Yük" */}
                <div className="flex items-center gap-4 text-slate-300 pt-1">
                  <span>
                    {t("ui.modelHub.cpuLoad")}{" "}
                    <strong className="text-emerald-400">
                      {t("ui.modelHub.zeroLoad")}
                    </strong>
                  </span>
                  <span>
                    {t("ui.modelHub.speedLabel")}{" "}
                    <strong className="text-amber-400">
                      {t("ui.modelHub.inSeconds")}
                    </strong>
                  </span>
                  <span>
                    {t("ui.modelHub.qualityLabel")}{" "}
                    <strong className="text-cyan-400">
                      {t("ui.modelHub.topTier")}
                    </strong>
                  </span>
                </div>

                {/* Model Version Selector */}
                <div className="pt-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 font-medium">
                      {t("ui.modelHub.modelVersion")}
                    </span>
                    <select
                      value={geminiModelVersion}
                      onChange={(e) => {
                        const val = e.target.value;
                        setGeminiModelVersion(val);
                        if (val !== "custom") {
                          localStorage.setItem(
                            "echomind_gemini_model_version",
                            val,
                          );
                        }
                      }}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 font-medium focus:outline-none focus:border-cyan-500"
                    >
                      {GEMINI_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {modelLabel(m, t)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {geminiModelVersion === "custom" && (
                    <div className="flex items-center gap-2">
                      <Edit3 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <input
                        type="text"
                        value={customGeminiModel}
                        onChange={(e) => {
                          setCustomGeminiModel(e.target.value);
                          localStorage.setItem(
                            "echomind_gemini_model_version",
                            e.target.value.trim(),
                          );
                        }}
                        placeholder={t("ui.modelHub.examplePlaceholder", {
                          example: "gemini-2.0-flash / gemini-1.5-pro",
                        })}
                        className="flex-1 px-2.5 py-1 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleSelectCloudEngine("gemini")}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition active:scale-95 ${
                  activeEngine === "cloud_gemini"
                    ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 cursor-default"
                    : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-600/20"
                }`}
              >
                {activeEngine === "cloud_gemini"
                  ? t("ui.modelHub.inUse")
                  : t("ui.modelHub.select")}
              </button>
            </div>

            {/* Inline Key Form if needed */}
            {inlineKeyTarget === "gemini" && (
              <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-2 animate-fadeIn">
                <Key className="w-4 h-4 text-cyan-400 shrink-0" />
                <input
                  type="password"
                  value={inlineKeyValue}
                  onChange={(e) => setInlineKeyValue(e.target.value)}
                  placeholder={t("ui.modelHub.pasteKey", {
                    provider: "Google Gemini",
                    prefix: "AIzaSy...",
                  })}
                  className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={() => handleSaveInlineKeyAndActivate("gemini")}
                  disabled={!inlineKeyValue.trim()}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />{" "}
                  {t("ui.modelHub.saveAndSelect")}
                </button>
              </div>
            )}
          </div>

          {/* 3. OpenAI Cloud */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              activeEngine === "cloud_openai"
                ? "bg-slate-800/90 border-emerald-500/80 shadow-lg shadow-emerald-500/10"
                : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                    <Globe className="w-4 h-4 text-emerald-400" />
                    {t("ui.modelHub.openaiTitle")}
                  </h3>
                  {activeEngine === "cloud_openai" && (
                    <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                      {t("ui.modelHub.activeMode")}
                    </span>
                  )}
                </div>
                <p className="text-slate-400">{t("ui.modelHub.openaiDesc")}</p>

                {/* Standardized Metrics: Sadece "Sıfır Yük" */}
                <div className="flex items-center gap-4 text-slate-300 pt-1">
                  <span>
                    {t("ui.modelHub.cpuLoad")}{" "}
                    <strong className="text-emerald-400">
                      {t("ui.modelHub.zeroLoad")}
                    </strong>
                  </span>
                  <span>
                    {t("ui.modelHub.speedLabel")}{" "}
                    <strong className="text-amber-400">
                      {t("ui.modelHub.inSeconds")}
                    </strong>
                  </span>
                  <span>
                    {t("ui.modelHub.qualityLabel")}{" "}
                    <strong className="text-cyan-400">
                      {t("ui.modelHub.veryHigh")}
                    </strong>
                  </span>
                </div>

                {/* Model Version Selector */}
                <div className="pt-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 font-medium">
                      {t("ui.modelHub.modelVersion")}
                    </span>
                    <select
                      value={openaiModelVersion}
                      onChange={(e) => {
                        const val = e.target.value;
                        setOpenaiModelVersion(val);
                        if (val !== "custom") {
                          localStorage.setItem(
                            "echomind_openai_model_version",
                            val,
                          );
                        }
                      }}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 font-medium focus:outline-none focus:border-emerald-500"
                    >
                      {OPENAI_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {modelLabel(m, t)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {openaiModelVersion === "custom" && (
                    <div className="flex items-center gap-2">
                      <Edit3 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <input
                        type="text"
                        value={customOpenaiModel}
                        onChange={(e) => {
                          setCustomOpenaiModel(e.target.value);
                          localStorage.setItem(
                            "echomind_openai_model_version",
                            e.target.value.trim(),
                          );
                        }}
                        placeholder={t("ui.modelHub.examplePlaceholder", {
                          example: "whisper-1 / gpt-4o-audio-preview",
                        })}
                        className="flex-1 px-2.5 py-1 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleSelectCloudEngine("openai")}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition active:scale-95 ${
                  activeEngine === "cloud_openai"
                    ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 cursor-default"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20"
                }`}
              >
                {activeEngine === "cloud_openai"
                  ? t("ui.modelHub.inUse")
                  : t("ui.modelHub.select")}
              </button>
            </div>

            {/* Inline Key Form if needed */}
            {inlineKeyTarget === "openai" && (
              <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-2 animate-fadeIn">
                <Key className="w-4 h-4 text-emerald-400 shrink-0" />
                <input
                  type="password"
                  value={inlineKeyValue}
                  onChange={(e) => setInlineKeyValue(e.target.value)}
                  placeholder={t("ui.modelHub.pasteKey", {
                    provider: "OpenAI",
                    prefix: "sk-proj-...",
                  })}
                  className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => handleSaveInlineKeyAndActivate("openai")}
                  disabled={!inlineKeyValue.trim()}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />{" "}
                  {t("ui.modelHub.saveAndSelect")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
};
