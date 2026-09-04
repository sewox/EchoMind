import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Mic,
  Square,
  Settings,
  ShieldCheck,
  Sparkles,
  Bookmark,
  Calendar,
  Clock,
  Trash2,
  Save,
  Plus,
  Upload,
  Loader2,
  CheckCircle2,
  X,
  Search,
  Edit2,
  Check,
  Layers,
  Zap,
} from "lucide-react";
import {
  TranscriptViewer,
  TranscriptSegment,
} from "./components/TranscriptViewer";
import { SettingsModal } from "./components/SettingsModal";
import { ModelHubModal } from "./components/ModelHubModal";
import {
  SmartAdvisorModal,
  PickedFileInfo,
} from "./components/SmartAdvisorModal";
import { CloudPrivacyConfirmModal } from "./components/CloudPrivacyConfirmModal";
import { DeleteConfirmModal } from "./components/DeleteConfirmModal";
import { GlobalAssistantModal } from "./components/GlobalAssistantModal";
import { CustomContextMenu } from "./components/CustomContextMenu";
import { EchoMindLogo } from "./components/EchoMindLogo";
import { useI18n, SUPPORTED_LANGUAGES } from "./locales/i18nContext";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useMeetingManager } from "./hooks/useMeetingManager";
import { useMeetingDetector, MeetingAppInfo } from "./hooks/useMeetingDetector";

export interface HardwareInfo {
  os_name: string;
  os_version: string;
  cpu_brand: string;
  cpu_cores: number;
  total_ram_gb: number;
  gpu_name: string;
  metal_supported: boolean;
  cuda_supported: boolean;
  avx2_supported: boolean;
}

export interface AudioStatus {
  is_recording: boolean;
  mic_level: number;
  sys_level: number;
  is_speaking: boolean;
  sample_rate: number;
  channels: number;
  buffered_samples: number;
}

export interface ModelStatus {
  model_name: string;
  is_loaded: boolean;
  is_downloading: boolean;
  download_progress: number;
  hardware_acceleration: string;
}

export interface ActionItem {
  task: string;
  assignee?: string;
  source_citations?: number[];
  is_completed?: boolean;
}

export interface TopicBreakdown {
  topic_title: string;
  bullet_points: string[];
}

export interface MeetingRecord {
  id: string;
  title: string;
  date_formatted: string;
  duration_seconds: number;
  duration_formatted: string;
  audio_file_path?: string;
  segments: TranscriptSegment[];
  summary: string;
  key_decisions: string[];
  meeting_goal?: string;
  key_highlights?: string[];
  action_items?: ActionItem[];
  phase1_agreed?: string[];
  phase2_deferred?: string[];
  detailed_topics?: TopicBreakdown[];
  participants?: string[];
  engine_used?: string;
  summary_provider?: string;
}

export function App() {
  const { t, language, setLanguage } = useI18n();
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("auto");
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isModelHubOpen, setIsModelHubOpen] = useState<boolean>(false);

  // Audio Recording Hook
  const { isRecording, recordingSeconds, audioStatus, setIsRecording } =
    useAudioRecording();

  // Meeting Manager Hook
  const {
    pastMeetings,
    selectedMeeting,
    setSelectedMeeting,
    isLoadingMeeting,
    setIsLoadingMeeting,
    searchQuery,
    setSearchQuery,
    editingMeetingId,
    editingTitleText,
    setEditingTitleText,
    filteredMeetings,
    fetchPastMeetings,
    meetingToDelete,
    handlePromptDeleteMeeting,
    handleConfirmDelete,
    handleCancelDelete,
    handleStartEditMeetingTitle,
    handleSaveMeetingTitle,
    handleCancelEditMeetingTitle,
  } = useMeetingManager();

  const [meetingTitleInput, setMeetingTitleInput] = useState<string>("");

  // Import audio processing state
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [processingStatusText, setProcessingStatusText] = useState<
    string | null
  >(null);
  const [isAdvisorOpen, setIsAdvisorOpen] = useState<boolean>(false);
  const [advisorFileInfo, setAdvisorFileInfo] = useState<PickedFileInfo | null>(
    null,
  );

  // Cloud Privacy Confirmation Modal
  const [privacyModalState, setPrivacyModalState] = useState<{
    isOpen: boolean;
    providerName: string;
    onProceedCloud: () => void;
    onProceedLocal: () => void;
  }>({
    isOpen: false,
    providerName: "Bulut Yapay Zeka",
    onProceedCloud: () => {},
    onProceedLocal: () => {},
  });

  // Global Multi-Meeting AI Assistant state
  const [isGlobalAssistantOpen, setIsGlobalAssistantOpen] =
    useState<boolean>(false);

  // Global ⌘K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsGlobalAssistantOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Completion notification banner state (Steve Jobs style: simple, sleek, duration-only)
  const [completionNotification, setCompletionNotification] = useState<{
    title: string;
    durationFormatted?: string;
    elapsedFormatted: string;
  } | null>(null);

  // Auto-dismiss completion notification after 6 seconds
  useEffect(() => {
    if (completionNotification) {
      const timer = setTimeout(() => {
        setCompletionNotification(null);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [completionNotification]);

  const formatElapsed = (sec: number) => {
    if (sec < 60) {
      return `${sec} saniyede`;
    }
    const mins = Math.floor(sec / 60);
    const remSec = sec % 60;
    if (remSec === 0) {
      return `${mins} dakikada`;
    }
    return `${mins} dakika ${remSec} saniyede`;
  };

  // Auto-Start and Auto-Stop handlers for Meeting Detector
  const handleAutoStartMeeting = useCallback(
    async (app: MeetingAppInfo) => {
      if (!isRecording) {
        setSelectedMeeting(null);
        setMeetingTitleInput(app.recommended_title);
        const selectedDevice =
          localStorage.getItem("echomind_selected_audio_device") || undefined;
        try {
          await invoke("start_audio_capture", { deviceName: selectedDevice });
          setIsRecording(true);
        } catch (err) {
          console.error("Auto-start meeting capture failed:", err);
        }
      }
    },
    [isRecording],
  );

  const executeMeetingRetranscribe = async (
    meetingId: string,
    cloudProvider: string | null,
    apiKey: string | null,
    modelVersion?: string,
    languageToUse?: string,
  ) => {
    setIsImporting(true);
    const lang = languageToUse || selectedLanguage || "auto";

    if (cloudProvider === "gemini") {
      setProcessingStatusText(
        `⚡ Google Gemini (${modelVersion || "gemini-1.5-flash"}) ile Çözümleniyor...`,
      );
    } else if (cloudProvider === "groq") {
      setProcessingStatusText(
        `⚡ Groq Cloud (${modelVersion || "whisper-large-v3-turbo"}) ile Çözümleniyor...`,
      );
    } else if (cloudProvider === "openai") {
      setProcessingStatusText(
        `⚡ OpenAI (${modelVersion || "whisper-1"}) ile Çözümleniyor...`,
      );
    } else {
      setProcessingStatusText(
        "🔒 Cihazınızda Çevrimdışı Olarak Çözümleniyor (%100 Gizli)...",
      );
    }

    const startTime = Date.now();
    try {
      const updatedMeeting = await invoke<MeetingRecord>(
        "retranscribe_meeting",
        {
          meetingId,
          language: lang,
          cloudProvider,
          apiKey,
          modelVersion: modelVersion || null,
        },
      );
      const elapsedSec = Math.max(
        1,
        Math.round((Date.now() - startTime) / 1000),
      );
      setSelectedMeeting(updatedMeeting);
      fetchPastMeetings();
      setCompletionNotification({
        title: updatedMeeting.title || "Toplantı Başarıyla Çözümlendi",
        durationFormatted: updatedMeeting.duration_formatted,
        elapsedFormatted: formatElapsed(elapsedSec),
      });
    } catch (err) {
      console.error("Failed to retranscribe meeting:", err);
      alert(`Toplantı çözümleme hatası: ${err}`);
    } finally {
      setIsImporting(false);
      setProcessingStatusText(null);
    }
  };

  const promptMeetingTranscription = useCallback(
    (meeting: MeetingRecord) => {
      setSelectedMeeting(meeting);
      fetchPastMeetings();
      setAdvisorFileInfo({
        path: meeting.id,
        file_name: meeting.title,
        file_size_mb: Math.max(
          0.1,
          Number(
            ((meeting.duration_seconds * 16000 * 2) / (1024 * 1024)).toFixed(1),
          ),
        ),
        is_large_file: meeting.duration_seconds > 600,
      });
      setIsAdvisorOpen(true);
    },
    [fetchPastMeetings, setSelectedMeeting],
  );

  const handleSaveCurrentMeeting = useCallback(async () => {
    const startTime = Date.now();
    try {
      const newMeeting = await invoke<MeetingRecord>("save_current_meeting", {
        title: meetingTitleInput,
        durationSeconds: recordingSeconds || 1,
      });
      const elapsedSec = Math.max(
        1,
        Math.round((Date.now() - startTime) / 1000),
      );
      setMeetingTitleInput("");
      setSelectedMeeting(newMeeting);
      fetchPastMeetings();
      setCompletionNotification({
        title: newMeeting.title || "Kayıt Başarıyla Tamamlandı",
        durationFormatted: newMeeting.duration_formatted,
        elapsedFormatted: formatElapsed(elapsedSec),
      });
      // Ask user which model to transcribe with
      if (newMeeting.audio_file_path && newMeeting.segments.length === 0) {
        promptMeetingTranscription(newMeeting);
      }
    } catch (err) {
      console.error("Failed to save meeting:", err);
    }
  }, [
    meetingTitleInput,
    recordingSeconds,
    fetchPastMeetings,
    promptMeetingTranscription,
  ]);

  const handleAutoStopMeeting = useCallback(async () => {
    if (isRecording) {
      try {
        await invoke("stop_audio_capture");
        setIsRecording(false);
        await handleSaveCurrentMeeting();
      } catch (err) {
        console.error("Auto-stop meeting capture failed:", err);
      }
    }
  }, [isRecording, handleSaveCurrentMeeting]);

  useMeetingDetector({
    isRecording,
    onAutoStartMeeting: handleAutoStartMeeting,
    onAutoStopMeeting: handleAutoStopMeeting,
  });

  // Listen for recording trigger from floating island, auto-stop and meeting-saved events
  useEffect(() => {
    const unlistenStart = listen<{ title?: string }>(
      "trigger-start-recording",
      (event) => {
        setSelectedMeeting(null);
        if (event.payload?.title) {
          setMeetingTitleInput(event.payload.title);
        }
        setIsRecording(true);
      },
    );

    const unlistenStop = listen("trigger-stop-recording", async () => {
      setIsRecording(false);
      await handleSaveCurrentMeeting();
    });

    const unlistenSaved = listen<MeetingRecord>("meeting-saved", (event) => {
      setIsRecording(false);
      setMeetingTitleInput("");
      if (event.payload) {
        setSelectedMeeting(event.payload);
        fetchPastMeetings();
        setCompletionNotification({
          title: event.payload.title || "Toplantı Başarıyla Kaydedildi",
          durationFormatted: event.payload.duration_formatted,
          elapsedFormatted: "1s",
        });
        if (
          event.payload.audio_file_path &&
          event.payload.segments.length === 0
        ) {
          promptMeetingTranscription(event.payload);
        }
      }
    });

    return () => {
      unlistenStart.then((f) => f());
      unlistenStop.then((f) => f());
      unlistenSaved.then((f) => f());
    };
  }, [
    setSelectedMeeting,
    setIsRecording,
    handleSaveCurrentMeeting,
    fetchPastMeetings,
    promptMeetingTranscription,
  ]);

  // Fetch initial data
  useEffect(() => {
    invoke<HardwareInfo>("get_hardware_info")
      .then(setHardware)
      .catch((err) => console.error("Hardware info error:", err));

    invoke<ModelStatus>("get_model_status")
      .then(setModelStatus)
      .catch((err) => console.error("Model status error:", err));
  }, []);

  const handleToggleRecording = async () => {
    try {
      if (!isRecording) {
        setSelectedMeeting(null);
        const selectedDevice =
          localStorage.getItem("echomind_selected_audio_device") || undefined;
        await invoke("start_audio_capture", { deviceName: selectedDevice });
        setIsRecording(true);
      } else {
        await invoke("stop_audio_capture");
        setIsRecording(false);
        await handleSaveCurrentMeeting();
      }
    } catch (err) {
      console.error("Failed to toggle recording:", err);
    }
  };

  const handleSelectPastMeeting = (mtg: MeetingRecord) => {
    if (selectedMeeting?.id === mtg.id) return;
    setIsLoadingMeeting(true);
    // Non-blocking transition to prevent freezing
    setTimeout(() => {
      setSelectedMeeting(mtg);
      setIsLoadingMeeting(false);
    }, 40);
  };

  const executeAudioImport = async (
    filePath: string,
    cloudProvider: string | null,
    apiKey: string | null,
    modelVersion?: string,
    languageToUse?: string,
  ) => {
    setIsImporting(true);
    const lang = languageToUse || selectedLanguage || "auto";

    // Set clear visual processing status
    if (cloudProvider === "gemini") {
      setProcessingStatusText(
        `⚡ Google Gemini (${modelVersion || "gemini-1.5-flash"}) ile Bulutta Çözümleniyor...`,
      );
    } else if (cloudProvider === "groq") {
      setProcessingStatusText(
        `⚡ Groq Cloud (${modelVersion || "whisper-large-v3-turbo"}) ile Bulutta Çözümleniyor...`,
      );
    } else if (cloudProvider === "openai") {
      setProcessingStatusText(
        `⚡ OpenAI (${modelVersion || "whisper-1"}) ile Bulutta Çözümleniyor...`,
      );
    } else {
      setProcessingStatusText(
        "🔒 Cihazınızda Çevrimdışı Olarak Çözümleniyor (%100 Gizli)...",
      );
    }

    const startTime = Date.now();
    try {
      const importedMeeting = await invoke<MeetingRecord>(
        "process_audio_file_path",
        {
          filePath,
          language: lang,
          cloudProvider,
          apiKey,
          modelVersion: modelVersion || null,
        },
      );
      const elapsedSec = Math.max(
        1,
        Math.round((Date.now() - startTime) / 1000),
      );
      setSelectedMeeting(importedMeeting);
      fetchPastMeetings();
      setCompletionNotification({
        title: importedMeeting.title || "Toplantı Çözümlendi",
        durationFormatted: importedMeeting.duration_formatted,
        elapsedFormatted: formatElapsed(elapsedSec),
      });
    } catch (err) {
      console.error("Failed to import audio file:", err);
      alert(`Ses dosyası aktarma hatası: ${err}`);
    } finally {
      setIsImporting(false);
      setProcessingStatusText(null);
    }
  };

  const checkCloudPrivacyAndExecute = (
    filePath: string,
    cloudProvider: string | null,
    apiKey: string | null,
    modelVersion?: string,
    languageToUse?: string,
  ) => {
    const isCloud = cloudProvider && apiKey;
    const isSuppressed =
      localStorage.getItem("echomind_suppress_cloud_warning") === "true";

    if (isCloud && !isSuppressed) {
      const providerNameMap: Record<string, string> = {
        groq: "Groq Cloud Whisper",
        gemini: "Google Gemini",
        openai: "OpenAI Whisper",
      };
      const provName = providerNameMap[cloudProvider] || "Bulut Sağlayıcı";

      setPrivacyModalState({
        isOpen: true,
        providerName: provName,
        onProceedCloud: () => {
          setPrivacyModalState((prev) => ({ ...prev, isOpen: false }));
          executeAudioImport(
            filePath,
            cloudProvider,
            apiKey,
            modelVersion,
            languageToUse,
          );
        },
        onProceedLocal: () => {
          setPrivacyModalState((prev) => ({ ...prev, isOpen: false }));
          executeAudioImport(filePath, null, null, undefined, languageToUse);
        },
      });
      return;
    }

    executeAudioImport(
      filePath,
      cloudProvider,
      apiKey,
      modelVersion,
      languageToUse,
    );
  };

  const handleAdvisorConfirm = (
    engine: "local" | "cloud_groq" | "cloud_gemini" | "cloud_openai",
    customApiKey?: string,
    modelVersion?: string,
    language?: string,
  ) => {
    if (!advisorFileInfo) return;
    const targetPath = advisorFileInfo.path;
    setIsAdvisorOpen(false);

    if (language) {
      setSelectedLanguage(language);
    }

    let cloudProvider: string | null = null;
    let apiKey: string | null = null;

    if (engine === "cloud_groq") {
      cloudProvider = "groq";
      apiKey =
        customApiKey || localStorage.getItem("echomind_groq_key") || null;
    } else if (engine === "cloud_gemini") {
      cloudProvider = "gemini";
      apiKey =
        customApiKey || localStorage.getItem("echomind_gemini_key") || null;
    } else if (engine === "cloud_openai") {
      cloudProvider = "openai";
      apiKey =
        customApiKey || localStorage.getItem("echomind_openai_key") || null;
    }

    if (targetPath.startsWith("mtg_")) {
      executeMeetingRetranscribe(
        targetPath,
        cloudProvider,
        apiKey,
        modelVersion,
        language,
      );
    } else {
      checkCloudPrivacyAndExecute(
        targetPath,
        cloudProvider,
        apiKey,
        modelVersion,
        language,
      );
    }
  };

  const handlePickAndImportAudioFile = async () => {
    try {
      const picked = await invoke<PickedFileInfo | null>(
        "pick_audio_file_dialog",
      );
      if (!picked) return;

      const activeEngine =
        localStorage.getItem("echomind_active_engine") || "local";
      const groqKey = localStorage.getItem("echomind_groq_key") || "";
      const geminiKey = localStorage.getItem("echomind_gemini_key") || "";
      const openaiKey = localStorage.getItem("echomind_openai_key") || "";

      // If file is large (>12MB) and currently set to local mode,
      // present smart advisor recommendation
      if (picked.is_large_file || picked.file_size_mb > 12.0) {
        if (
          activeEngine === "local" ||
          (!groqKey && !geminiKey && !openaiKey)
        ) {
          setAdvisorFileInfo(picked);
          setIsAdvisorOpen(true);
          return;
        }
      }

      // If already in cloud mode with key, or small file:
      let cloudProvider: string | null = null;
      let apiKey: string | null = null;
      let modelVersion: string | undefined = undefined;

      if (activeEngine === "apple_speech") {
        cloudProvider = "apple_speech";
      } else if (activeEngine === "sensevoice") {
        cloudProvider = "sensevoice";
      } else if (activeEngine === "cloud_groq" && groqKey) {
        cloudProvider = "groq";
        apiKey = groqKey;
        modelVersion =
          localStorage.getItem("echomind_groq_model_version") ||
          "whisper-large-v3-turbo";
      } else if (activeEngine === "cloud_gemini" && geminiKey) {
        cloudProvider = "gemini";
        apiKey = geminiKey;
        modelVersion =
          localStorage.getItem("echomind_gemini_model_version") ||
          "gemini-1.5-flash";
      } else if (activeEngine === "cloud_openai" && openaiKey) {
        cloudProvider = "openai";
        apiKey = openaiKey;
        modelVersion =
          localStorage.getItem("echomind_openai_model_version") || "whisper-1";
      }

      checkCloudPrivacyAndExecute(
        picked.path,
        cloudProvider,
        apiKey,
        modelVersion,
      );
    } catch (err) {
      console.error("Failed to pick audio file:", err);
      alert(`Dosya seçme hatası: ${err}`);
    }
  };

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);
  const modKey = isMac ? "⌘" : "Ctrl+";

  return (
    <div className="h-screen w-screen bg-[#090d16] text-[#d8e3fb] flex flex-col font-sans overflow-hidden select-text relative">
      {/* Non-blocking Meeting Loader Overlay */}
      {isLoadingMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="flex items-center gap-3 px-6 py-3.5 rounded-2xl bg-slate-900/90 border border-slate-700 shadow-2xl text-white">
            <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
            <span className="text-sm font-medium">
              Toplantı Kaydı Yükleniyor...
            </span>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <header className="shrink-0 h-16 border-b border-white/10 px-8 flex items-center justify-between bg-[#090d16]/90 backdrop-blur-xl z-50">
        {/* App Logo & Title */}
        <div className="flex items-center gap-4">
          <EchoMindLogo showTagline={true} />

          {/* Status Capsule */}
          <div className="ml-4 px-3 py-1 rounded-full bg-white/5 border border-white/10 flex items-center gap-2 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                isRecording
                  ? "bg-emerald-400"
                  : isImporting
                    ? "bg-amber-400"
                    : "bg-slate-400"
              }`}
            />
            <span className="text-slate-300 font-medium">
              {isRecording
                ? `${t("nav.listening")} (${formatTimer(recordingSeconds)})`
                : isImporting
                  ? processingStatusText || t("retranscribe.processingButton")
                  : t("nav.ready")}
            </span>
          </div>
        </div>

        {/* Right Action: Language Switcher, Global Assistant, Model Hub & Settings */}
        <div className="flex items-center gap-2.5">
          {/* Language Switcher */}
          <div className="relative">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as any)}
              className="bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-full border border-slate-700/80 focus:outline-none focus:border-cyan-500/70 transition cursor-pointer shadow-sm"
              title={t("nav.language")}
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option
                  key={lang.code}
                  value={lang.code}
                  className="bg-slate-900 text-slate-200"
                >
                  {lang.flag} {lang.nativeName}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setIsGlobalAssistantOpen(true)}
            className="h-8 shrink-0 flex items-center gap-2 px-3.5 rounded-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 border border-cyan-400/30 text-xs font-semibold text-white shadow-md shadow-cyan-950/40 transition"
            title={`EchoMind AI (${modKey}K)`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>{t("nav.aiAdvisor")}</span>
            <span className="hidden lg:inline text-[10px] px-1.5 py-0.5 rounded bg-black/25 font-mono text-cyan-200">
              {modKey}K
            </span>
          </button>

          <button
            onClick={() => setIsModelHubOpen(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-xs font-medium text-cyan-300 shadow-sm transition hover:border-cyan-500/50"
            title={t("modelHub.title")}
          >
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>{t("nav.modelHub")}</span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition duration-200"
            title={t("nav.settings")}
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Floating Completion Notification Banner (Steve Jobs simplicity) */}
      {completionNotification && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-3.5 px-5 py-3 rounded-2xl bg-slate-900/95 border border-cyan-500/40 text-white shadow-2xl shadow-cyan-950/60 backdrop-blur-2xl">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-emerald-500/20 to-cyan-500/20 border border-emerald-500/40 text-emerald-300">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-cyan-200">
                  ✨ {completionNotification.title}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium">
                  {completionNotification.elapsedFormatted} tamamlandı
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {completionNotification.durationFormatted
                  ? `${completionNotification.durationFormatted} sürelik ses kaydı başarıyla yazıya dönüştürüldü.`
                  : "Toplantı notlarınız ve konuşmacı dökümünüz hazır."}
              </p>
            </div>
            <button
              onClick={() => setCompletionNotification(null)}
              className="ml-2 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Kapat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 px-4 md:px-6 2xl:px-8 py-3 w-full flex flex-col gap-3 overflow-hidden">
        {/* Hero Section (Compact when viewing past meeting, full when in live mode) */}
        {!selectedMeeting && (
          <section className="flex flex-col items-center justify-center py-2 shrink-0">
            <div className="flex items-center gap-3 mb-2">
              {/* Record Toggle Button */}
              <button
                onClick={handleToggleRecording}
                disabled={isImporting}
                className={`px-8 py-3 rounded-full font-medium text-sm md:text-base hover:scale-[0.98] transition-all duration-200 shadow-[0px_20px_40px_rgba(0,0,0,0.4)] flex items-center gap-2.5 border ${
                  isRecording
                    ? "bg-rose-600 hover:bg-rose-500 text-white border-rose-400"
                    : "bg-white text-slate-900 hover:bg-slate-100 border-white"
                }`}
              >
                {isRecording ? (
                  <>
                    <Square className="w-5 h-5 fill-white" />
                    <span>{t("nav.stopListening")}</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-5 h-5" />
                    <span>{t("nav.startListening")}</span>
                  </>
                )}
              </button>

              {/* Audio File Import Button */}
              {!isRecording && (
                <button
                  onClick={handlePickAndImportAudioFile}
                  disabled={isImporting}
                  className="px-6 py-3 rounded-full font-medium text-xs md:text-sm bg-[#152031] hover:bg-[#1f2a3c] text-slate-200 border border-white/10 shadow-md transition flex items-center gap-2 disabled:opacity-50"
                  title={t("sidebar.importAudio")}
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                      <span>{t("sidebar.importing")}</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 text-cyan-400" />
                      <span>{t("sidebar.importAudio")}</span>
                    </>
                  )}
                </button>
              )}

              {/* Save Meeting Action when stopped */}
              {!isRecording && recordingSeconds > 0 && (
                <button
                  onClick={handleSaveCurrentMeeting}
                  className="px-5 py-3 rounded-full font-medium text-xs md:text-sm bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400 shadow-md transition flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  <span>{t("common.save")}</span>
                </button>
              )}
            </div>

            {/* Waveform Animation */}
            <div className="wave-container !h-[36px]">
              {Array.from({ length: 19 }).map((_, i) => (
                <div
                  key={i}
                  className="wave-bar"
                  style={{
                    animationPlayState:
                      isRecording || isImporting ? "running" : "paused",
                    height: isRecording || isImporting ? undefined : "8px",
                    opacity: isRecording || isImporting ? 0.9 : 0.2,
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* Fluid Responsive Workspace: Left Sidebar + Right Main Workspace */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4 2xl:gap-6 overflow-hidden">
          {/* Left Column: Geçmiş Toplantılar (Responsive Sidebar) */}
          <div className="bento-card w-full md:w-80 lg:w-88 2xl:w-96 shrink-0 p-4 2xl:p-5 flex flex-col gap-3.5 overflow-hidden h-full">
            {/* Header & Add */}
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h2 className="font-semibold text-xs md:text-sm 2xl:text-base text-white flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-slate-400" />
                {t("sidebar.title")} ({filteredMeetings.length})
              </h2>
              <button
                onClick={() => setSelectedMeeting(null)}
                className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
                title={t("sidebar.liveSession")}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* AI Assistant Quick Trigger */}
            <button
              onClick={() => setIsGlobalAssistantOpen(true)}
              className="w-full px-3 py-2 rounded-xl bg-gradient-to-r from-cyan-950/60 to-blue-950/60 hover:from-cyan-900/60 hover:to-blue-900/60 border border-cyan-500/30 hover:border-cyan-500/50 text-xs text-cyan-200 font-medium transition flex items-center justify-between group shadow-sm"
              title={t("assistant.subtitle")}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 group-hover:scale-110 transition" />
                <span>{t("assistant.title")}</span>
              </div>
              <span className="text-[10px] text-cyan-400/80 font-mono bg-cyan-900/40 px-1.5 py-0.5 rounded border border-cyan-500/20">
                ⌘K
              </span>
            </button>

            {/* Real-time Search Box */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("sidebar.searchPlaceholder")}
                className="w-full pl-8 pr-7 py-1.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs 2xl:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/70"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Meetings List */}
            <div className="space-y-2.5 overflow-y-auto flex-1 pr-1">
              {filteredMeetings.length === 0 ? (
                <div className="text-center py-10 text-slate-500 text-xs border border-dashed border-white/10 rounded-xl p-4">
                  {searchQuery
                    ? t("sidebar.noSearchResults")
                    : t("sidebar.noMeetings")}
                </div>
              ) : (
                filteredMeetings.map((mtg) => (
                  <div
                    key={mtg.id}
                    onClick={() => handleSelectPastMeeting(mtg)}
                    className={`p-3.5 rounded-xl transition cursor-pointer border group ${
                      selectedMeeting?.id === mtg.id
                        ? "bg-[#1f2a3c] border-cyan-500/50 shadow-md shadow-cyan-950/30"
                        : "bg-[#152031] border-white/5 hover:border-white/20"
                    }`}
                  >
                    {/* Title & Actions */}
                    <div className="flex items-center justify-between text-xs 2xl:text-sm mb-1.5">
                      {editingMeetingId === mtg.id ? (
                        <div
                          className="flex items-center gap-1.5 w-full"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={editingTitleText}
                            onChange={(e) =>
                              setEditingTitleText(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                handleSaveMeetingTitle(mtg.id);
                              if (e.key === "Escape")
                                handleCancelEditMeetingTitle();
                            }}
                            autoFocus
                            className="flex-1 bg-slate-900 border border-cyan-500 rounded-lg px-2 py-0.5 text-xs text-white focus:outline-none"
                          />
                          <button
                            onClick={(e) => handleSaveMeetingTitle(mtg.id, e)}
                            className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400"
                            title="Kaydet"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={handleCancelEditMeetingTitle}
                            className="p-1 rounded hover:bg-slate-700 text-slate-400"
                            title="Vazgeç"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="font-semibold text-white truncate group-hover:text-cyan-300 transition">
                            {mtg.title}
                          </span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                            <button
                              onClick={(e) =>
                                handleStartEditMeetingTitle(mtg, e)
                              }
                              className="p-1 text-slate-400 hover:text-cyan-300 transition"
                              title="İsmi Düzenle"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => handlePromptDeleteMeeting(mtg, e)}
                              className="p-1 text-slate-400 hover:text-rose-400 transition"
                              title="Toplantıyı Sil"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[11px] 2xl:text-xs text-slate-400 font-mono">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        {mtg.date_formatted}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {mtg.duration_formatted}
                      </span>
                    </div>

                    {/* Model & Summary Badge */}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-950/80 border border-slate-800 text-[10px] 2xl:text-xs text-cyan-300 font-mono">
                        {mtg.engine_used?.startsWith("⚡") ? (
                          <Zap className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                        ) : (
                          <ShieldCheck className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                        )}
                        <span className="truncate max-w-[180px]">
                          {mtg.engine_used || "🔒 Cihazda (Whisper Small)"}
                        </span>
                      </span>
                    </div>

                    {mtg.summary && (
                      <p className="text-[11px] 2xl:text-xs text-slate-400 line-clamp-2 mt-2 leading-relaxed">
                        {mtg.summary}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Column: Main Transcript & Summary View */}
          <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
            <TranscriptViewer
              isRecording={isRecording}
              isSpeaking={audioStatus?.is_speaking || false}
              selectedLanguage={selectedLanguage}
              onLanguageChange={setSelectedLanguage}
              selectedPastMeeting={selectedMeeting}
              onReturnToLiveSession={() => setSelectedMeeting(null)}
              onMeetingUpdated={(m) => {
                setSelectedMeeting(m);
                fetchPastMeetings();
              }}
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="shrink-0 border-t border-white/10 px-8 py-3 text-center text-xs text-slate-400 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>
            Gizlilik Öncelikli • %100 Cihazınızda Güvende • Tüm Ses & Video
            Formatlarını Destekler
          </span>
        </div>
        <button
          onClick={() => setIsModelHubOpen(true)}
          className="text-[11px] text-slate-400 hover:text-cyan-300 flex items-center gap-1.5 transition px-2.5 py-1 rounded-lg hover:bg-slate-800"
          title="Yapay Zeka Modunu Değiştir"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>Yapay Zeka Seçenekleri</span>
        </button>
      </footer>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        hardware={hardware}
        modelStatus={modelStatus}
      />

      {/* Model Hub Modal */}
      <ModelHubModal
        isOpen={isModelHubOpen}
        onClose={() => setIsModelHubOpen(false)}
        onModelChanged={() => {
          invoke<ModelStatus>("get_model_status")
            .then(setModelStatus)
            .catch(console.error);
        }}
      />

      {/* Smart Processing Advisor Modal */}
      <SmartAdvisorModal
        isOpen={isAdvisorOpen}
        fileInfo={advisorFileInfo}
        onConfirm={handleAdvisorConfirm}
        onClose={() => {
          setIsAdvisorOpen(false);
          setAdvisorFileInfo(null);
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Cloud Privacy Confirmation Modal */}
      <CloudPrivacyConfirmModal
        isOpen={privacyModalState.isOpen}
        providerName={privacyModalState.providerName}
        onConfirmCloud={privacyModalState.onProceedCloud}
        onSwitchToLocal={privacyModalState.onProceedLocal}
        onClose={() =>
          setPrivacyModalState((prev) => ({ ...prev, isOpen: false }))
        }
      />

      {/* Delete Meeting Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={!!meetingToDelete}
        meeting={meetingToDelete}
        onConfirm={handleConfirmDelete}
        onClose={handleCancelDelete}
      />

      {/* Global Multi-Meeting AI Assistant & Cross-Meeting RAG Search Modal */}
      <GlobalAssistantModal
        isOpen={isGlobalAssistantOpen}
        onClose={() => setIsGlobalAssistantOpen(false)}
        onSelectMeeting={(meetingId) => {
          const target = pastMeetings.find((m) => m.id === meetingId);
          if (target) {
            handleSelectPastMeeting(target);
          }
        }}
      />

      {/* Modern Desktop Custom Context Menu */}
      <CustomContextMenu
        onOpenAssistant={() => setIsGlobalAssistantOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
    </div>
  );
}

export default App;
