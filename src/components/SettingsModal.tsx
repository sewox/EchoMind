import React, { useState, useEffect } from "react";
import {
  Settings,
  Cpu,
  HardDrive,
  ShieldCheck,
  ShieldAlert,
  Zap,
  Check,
  Key,
  Eye,
  EyeOff,
  Sparkles,
  X,
  Mic,
  Volume2,
  RefreshCw,
  Radio,
  Edit3,
  Server,
  Activity,
  Loader2,
  AlertTriangle,
  Globe,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { CredentialStore } from "../services/credentialStore";
import { usePrivacyMode } from "../hooks/usePrivacyMode";
import { HardwareInfo, ModelStatus } from "../App";
import {
  GROQ_MODELS,
  GEMINI_MODELS,
  OPENAI_MODELS,
} from "./ModelHubModalConstants";
import { useI18n, SUPPORTED_LANGUAGES } from "../locales/i18nContext";

import { UpdateCheckResult } from "./UpdateModal";

export interface AudioDeviceInfo {
  name: string;
  is_default: boolean;
  is_loopback: boolean;
  max_channels: number;
  default_sample_rate: number;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  hardware: HardwareInfo | null;
  modelStatus: ModelStatus | null;
  onOpenUpdateModal?: (info: UpdateCheckResult) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  hardware,
  modelStatus,
  onOpenUpdateModal,
}) => {
  const { t, language, setLanguage } = useI18n();
  const { setPrivacyMode, isParanoid, isBalanced, isMaxIntelligence } =
    usePrivacyMode();
  const [activeTab, setActiveTab] = useState<
    "audio" | "system" | "apiKeys" | "language"
  >("audio");

  // Audio Devices State
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] =
    useState<string>("default");
  const [isLoadingDevices, setIsLoadingDevices] = useState<boolean>(false);
  const [liveMicLevel, setLiveMicLevel] = useState<number>(0);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // Cloud API Keys State
  const [groqKey, setGroqKey] = useState<string>("");
  const [geminiKey, setGeminiKey] = useState<string>("");
  const [openaiKey, setOpenaiKey] = useState<string>("");

  const [groqModel, setGroqModel] = useState<string>("whisper-large-v3-turbo");
  const [geminiModel, setGeminiModel] = useState<string>("gemini-1.5-flash");
  const [openaiModel, setOpenaiModel] = useState<string>("whisper-1");

  const [customGroq, setCustomGroq] = useState<string>("");
  const [customGemini, setCustomGemini] = useState<string>("");
  const [customOpenai, setCustomOpenai] = useState<string>("");

  // Local LLM / Ollama Server State
  const [ollamaEndpoint, setOllamaEndpoint] = useState<string>(
    "http://127.0.0.1:11434",
  );
  const [ollamaModel, setOllamaModel] = useState<string>("llama3.2");
  const [ollamaTestStatus, setOllamaTestStatus] = useState<{
    state: "idle" | "testing" | "success" | "error";
    message?: string;
  }>({ state: "idle" });

  const [askCloudConfirm, setAskCloudConfirm] = useState<boolean>(true);

  // Meeting Detector Settings State
  const [detectorSettings, setDetectorSettings] = useState<{
    enabled: boolean;
    auto_start_record: boolean;
    auto_stop_on_app_close: boolean;
    ignored_apps: string[];
  }>({
    enabled: true,
    auto_start_record: false,
    auto_stop_on_app_close: true,
    ignored_apps: [],
  });

  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({
    groq: false,
    gemini: false,
    openai: false,
  });
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Software Updater State
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(true);
  const [updateStatus, setUpdateStatus] = useState<{
    state: "idle" | "checking" | "upToDate" | "updateAvailable" | "error";
    version?: string;
    message?: string;
  }>({ state: "idle" });

  const handleCheckUpdates = async () => {
    setUpdateStatus({ state: "checking" });
    try {
      const res = await invoke<UpdateCheckResult>("check_for_updates");
      if (res.is_update_available) {
        setUpdateStatus({
          state: "updateAvailable",
          version: res.latest_version,
        });
        if (onOpenUpdateModal) {
          onOpenUpdateModal(res);
        }
      } else {
        setUpdateStatus({
          state: "upToDate",
          version: res.current_version,
        });
      }
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : String(err) || "Update check failed";
      setUpdateStatus({
        state: "error",
        message: errorMsg,
      });
    }
  };

  const fetchAudioDevices = async () => {
    setIsLoadingDevices(true);
    try {
      const devs = await invoke<AudioDeviceInfo[]>("list_audio_devices");
      setAudioDevices(devs || []);
    } catch (err) {
      console.error("Ses aygıtları listelenemedi:", err);
      setAudioDevices([]);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAudioDevices();

      const savedDev =
        localStorage.getItem("echomind_selected_audio_device") || "default";
      setSelectedAudioDevice(savedDev);

      CredentialStore.get("echomind_groq_key").then((k) => setGroqKey(k || ""));
      CredentialStore.get("echomind_gemini_key").then((k) =>
        setGeminiKey(k || ""),
      );
      CredentialStore.get("echomind_openai_key").then((k) =>
        setOpenaiKey(k || ""),
      );

      setOllamaEndpoint(
        localStorage.getItem("echomind_ollama_endpoint") ||
          "http://127.0.0.1:11434",
      );
      setOllamaModel(
        localStorage.getItem("echomind_ollama_model") || "llama3.2",
      );
      setOllamaTestStatus({ state: "idle" });

      const storedGroq =
        localStorage.getItem("echomind_groq_model_version") ||
        "whisper-large-v3-turbo";
      const storedGemini =
        localStorage.getItem("echomind_gemini_model_version") ||
        "gemini-1.5-flash";
      const storedOpenai =
        localStorage.getItem("echomind_openai_model_version") || "whisper-1";

      if (GROQ_MODELS.some((m) => m.id === storedGroq)) {
        setGroqModel(storedGroq);
      } else {
        setGroqModel("custom");
        setCustomGroq(storedGroq);
      }

      if (GEMINI_MODELS.some((m) => m.id === storedGemini)) {
        setGeminiModel(storedGemini);
      } else {
        setGeminiModel("custom");
        setCustomGemini(storedGemini);
      }

      if (OPENAI_MODELS.some((m) => m.id === storedOpenai)) {
        setOpenaiModel(storedOpenai);
      } else {
        setOpenaiModel("custom");
        setCustomOpenai(storedOpenai);
      }

      const suppressed =
        localStorage.getItem("echomind_suppress_cloud_warning") === "true";
      setAskCloudConfirm(!suppressed);

      const autoCheck =
        localStorage.getItem("echomind_auto_check_updates") !== "false";
      setAutoCheckUpdates(autoCheck);
      setUpdateStatus({ state: "idle" });

      // Fetch meeting detector status & settings
      invoke<any>("get_detector_status")
        .then((res) => {
          if (res && res.settings) {
            setDetectorSettings(res.settings);
          }
        })
        .catch(() => {});

      setSavedSuccess(false);
    }
  }, [isOpen]);

  const handleUpdateDetector = (
    newSettings: Partial<typeof detectorSettings>,
  ) => {
    const merged = { ...detectorSettings, ...newSettings };
    setDetectorSettings(merged);
    invoke("update_detector_settings", { settings: merged }).catch(
      console.error,
    );
  };

  // Real-time Audio Diagnostics & Live VU Meter Polling when modal is open
  useEffect(() => {
    if (!isOpen) return;

    // Start live hardware mic preview stream
    invoke("start_mic_preview", {
      deviceName:
        selectedAudioDevice !== "default" ? selectedAudioDevice : null,
    }).catch(console.error);

    const timer = setInterval(async () => {
      try {
        const status: any = await invoke("get_audio_status");
        if (status) {
          setLiveMicLevel(status.mic_level || 0);
          setIsSpeaking(status.is_speaking || false);
        }
      } catch {}
    }, 80);

    return () => {
      clearInterval(timer);
      invoke("stop_mic_preview").catch(console.error);
    };
  }, [isOpen, selectedAudioDevice]);

  if (!isOpen) return null;

  const toggleShowKey = (key: string) => {
    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleDeviceChange = (devName: string) => {
    setSelectedAudioDevice(devName);
    if (devName === "default") {
      localStorage.removeItem("echomind_selected_audio_device");
    } else {
      localStorage.setItem("echomind_selected_audio_device", devName);
    }
  };

  const handleSaveKeys = async () => {
    await CredentialStore.set("echomind_groq_key", groqKey.trim());
    await CredentialStore.set("echomind_gemini_key", geminiKey.trim());
    await CredentialStore.set("echomind_openai_key", openaiKey.trim());

    try {
      await invoke("save_api_keys", {
        groq: groqKey.trim(),
        gemini: geminiKey.trim(),
        openai: openaiKey.trim(),
      });
    } catch {}

    localStorage.setItem(
      "echomind_ollama_endpoint",
      ollamaEndpoint.trim() || "http://127.0.0.1:11434",
    );
    localStorage.setItem(
      "echomind_ollama_model",
      ollamaModel.trim() || "llama3.2",
    );

    const finalGroq =
      groqModel === "custom"
        ? customGroq.trim() || "whisper-large-v3-turbo"
        : groqModel;
    const finalGemini =
      geminiModel === "custom"
        ? customGemini.trim() || "gemini-1.5-flash"
        : geminiModel;
    const finalOpenai =
      openaiModel === "custom"
        ? customOpenai.trim() || "whisper-1"
        : openaiModel;

    localStorage.setItem("echomind_groq_model_version", finalGroq);
    localStorage.setItem("echomind_gemini_model_version", finalGemini);
    localStorage.setItem("echomind_openai_model_version", finalOpenai);

    if (askCloudConfirm) {
      localStorage.removeItem("echomind_suppress_cloud_warning");
    } else {
      localStorage.setItem("echomind_suppress_cloud_warning", "true");
    }

    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
    }, 2500);
  };

  const testOllamaServer = async () => {
    setOllamaTestStatus({ state: "testing" });
    try {
      const res = await invoke<string>("test_ollama_connection", {
        endpoint: ollamaEndpoint.trim() || undefined,
        model: ollamaModel.trim() || undefined,
      });
      setOllamaTestStatus({ state: "success", message: res });
    } catch (err: any) {
      setOllamaTestStatus({ state: "error", message: String(err) });
    }
  };

  const handleCloseAndSave = () => {
    handleSaveKeys();
    onClose();
  };

  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platform =
    typeof navigator !== "undefined"
      ? (navigator as any).userAgentData?.platform || navigator.platform
      : "";
  const isMac =
    /Mac|iPod|iPhone|iPad/i.test(platform || userAgent) ||
    (hardware?.os_name?.toLowerCase().includes("mac") ?? false);
  const isWindows =
    /Win/i.test(platform || userAgent) ||
    (hardware?.os_name?.toLowerCase().includes("windows") ?? false);
  const isLinux =
    /Linux/i.test(platform || userAgent) ||
    (hardware?.os_name?.toLowerCase().includes("linux") ?? false);

  const osLabel = isMac
    ? "macOS"
    : isWindows
      ? "Windows"
      : isLinux
        ? "Linux"
        : "Sistem";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 relative overflow-hidden flex flex-col gap-5 text-slate-100 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base">
                Ayarlar ve Tercihler
              </h3>
              <p className="text-xs text-slate-400">
                Mikrofon, cihaz performansı ve yapay zeka seçenekleri
              </p>
            </div>
          </div>
          <button
            onClick={handleCloseAndSave}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-slate-800/80">
          <button
            onClick={() => setActiveTab("audio")}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition ${
              activeTab === "audio"
                ? "border-cyan-500 text-cyan-400 bg-slate-800/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Mic className="w-4 h-4" />
            {t("settings.tabAudio")}
          </button>
          <button
            onClick={() => setActiveTab("system")}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition ${
              activeTab === "system"
                ? "border-blue-500 text-blue-400 bg-slate-800/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Cpu className="w-4 h-4" />
            {t("settings.tabSystem")}
          </button>
          <button
            onClick={() => setActiveTab("apiKeys")}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition ${
              activeTab === "apiKeys"
                ? "border-amber-500 text-amber-400 bg-slate-800/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Key className="w-4 h-4" />
            {t("settings.tabApiKeys")}
          </button>
          <button
            onClick={() => setActiveTab("language")}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition ${
              activeTab === "language"
                ? "border-emerald-500 text-emerald-400 bg-slate-800/40"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Globe className="w-4 h-4" />
            {t("settings.tabLanguage")}
          </button>
        </div>

        {/* Tab 0: Audio & Loopback (System Audio) */}
        {activeTab === "audio" && (
          <div className="space-y-4 text-xs">
            {/* Input Device Selection */}
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-slate-200 font-semibold flex items-center gap-2">
                  <Mic className="w-4 h-4 text-cyan-400" />
                  <span>Kullanılacak Mikrofon</span>
                </label>
                <button
                  onClick={fetchAudioDevices}
                  disabled={isLoadingDevices}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium flex items-center gap-1.5 transition"
                  title="Ses aygıtlarını yeniden tara"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${isLoadingDevices ? "animate-spin" : ""}`}
                  />
                  <span>Yenile</span>
                </button>
              </div>

              <select
                value={selectedAudioDevice}
                onChange={(e) => handleDeviceChange(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-cyan-500 font-medium"
              >
                <option value="default">
                  🎙️ Varsayılan Mikrofon (Otomatik {osLabel} Seçimi)
                </option>
                {(audioDevices || []).map((dev) => (
                  <option key={dev.name} value={dev.name}>
                    {dev.is_loopback ? "🔊 [Sistem Sesi / Loopback] " : "🎙️ "}
                    {dev.name} {dev.is_default ? `(Varsayılan ${osLabel})` : ""}
                  </option>
                ))}
              </select>

              {/* Live Signal VU Meter */}
              <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Canlı Ses Seviyesi (VU Metre):</span>
                  </span>
                  <span
                    className={`font-semibold ${isSpeaking ? "text-emerald-400" : "text-slate-400"}`}
                  >
                    {isSpeaking
                      ? "🟢 Konuşma Algılandı"
                      : "⚪ Sessiz / Bekleniyor"}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 via-emerald-400 to-amber-400 rounded-full transition-all duration-100"
                    style={{
                      width: `${Math.min(100, Math.max(4, liveMicLevel * 100))}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Örnekleme: 16.000 Hz Mono (Whisper Optimize)</span>
                  <span>Filtre: 80Hz High-Pass + Gürültü Kapısı</span>
                </div>
              </div>
            </div>

            {/* Dynamic System Audio & Loopback Status Card */}
            {(() => {
              const selectedDev = (audioDevices || []).find(
                (d) => d.name === selectedAudioDevice,
              );
              const isLoopbackActive = selectedDev?.is_loopback ?? false;
              const hasAnyLoopback = (audioDevices || []).some(
                (d) => d.is_loopback,
              );

              return (
                <div className="p-4 rounded-xl bg-gradient-to-b from-slate-900/90 to-slate-950/80 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className={`p-1.5 rounded-lg border ${
                          isLoopbackActive
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                            : "bg-cyan-500/10 border-cyan-500/20 text-cyan-400"
                        }`}
                      >
                        {isLoopbackActive ? (
                          <Volume2 className="w-4 h-4" />
                        ) : (
                          <Mic className="w-4 h-4" />
                        )}
                      </div>
                      <div>
                        <h4 className="font-semibold text-white text-xs">
                          {isLoopbackActive
                            ? "Sistem Sesi + Mikrofon (Çift Yönlü Kayıt Aktif)"
                            : "Mikrofon Ses Kaydı"}
                        </h4>
                        <p className="text-[10px] text-slate-400">
                          {isLoopbackActive
                            ? "Sanal ses döngüsü (Loopback) devrede; karşı tarafın konuşmaları net kaydediliyor."
                            : "Şu an doğrudan mikrofon girişiniz dinleniyor."}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full font-medium text-[10px] flex items-center gap-1.5 ${
                        isLoopbackActive
                          ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                          : "bg-amber-500/10 border border-amber-500/20 text-amber-400"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isLoopbackActive ? "bg-emerald-400" : "bg-amber-400"
                        }`}
                      />
                      {isLoopbackActive
                        ? "Loopback Aktif"
                        : "Sadece Mikrofon"}
                    </span>
                  </div>

                  {!isLoopbackActive && (
                    <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/20 text-amber-300 text-[11px] space-y-1.5 leading-relaxed">
                      <p className="font-medium text-amber-200 flex items-center gap-1.5">
                        <span>💡</span> Toplantıda Karşı Tarafın Sesini Kaydetme İpucu:
                      </p>
                      <p className="text-[10.5px] text-amber-300/90">
                        Kulaklık kullandığınızda bilgisayarınızdan çalan diğer katılımcıların sesi standart mikrofona ulaşmaz. Karşı tarafın sesini de doğrudan yazıya dökmek için <strong>BlackHole (macOS)</strong>, <strong>VB-Cable</strong> veya <strong>Stereo Mix</strong> sanal aygıtını seçebilirsiniz.
                      </p>
                      {hasAnyLoopback && (
                        <p className="text-[10px] text-emerald-300 font-semibold pt-0.5">
                          ✓ Sisteminizde sanal ses aygıtı bulundu! Yukarıdaki listeden Loopback aygıtını seçebilirsiniz.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 pt-1">
                    <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center gap-2">
                      <Mic className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span>Sizin Sesiniz: Aktif Giriş</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center gap-2">
                      <Volume2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span>
                        {isLoopbackActive
                          ? "Sistem Sesi: Loopback Devrede"
                          : "Sistem Sesi: Hoparlör/Ortam"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Tab 1: System Info & Privacy */}
        {activeTab === "system" && (
          <div className="space-y-4 text-xs">
            {/* Privacy Mode Profiles Selector */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span className="text-white font-semibold text-xs">
                    {t("privacyModes.title") || "Gizlilik ve Güvenlik Profili"}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400">
                  {t("privacyModes.subtitle") ||
                    "Tek tıkla veri izolasyon seviyesini belirleyin"}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
                {/* 1. Paranoid Mode */}
                <div
                  onClick={() => setPrivacyMode("paranoid")}
                  data-testid="settings-privacy-paranoid"
                  className={`p-3 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between gap-2 ${
                    isParanoid
                      ? "bg-purple-950/40 border-purple-500 shadow-md shadow-purple-950/40 text-white"
                      : "bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-300"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 text-purple-400" />
                        <span className="font-bold text-xs">
                          {t("privacyModes.paranoid.name") || "Paranoid Mod"}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        Air-Gapped
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      {t("privacyModes.paranoid.desc") ||
                        "Sıfır Bulut. Yalnızca yerel modeller ve ultra katı DLP."}
                    </p>
                  </div>
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[9px] font-medium text-purple-300/80">
                    <span>
                      {t("privacyModes.paranoid.features") ||
                        "%100 Çevrimdışı • Ağ İzolasyonu"}
                    </span>
                    {isParanoid && (
                      <Check className="w-3.5 h-3.5 text-purple-400" />
                    )}
                  </div>
                </div>

                {/* 2. Balanced Mode */}
                <div
                  onClick={() => setPrivacyMode("balanced")}
                  data-testid="settings-privacy-balanced"
                  className={`p-3 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between gap-2 ${
                    isBalanced
                      ? "bg-emerald-950/40 border-emerald-500 shadow-md shadow-emerald-950/40 text-white"
                      : "bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-300"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        <span className="font-bold text-xs">
                          {t("privacyModes.balanced.name") || "Dengeli Mod"}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Önerilen
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      {t("privacyModes.balanced.desc") ||
                        "Yerel öncelikli. Bulut sadece DLP maskelemesi sonrası."}
                    </p>
                  </div>
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[9px] font-medium text-emerald-300/80">
                    <span>
                      {t("privacyModes.balanced.features") ||
                        "Yerel Öncelikli • DLP BYOK"}
                    </span>
                    {isBalanced && (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                  </div>
                </div>

                {/* 3. Max Intelligence Mode */}
                <div
                  onClick={() => setPrivacyMode("max_intelligence")}
                  data-testid="settings-privacy-max"
                  className={`p-3 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between gap-2 ${
                    isMaxIntelligence
                      ? "bg-cyan-950/40 border-cyan-500 shadow-md shadow-cyan-950/40 text-white"
                      : "bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-300"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-4 h-4 text-cyan-400" />
                        <span className="font-bold text-xs">
                          {t("privacyModes.maxIntelligence.name") ||
                            "Maksimum Zeka"}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        Yüksek Hız
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      {t("privacyModes.maxIntelligence.desc") ||
                        "En iyi modeller serbest. Zorunlu DLP denetimi."}
                    </p>
                  </div>
                  <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[9px] font-medium text-cyan-300/80">
                    <span>
                      {t("privacyModes.maxIntelligence.features") ||
                        "Gemini / GPT-4o • Zorunlu DLP"}
                    </span>
                    {isMaxIntelligence && (
                      <Check className="w-3.5 h-3.5 text-cyan-400" />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Hardware summary */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <Cpu className="w-4 h-4 text-cyan-400" /> Bilgisayar
                  İşlemcisi:
                </span>
                <span className="text-slate-200 font-semibold">
                  {hardware ? hardware.cpu_brand : "Tespit Ediliyor..."}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <Zap className="w-4 h-4 text-amber-400" /> Grafik &
                  Hızlandırma:
                </span>
                <span className="text-emerald-400 font-medium">
                  {hardware?.metal_supported
                    ? "Apple Silicon Hızlandırması Aktif"
                    : hardware?.gpu_name || "Standart"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <HardDrive className="w-4 h-4 text-indigo-400" /> Sistem
                  Belleği (RAM):
                </span>
                <span className="text-slate-200 font-semibold">
                  {hardware ? `${hardware.total_ram_gb} GB` : "-"}
                </span>
              </div>
            </div>

            {/* Privacy Guarantee Card */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />{" "}
                  Çevrimdışı Gizlilik Modu:
                </span>
                <span className="text-emerald-400 font-medium">
                  %100 Cihazınızda Gizli
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Veri Güvenliği:</span>
                <span className="text-slate-200">
                  Sesleriniz ve toplantılarınız asla dışarı gönderilmez.
                </span>
              </div>
              {modelStatus && (
                <div className="flex items-center justify-between text-slate-400">
                  <span>Yapay Zeka Durumu:</span>
                  <span className="text-slate-200">
                    {modelStatus.is_loaded
                      ? "Kullanıma Hazır"
                      : "İhtiyaç Anında Açılır"}
                  </span>
                </div>
              )}
            </div>

            {/* Cloud Privacy Confirmation Preference Toggle */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <div>
                <label className="text-slate-200 font-medium flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-400" /> Bulut
                  İşlemlerinde Gizlilik Uyarısı Göster
                </label>
                <p className="text-slate-400 text-[11px] mt-0.5">
                  Hızlı bulut seçeneği kullanıldığında, ses kaydınızın internet
                  üzerinden yapay zeka sunucusuna gideceğini işlem öncesinde
                  hatırlatır.
                </p>
              </div>
              <input
                type="checkbox"
                checked={askCloudConfirm}
                onChange={(e) => setAskCloudConfirm(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-cyan-600 focus:ring-0 cursor-pointer"
              />
            </div>

            {/* Automatic Meeting Detection Settings Card */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-cyan-500/30 space-y-3 shadow-inner">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-white font-semibold flex items-center gap-2 text-xs">
                    <Radio className="w-4 h-4 text-cyan-400" />
                    {t("detector.settingsTitle")}
                  </label>
                  <p className="text-slate-400 text-[11px] mt-0.5">
                    {t("detector.settingsDesc")}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={detectorSettings.enabled}
                  onChange={(e) =>
                    handleUpdateDetector({ enabled: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-cyan-600 focus:ring-0 cursor-pointer"
                />
              </div>

              {detectorSettings.enabled && (
                <div className="pt-2 border-t border-slate-800/80 space-y-2.5 pl-1">
                  {/* Auto-Start Toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-slate-200 font-medium text-[11px] flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        {t("detector.autoStartToggle")}
                      </span>
                      <p className="text-slate-400 text-[10px]">
                        {t("detector.autoStartToggleDesc")}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={detectorSettings.auto_start_record}
                      onChange={(e) =>
                        handleUpdateDetector({
                          auto_start_record: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-cyan-600 focus:ring-0 cursor-pointer"
                    />
                  </div>

                  {/* Auto-Stop Toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-slate-200 font-medium text-[11px] flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-rose-400" />
                        {t("detector.autoStopToggle")}
                      </span>
                      <p className="text-slate-400 text-[10px]">
                        {t("detector.autoStopToggleDesc")}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={detectorSettings.auto_stop_on_app_close}
                      onChange={(e) =>
                        handleUpdateDetector({
                          auto_stop_on_app_close: e.target.checked,
                        })
                      }
                      className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-cyan-600 focus:ring-0 cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Audio Engine Info */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <Mic className="w-4 h-4 text-purple-400" /> Akıllı Ses
                  İyileştirme:
                </span>
                <span className="text-emerald-400 font-medium">
                  Otomatik Gürültü Temizleme Aktif
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Ses Kalitesi:</span>
                <span className="text-slate-200">
                  Kristal Netliğinde Stüdyo Sesi
                </span>
              </div>
            </div>

            {/* Software Updates Section */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-cyan-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-white flex items-center gap-1.5 font-semibold text-xs">
                  <Sparkles className="w-4 h-4 text-cyan-400" />
                  {t("updater.checkNowButton") || "Uygulama Güncellemeleri"}
                </span>
                <span className="text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-bold">
                  v0.2.2
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800/80">
                <div>
                  <span className="text-slate-200 font-medium block">
                    {t("updater.autoCheckToggle") ||
                      "Açılışta Güncellemeleri Otomatik Denetle"}
                  </span>
                  <span className="text-slate-400 text-[10px]">
                    {t("updater.autoCheckToggleDesc") ||
                      "Yeni bir EchoMind sürümü yayınlandığında açılışta bilgilendirir."}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={autoCheckUpdates}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setAutoCheckUpdates(val);
                    localStorage.setItem(
                      "echomind_auto_check_updates",
                      val ? "true" : "false",
                    );
                  }}
                  className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/50 w-4 h-4 cursor-pointer"
                  data-testid="settings-auto-update-toggle"
                />
              </div>

              {/* Check for Updates Action & Feedback */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <div>
                  {updateStatus.state === "upToDate" && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                      <Check className="w-3.5 h-3.5" />
                      {t("updater.upToDateDesc", {
                        version: updateStatus.version || "v0.2.2",
                      }) || "EchoMind güncel (v0.2.2)."}
                    </span>
                  )}
                  {updateStatus.state === "updateAvailable" && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-cyan-300 font-bold animate-pulse">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      {t("updater.updateAvailable", {
                        version: updateStatus.version || "",
                      }) || `Yeni sürüm mevcut (v${updateStatus.version})`}
                    </span>
                  )}
                  {updateStatus.state === "error" && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {updateStatus.message ||
                        t("updater.updateError") ||
                        "Güncelleme denetlenemedi."}
                    </span>
                  )}
                  {updateStatus.state === "idle" && (
                    <span className="text-[10px] text-slate-500">
                      GitHub Releases üzerinden kontrol edilir.
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleCheckUpdates}
                  disabled={updateStatus.state === "checking"}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 hover:border-cyan-500/50 text-[11px] font-medium transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  data-testid="settings-check-updates-btn"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      updateStatus.state === "checking"
                        ? "animate-spin text-cyan-400"
                        : "text-slate-400"
                    }`}
                  />
                  <span>
                    {updateStatus.state === "checking"
                      ? t("updater.checking") || "Denetleniyor..."
                      : t("updater.checkNowButton") || "Güncellemeleri Denetle"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: API Keys & Model Versions */}
        {activeTab === "apiKeys" && (
          <div className="space-y-4 text-xs">
            {/* Custom Local LLM / Ollama Server */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-purple-500/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-white flex items-center gap-1.5">
                  <Server className="w-4 h-4 text-purple-400" /> Özel Yerel LLM
                  Sunucusu (Ollama / vLLM / LM Studio)
                </label>
                <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded font-medium">
                  %100 Yerel & Çevrimdışı
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Kendi bilgisayarınızda veya yerel ağınızda barındırdığınız
                Ollama veya OpenAI uyumlu yerel LLM sunucu adresini
                bağlayabilirsiniz.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 font-medium">
                    Sunucu API Endpoint URL:
                  </span>
                  <input
                    type="text"
                    value={ollamaEndpoint}
                    onChange={(e) => {
                      const val = e.target.value;
                      setOllamaEndpoint(val);
                      localStorage.setItem(
                        "echomind_ollama_endpoint",
                        val.trim(),
                      );
                    }}
                    placeholder="http://127.0.0.1:11434"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-400 font-medium">
                    Model Adı:
                  </span>
                  <input
                    type="text"
                    value={ollamaModel}
                    onChange={(e) => {
                      const val = e.target.value;
                      setOllamaModel(val);
                      localStorage.setItem("echomind_ollama_model", val.trim());
                    }}
                    placeholder="llama3.2, qwen2.5:7b, mistral..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              {/* Test Connection Button & Status */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={testOllamaServer}
                  disabled={ollamaTestStatus.state === "testing"}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 text-purple-200 font-medium text-[11px] transition active:scale-95 disabled:opacity-50"
                >
                  {ollamaTestStatus.state === "testing" ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-300" />
                      Sunucu Test Ediliyor...
                    </>
                  ) : (
                    <>
                      <Activity className="w-3.5 h-3.5 text-purple-400" />
                      Sunucu Bağlantısını Test Et
                    </>
                  )}
                </button>
              </div>

              {ollamaTestStatus.state === "success" && (
                <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center gap-1.5 animate-in fade-in">
                  <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                  <span>{ollamaTestStatus.message}</span>
                </div>
              )}

              {ollamaTestStatus.state === "error" && (
                <div className="p-2 rounded-lg bg-red-950/40 border border-red-500/30 text-[11px] text-red-300 flex items-center gap-1.5 animate-in fade-in">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400" />
                  <span>{ollamaTestStatus.message}</span>
                </div>
              )}
            </div>

            {/* Groq Cloud */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-white flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-amber-400" /> Groq (Yıldırım Hızı
                  - 10 Saniyede)
                </label>
                <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded">
                  Ücretsiz & Ultra Hızlı
                </span>
              </div>
              <div className="relative">
                <input
                  type={showKeys["groq"] ? "text" : "password"}
                  value={groqKey}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGroqKey(val);
                  }}
                  placeholder="gsk_..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 pr-10 focus:outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={() => toggleShowKey("groq")}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                >
                  {showKeys["groq"] ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Version Select */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">
                    Tercih Edilen Model:
                  </span>
                  <select
                    value={groqModel}
                    onChange={(e) => setGroqModel(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    {GROQ_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                {groqModel === "custom" && (
                  <div className="flex items-center gap-2">
                    <Edit3 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <input
                      type="text"
                      value={customGroq}
                      onChange={(e) => setCustomGroq(e.target.value)}
                      placeholder="Model adı yazın (örn: whisper-large-v3-turbo)"
                      className="flex-1 px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none font-mono"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Google Gemini */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-white flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-cyan-400" /> Google Gemini
                  (Flash & Pro Ailesi)
                </label>
                <span className="text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded">
                  Üst Düzey Zeka
                </span>
              </div>
              <div className="relative">
                <input
                  type={showKeys["gemini"] ? "text" : "password"}
                  value={geminiKey}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGeminiKey(val);
                  }}
                  placeholder="AIzaSy..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 pr-10 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  onClick={() => toggleShowKey("gemini")}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                >
                  {showKeys["gemini"] ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Version Select */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">
                    Tercih Edilen Model:
                  </span>
                  <select
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    {GEMINI_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                {geminiModel === "custom" && (
                  <div className="flex items-center gap-2">
                    <Edit3 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <input
                      type="text"
                      value={customGemini}
                      onChange={(e) => setCustomGemini(e.target.value)}
                      placeholder="Model adı yazın (örn: gemini-2.0-flash)"
                      className="flex-1 px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none font-mono"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* OpenAI */}
            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-white flex items-center gap-1.5">
                  <Cpu className="w-4 h-4 text-emerald-400" /> OpenAI (Whisper &
                  GPT-4o Audio)
                </label>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                  Küresel Standart
                </span>
              </div>
              <div className="relative">
                <input
                  type={showKeys["openai"] ? "text" : "password"}
                  value={openaiKey}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    const val = e.target.value;
                    setOpenaiKey(val);
                  }}
                  placeholder="sk-proj-..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 pr-10 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => toggleShowKey("openai")}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
                >
                  {showKeys["openai"] ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Version Select */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">
                    Tercih Edilen Model:
                  </span>
                  <select
                    value={openaiModel}
                    onChange={(e) => setOpenaiModel(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    {OPENAI_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                {openaiModel === "custom" && (
                  <div className="flex items-center gap-2">
                    <Edit3 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <input
                      type="text"
                      value={customOpenai}
                      onChange={(e) => setCustomOpenai(e.target.value)}
                      placeholder="Model adı yazın (örn: whisper-1)"
                      className="flex-1 px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white focus:outline-none font-mono"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Save Buttons */}
            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-slate-400">
                * Anahtarlarınız ve tercihleriniz cihazınızda anında güvenle
                saklanır.
              </span>
              <button
                onClick={handleSaveKeys}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs shadow-md shadow-cyan-600/20 transition active:scale-95"
              >
                {savedSuccess ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-300" />
                    {t("common.saved")}
                  </>
                ) : (
                  t("common.save")
                )}
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Language Selection */}
        {activeTab === "language" && (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
              <label className="text-slate-200 font-semibold flex items-center gap-2">
                <Globe className="w-4 h-4 text-emerald-400" />
                <span>{t("settings.tabLanguage")}</span>
              </label>
              <p className="text-slate-400 text-xs leading-relaxed">
                EchoMind arayüzünde kullanmak istediğiniz dili seçin. Tüm
                menüler, butonlar ve rapor şablonları bu dilde
                görüntülenecektir.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => setLanguage(lang.code)}
                    className={`p-3.5 rounded-xl border text-left transition flex items-center justify-between ${
                      language === lang.code
                        ? "bg-emerald-500/15 border-emerald-500/60 text-emerald-200 shadow-md shadow-emerald-950/30"
                        : "bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{lang.flag}</span>
                      <div>
                        <div className="font-semibold text-white text-xs">
                          {lang.nativeName}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {lang.name}
                        </div>
                      </div>
                    </div>
                    {language === lang.code && (
                      <div className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-xs">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{t("settings.privacyDesc")}</span>
          </div>
          <button
            onClick={handleCloseAndSave}
            className="px-4 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
};
