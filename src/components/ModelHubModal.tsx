import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Cpu,
  Zap,
  CheckCircle2,
  Download,
  Sparkles,
  X,
  Layers,
  HardDrive,
  Loader2,
  Cloud,
  Globe,
  Key,
  Check,
  Edit3,
} from "lucide-react";

import {
  GROQ_MODELS,
  GEMINI_MODELS,
  OPENAI_MODELS,
} from "./ModelHubModalConstants";
import { useI18n } from "../locales/i18nContext";

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
      const engine = localStorage.getItem("echomind_active_engine") || "local";
      setActiveEngine(engine);

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
      localStorage.setItem("echomind_active_engine", "local");
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

  const handleSelectOfflineEngine = (engine: "apple_speech" | "sensevoice") => {
    localStorage.setItem("echomind_active_engine", engine);
    setActiveEngine(engine);
    const names: Record<string, string> = {
      apple_speech: "🍎 macOS Yerel Ses Tanıma (Apple Dikte / ANE)",
      sensevoice: "⚡ SenseVoice Ultra Hızlı Yerel Motor",
    };
    setStatusMessage(`${names[engine]} aktif çevrimdışı motor olarak seçildi!`);
    if (onModelChanged) onModelChanged();
  };

  const handleSelectCloudEngine = (engine: "groq" | "gemini" | "openai") => {
    const keyStorageMap: Record<string, string> = {
      groq: "echomind_groq_key",
      gemini: "echomind_gemini_key",
      openai: "echomind_openai_key",
    };

    const keyName = keyStorageMap[engine];
    const storedKey = localStorage.getItem(keyName) || "";

    if (!storedKey.trim()) {
      setInlineKeyTarget(engine);
      setInlineKeyValue("");
      setStatusMessage(
        `Lütfen ${engine.toUpperCase()} API anahtarınızı girip onaylayın.`,
      );
      return;
    }

    const engineKey = `cloud_${engine}`;
    localStorage.setItem("echomind_active_engine", engineKey);
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

  const handleSaveInlineKeyAndActivate = (
    engine: "groq" | "gemini" | "openai",
  ) => {
    const trimmed = inlineKeyValue.trim();
    if (!trimmed) return;

    const keyStorageMap: Record<string, string> = {
      groq: "echomind_groq_key",
      gemini: "echomind_gemini_key",
      openai: "echomind_openai_key",
    };

    localStorage.setItem(keyStorageMap[engine], trimmed);
    const engineKey = `cloud_${engine}`;
    localStorage.setItem("echomind_active_engine", engineKey);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                {t("modelHub.title")}
              </h2>
              <p className="text-xs text-slate-400">{t("modelHub.subtitle")}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Engine Tabs */}
        <div className="px-6 pt-4 flex gap-2 border-b border-slate-800/80 bg-slate-950/40">
          <button
            onClick={() => setActiveTab("local")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition ${
              activeTab === "local"
                ? "border-cyan-500 text-cyan-400 bg-slate-900"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <HardDrive className="w-4 h-4" />
            {t("retranscribe.localCardTitle")}
          </button>
          <button
            onClick={() => setActiveTab("cloud")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition ${
              activeTab === "cloud"
                ? "border-amber-500 text-amber-400 bg-slate-900"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Cloud className="w-4 h-4 text-amber-400" />
            {t("retranscribe.cloudCardTitle")}
          </button>
        </div>

        {/* Status Alert */}
        {statusMessage && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-indigo-950/50 border border-indigo-500/30 text-indigo-200 text-xs flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Tab Content: Local Models */}
        {activeTab === "local" && (
          <div className="p-6 overflow-y-auto space-y-4 flex-1">
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
                      🍎 macOS Yerel Ses Tanıma (Apple Dikte / ANE)
                    </h3>
                    {activeEngine === "apple_speech" && (
                      <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                        Kullanımda
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    İşletim sisteminizin yerleşik Türkçe konuşma tanıma motoru. 0 MB RAM, sıfır gecikme ve Apple Neural Engine hızlandırmasıyla çalışır.
                  </p>
                  <div className="flex items-center gap-4 text-xs text-slate-400 pt-1">
                    <span className="flex items-center gap-1">
                      <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                      0 MB İndirme
                    </span>
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3.5 h-3.5 text-slate-500" />
                      ~0 MB RAM
                    </span>
                    <span className="flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      Hız: %100
                    </span>
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      Doğruluk: %95
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => handleSelectOfflineEngine("apple_speech")}
                    disabled={activeEngine === "apple_speech"}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                      activeEngine === "apple_speech"
                        ? "bg-slate-800 text-slate-500 cursor-default"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20"
                    }`}
                  >
                    {activeEngine === "apple_speech" ? "Kullanımda" : "Bunu Seç"}
                  </button>
                </div>
              </div>
            </div>

            {/* SenseVoice Small Card */}
            <div
              className={`p-4 rounded-xl border transition-all ${
                activeEngine === "sensevoice"
                  ? "bg-slate-800/90 border-cyan-500/80 shadow-lg shadow-cyan-500/10"
                  : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                      ⚡ SenseVoice Small (Non-Autoregressive Fast ASR)
                    </h3>
                    {activeEngine === "sensevoice" && (
                      <span className="text-[11px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-semibold">
                        Kullanımda
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Halüsinasyonsuz, kelime uydurmayan ve Whisper'dan 15 kat daha hızlı çalışan yeni nesil yerel konuşma tanıma motoru.
                  </p>
                  <div className="flex items-center gap-4 text-xs text-slate-400 pt-1">
                    <span className="flex items-center gap-1">
                      <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                      120 MB
                    </span>
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3.5 h-3.5 text-slate-500" />
                      ~250 MB RAM
                    </span>
                    <span className="flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      Hız: %98
                    </span>
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      Doğruluk: %92
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => handleSelectOfflineEngine("sensevoice")}
                    disabled={activeEngine === "sensevoice"}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                      activeEngine === "sensevoice"
                        ? "bg-slate-800 text-slate-500 cursor-default"
                        : "bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20"
                    }`}
                  >
                    {activeEngine === "sensevoice" ? "Kullanımda" : "Bunu Seç"}
                  </button>
                </div>
              </div>
            </div>

            {loading && (!models || models.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400 mb-2" />
                <p className="text-sm">Seçenekler hazırlanıyor...</p>
              </div>
            ) : (
              (models || []).map((model) => {
                const isActiveThis =
                  activeEngine === "local" && model.is_active;

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
                              Kullanımda
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
                            Hız: %{model.speed_score}
                          </span>
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            Doğruluk: %{model.accuracy_score}
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
                            {isActiveThis ? "Aktif Model" : "Bunu Kullan"}
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
                                İndiriliyor...
                              </>
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5 text-cyan-400" />
                                İndir ({model.size_mb} MB)
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
          <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
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
                      Yıldırım Hızı (Groq Cloud Whisper)
                    </h3>
                    {activeEngine === "cloud_groq" && (
                      <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                        Aktif Mod
                      </span>
                    )}
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-medium">
                      En Hızlı (10 Saniye)
                    </span>
                  </div>
                  <p className="text-slate-400">
                    1 saatlik ses kaydını{" "}
                    <strong>10 saniye gibi kısa bir sürede</strong> eksiksiz
                    yazıya döker. Bilgisayarınızı hiç yormaz ve pilinizi
                    tüketmez.
                  </p>

                  {/* Standardized Metrics: Sadece "Sıfır Yük" */}
                  <div className="flex items-center gap-4 text-slate-300 pt-1">
                    <span>
                      Bilgisayar Yükü:{" "}
                      <strong className="text-emerald-400">Sıfır Yük</strong>
                    </span>
                    <span>
                      Hız:{" "}
                      <strong className="text-amber-400">
                        ⚡ Saniyeler İçinde
                      </strong>
                    </span>
                    <span>
                      Anlama Kalitesi:{" "}
                      <strong className="text-cyan-400">
                        Kristal Netliğinde
                      </strong>
                    </span>
                  </div>

                  {/* Model Version Selector */}
                  <div className="pt-2 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-medium">
                        Model Versiyonu:
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
                            {m.name}
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
                          placeholder="Örn: whisper-large-v3-turbo"
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
                  {activeEngine === "cloud_groq" ? "Kullanımda" : "Bunu Seç"}
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
                    placeholder="Groq API Anahtarını Yapıştırın (gsk_...)"
                    className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={() => handleSaveInlineKeyAndActivate("groq")}
                    disabled={!inlineKeyValue.trim()}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" /> Kaydet & Seç
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
                      Google Gemini (Multimodal Ses & Akıl Yürütme)
                    </h3>
                    {activeEngine === "cloud_gemini" && (
                      <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                        Aktif Mod
                      </span>
                    )}
                    <span className="text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded font-medium">
                      Zengin Model Ailesi
                    </span>
                  </div>
                  <p className="text-slate-400">
                    Google'ın gelişmiş multimodal ses yapay zekası. Tüm Gemini
                    sürümleri ile yüksek doğruluk ve akıllı konuşmacı analizi.
                  </p>

                  {/* Standardized Metrics: Sadece "Sıfır Yük" */}
                  <div className="flex items-center gap-4 text-slate-300 pt-1">
                    <span>
                      Bilgisayar Yükü:{" "}
                      <strong className="text-emerald-400">Sıfır Yük</strong>
                    </span>
                    <span>
                      Hız:{" "}
                      <strong className="text-amber-400">
                        ⚡ Saniyeler İçinde
                      </strong>
                    </span>
                    <span>
                      Anlama Kalitesi:{" "}
                      <strong className="text-cyan-400">Üst Düzey Zeka</strong>
                    </span>
                  </div>

                  {/* Model Version Selector */}
                  <div className="pt-2 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-medium">
                        Model Versiyonu:
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
                            {m.name}
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
                          placeholder="Örn: gemini-2.0-flash veya gemini-1.5-pro"
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
                  {activeEngine === "cloud_gemini" ? "Kullanımda" : "Bunu Seç"}
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
                    placeholder="Google Gemini API Anahtarını Yapıştırın (AIzaSy...)"
                    className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    onClick={() => handleSaveInlineKeyAndActivate("gemini")}
                    disabled={!inlineKeyValue.trim()}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" /> Kaydet & Seç
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
                      Küresel Standart (OpenAI Whisper & GPT-4o Audio)
                    </h3>
                    {activeEngine === "cloud_openai" && (
                      <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                        Aktif Mod
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400">
                    Dünya çapında bilinen yapay zeka altyapısıyla çok dilli
                    toplantılar için üstün başarı.
                  </p>

                  {/* Standardized Metrics: Sadece "Sıfır Yük" */}
                  <div className="flex items-center gap-4 text-slate-300 pt-1">
                    <span>
                      Bilgisayar Yükü:{" "}
                      <strong className="text-emerald-400">Sıfır Yük</strong>
                    </span>
                    <span>
                      Hız:{" "}
                      <strong className="text-amber-400">
                        ⚡ Saniyeler İçinde
                      </strong>
                    </span>
                    <span>
                      Anlama Kalitesi:{" "}
                      <strong className="text-cyan-400">Çok Yüksek</strong>
                    </span>
                  </div>

                  {/* Model Version Selector */}
                  <div className="pt-2 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-medium">
                        Model Versiyonu:
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
                            {m.name}
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
                          placeholder="Örn: whisper-1 veya gpt-4o-audio-preview"
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
                  {activeEngine === "cloud_openai" ? "Kullanımda" : "Bunu Seç"}
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
                    placeholder="OpenAI API Anahtarını Yapıştırın (sk-proj-...)"
                    className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={() => handleSaveInlineKeyAndActivate("openai")}
                    disabled={!inlineKeyValue.trim()}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" /> Kaydet & Seç
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs text-slate-400">
          <span>
            * İstediğiniz zaman gizlilik ve hız tercihlerinize göre tek tıkla
            değiştirebilirsiniz.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium transition"
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
};
