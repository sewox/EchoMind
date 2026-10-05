import React, { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  MessageSquare,
  Trash2,
  Download,
  Copy,
  Check,
  Search,
  Play,
  Wand2,
  ArrowLeft,
  Sparkles,
  CheckSquare,
  Loader2,
  RotateCw,
  BarChart3,
  AlertTriangle,
  Mail,
  X,
} from "lucide-react";
import { MeetingRecord, ActionItem, TopicBreakdown } from "../App";
import { ExportModal } from "./ExportModal";
import { FollowUpModal } from "./FollowUpModal";
import { RetranscribeModal } from "./RetranscribeModal";
import { AudioPlayerBar } from "./transcript/AudioPlayerBar";
import { TasksDecisionsView } from "./transcript/TasksDecisionsView";
import { SummaryCardsView } from "./transcript/SummaryCardsView";
import { LocalLlmHint } from "./LocalLlmSection";
import { LiveFeedView } from "./transcript/LiveFeedView";
import { CustomTemplateModal } from "./transcript/CustomTemplateModal";
import { MeetingAnalyticsModal } from "./transcript/MeetingAnalyticsModal";
import { MeetingTemplate, BUILTIN_TEMPLATES } from "../types/templates";
import { MeetingAnalytics } from "../types/analytics";
import { CredentialStore } from "../services/credentialStore";
import { SoundbiteResult } from "../types/soundbite";
import { Tooltip } from "./ui/Tooltip";
import { useI18n } from "../locales/i18nContext";
import { useLiveSuggestions } from "../hooks/useLiveSuggestions";

const BAR_BUTTON =
  "h-9 px-3 rounded-xl border text-xs font-semibold transition flex items-center gap-2 whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed";
// Secondary labels fold into the icon on narrow windows; the tooltip still names them.
const BAR_LABEL = "hidden lg:inline";

export const SUMMARY_LANGUAGES = [
  { code: "tr", name: "Türkçe", flag: "🇹🇷", label: "Türkçe (Varsayılan)" },
  { code: "en", name: "English", flag: "🇬🇧", label: "English" },
  { code: "de", name: "Deutsch", flag: "🇩🇪", label: "Deutsch" },
  { code: "fr", name: "Français", flag: "🇫🇷", label: "Français" },
  { code: "es", name: "Español", flag: "🇪🇸", label: "Español" },
  { code: "ru", name: "Русский", flag: "🇷🇺", label: "Русский" },
  { code: "ar", name: "العربية", flag: "🇸🇦", label: "العربية" },
  { code: "zh", name: "中文", flag: "🇨🇳", label: "中文" },
  { code: "ja", name: "日本語", flag: "🇯🇵", label: "日本語" },
];

export interface TranscriptSegment {
  id: number;
  speaker_id: string;
  speaker_name: string;
  start_time_ms: number;
  end_time_ms: number;
  timestamp_formatted: string;
  text: string;
  language: string;
  confidence: number;
}

export interface SummaryResult {
  meeting_goal: string;
  key_highlights: string[];
  action_items: ActionItem[];
  phase1_agreed: string[];
  phase2_deferred: string[];
  detailed_topics: TopicBreakdown[];
  participants: string[];
  summary: string;
  key_decisions: string[];
  agenda_topics: string[];
  provider_used: string;
  generation_time_ms: number;
}

interface TranscriptViewerProps {
  isRecording: boolean;
  isSpeaking: boolean;
  selectedLanguage: string;
  onLanguageChange: (lang: string) => void;
  selectedPastMeeting?: MeetingRecord | null;
  onReturnToLiveSession?: () => void;
  onMeetingUpdated?: (meeting: MeetingRecord) => void;
  onSelectMeeting?: (meetingId: string) => void;
  onAddTag?: (meetingId: string, tag: string) => void;
  onRemoveTag?: (meetingId: string, tag: string) => void;
  /** Opens the Model Hub (e.g. to download the on-device report model). */
  onOpenModelHub?: () => void;
}

export const TranscriptViewer: React.FC<TranscriptViewerProps> = ({
  isRecording,
  isSpeaking,
  selectedLanguage,
  onLanguageChange,
  selectedPastMeeting,
  onReturnToLiveSession,
  onMeetingUpdated,
  onSelectMeeting,
  onAddTag,
  onRemoveTag,
  onOpenModelHub,
}) => {
  const { t } = useI18n();
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<
    "transcript" | "summary" | "actions"
  >("transcript");

  // Live Smart Suggestions Hook
  const {
    suggestions: liveSuggestions,
    dismissSuggestion,
    clearSuggestions,
  } = useLiveSuggestions({
    isRecording,
    segments,
  });
  const [isGeneratingSummary, setIsGeneratingSummary] =
    useState<boolean>(false);
  const [isRetranscribeModalOpen, setIsRetranscribeModalOpen] =
    useState<boolean>(false);

  // Rich intelligence states
  const [richSummary, setRichSummary] = useState<SummaryResult | null>(null);
  const [originalSummary, setOriginalSummary] = useState<SummaryResult | null>(
    null,
  );
  const [summaryLang, setSummaryLang] = useState<string>("tr");
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [summaryTranslations, setSummaryTranslations] = useState<
    Record<string, SummaryResult>
  >({});
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<
    number | null
  >(null);

  // Inline Speaker Renaming State
  const [editingSpeakerId, setEditingSpeakerId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState<string>("");

  // Redaction loading state
  const [isRedacting, setIsRedacting] = useState<boolean>(false);

  // Export Modal State
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isFollowUpModalOpen, setIsFollowUpModalOpen] =
    useState<boolean>(false);

  // Template & Custom Prompt Studio State
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() => {
    return localStorage.getItem("echomind_selected_template") || "general";
  });
  const [customTemplates, setCustomTemplates] = useState<MeetingTemplate[]>(
    () => {
      try {
        const saved = localStorage.getItem("echomind_custom_templates");
        return saved ? JSON.parse(saved) : [];
      } catch {
        return [];
      }
    },
  );
  const [isCustomTemplateModalOpen, setIsCustomTemplateModalOpen] =
    useState<boolean>(false);

  const handleSelectTemplate = (template: MeetingTemplate) => {
    setSelectedTemplateId(template.id);
    localStorage.setItem("echomind_selected_template", template.id);
  };

  const handleSaveCustomTemplate = (template: MeetingTemplate) => {
    const updated = [...customTemplates, template];
    setCustomTemplates(updated);
    localStorage.setItem("echomind_custom_templates", JSON.stringify(updated));
    setSelectedTemplateId(template.id);
    localStorage.setItem("echomind_selected_template", template.id);
  };

  const handleDeleteCustomTemplate = (templateId: string) => {
    const updated = customTemplates.filter((t) => t.id !== templateId);
    setCustomTemplates(updated);
    localStorage.setItem("echomind_custom_templates", JSON.stringify(updated));
    if (selectedTemplateId === templateId) {
      setSelectedTemplateId("general");
      localStorage.setItem("echomind_selected_template", "general");
    }
  };

  // Speech De-filler & Fluency Filter State
  const [isFillerFilterActive, setIsFillerFilterActive] = useState<boolean>(
    () => {
      return localStorage.getItem("echomind_filler_filter_active") === "true";
    },
  );
  const [cleanedSegmentsMap, setCleanedSegmentsMap] = useState<
    Record<number, string>
  >({});
  const [fillersRemovedCount, setFillersRemovedCount] = useState<number>(0);

  // Meeting Analytics Modal State
  const [isAnalyticsModalOpen, setIsAnalyticsModalOpen] =
    useState<boolean>(false);
  const [meetingAnalytics, setMeetingAnalytics] =
    useState<MeetingAnalytics | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState<boolean>(false);

  const handleOpenAnalytics = async () => {
    if (segments.length === 0) return;
    setIsLoadingAnalytics(true);
    try {
      if (selectedPastMeeting?.id) {
        const res = await invoke<MeetingAnalytics>(
          "get_meeting_analytics_by_id",
          {
            meetingId: selectedPastMeeting.id,
          },
        );
        setMeetingAnalytics(res);
      } else {
        const res = await invoke<MeetingAnalytics>("get_meeting_analytics", {
          segments,
          totalDurationSeconds: audioDuration > 0 ? audioDuration : null,
        });
        setMeetingAnalytics(res);
      }
      setIsAnalyticsModalOpen(true);
    } catch (err) {
      reportActionError("Analytics fetch error:", err);
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  // Soundbite Clipper State
  const [soundbiteToast, setSoundbiteToast] = useState<string | null>(null);

  // Failed actions are shown, never only logged: a button that silently does
  // nothing looks broken.
  const [actionError, setActionError] = useState<string | null>(null);
  const reportActionError = (context: string, err: unknown) => {
    console.error(context, err);
    const detail =
      typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : String(err);
    setActionError(t("transcript.actionFailed", { error: detail }));
  };

  const handleClipSoundbite = async (segment: TranscriptSegment) => {
    if (!selectedPastMeeting?.id) return;
    try {
      const res = await invoke<SoundbiteResult>("clip_meeting_soundbite", {
        meetingId: selectedPastMeeting.id,
        segmentId: segment.id,
        startMs: segment.start_time_ms,
        endMs: segment.end_time_ms,
      });
      if (res) {
        setSoundbiteToast(`✂️ ${res.filename} (${res.duration_seconds}s)`);
        setTimeout(() => setSoundbiteToast(null), 3500);
      }
    } catch (err) {
      reportActionError("Soundbite clip error:", err);
    }
  };

  // Native Rust CoreAudio Player State & Controls
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  // Poll native playback status when playing
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(async () => {
      try {
        const status = await invoke<{
          is_playing: boolean;
          current_time_secs: number;
          duration_secs: number;
          current_file: string | null;
        }>("get_native_playback_status");

        if (status) {
          setIsPlaying(status.is_playing);
          setAudioCurrentTime(status.current_time_secs);
          if (status.duration_secs > 0) {
            setAudioDuration(status.duration_secs);
          }
        }
      } catch (err) {
        console.warn("Native audio status fetch error:", err);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [isPlaying]);

  const handleAudioPlayPause = async () => {
    if (!selectedPastMeeting?.audio_file_path) return;

    try {
      if (isPlaying) {
        await invoke("pause_native_audio");
        setIsPlaying(false);
      } else {
        const status = await invoke<{
          is_playing: boolean;
          current_time_secs: number;
          duration_secs: number;
        }>("play_native_audio", {
          filePath: selectedPastMeeting.audio_file_path,
        });
        if (status) {
          setIsPlaying(status.is_playing);
          setAudioCurrentTime(status.current_time_secs);
          if (status.duration_secs > 0) {
            setAudioDuration(status.duration_secs);
          }
        }
      }
    } catch (e) {
      console.error("Native audio play error:", e);
      setIsPlaying(false);
    }
  };

  const handleAudioSeek = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setAudioCurrentTime(newTime);
    try {
      await invoke("seek_native_audio", { positionSeconds: newTime });
    } catch (err) {
      console.error("Native seek error:", err);
    }
  };

  const handleSegmentPlay = async (startMs: number) => {
    if (!selectedPastMeeting?.audio_file_path) return;
    const targetSec = Math.max(0, startMs / 1000);
    setAudioCurrentTime(targetSec);
    try {
      const status = await invoke<{
        is_playing: boolean;
        current_time_secs: number;
        duration_secs: number;
      }>("play_native_audio_at", {
        filePath: selectedPastMeeting.audio_file_path,
        startSecs: targetSec,
      });
      if (status) {
        setIsPlaying(status.is_playing);
        if (status.duration_secs > 0) {
          setAudioDuration(status.duration_secs);
        }
      }
    } catch (e) {
      console.error("Native segment play error:", e);
      setIsPlaying(false);
    }
  };

  const formatPlayerTime = (totalSeconds: number) => {
    if (isNaN(totalSeconds) || totalSeconds < 0) return "00:00";
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Sync with past meeting record
  useEffect(() => {
    setSummaryLang("tr");
    setIsTranslating(false);
    if (selectedPastMeeting) {
      setSegments(selectedPastMeeting.segments || []);
      if (selectedPastMeeting.summary || selectedPastMeeting.meeting_goal) {
        const loadedSummary: SummaryResult = {
          meeting_goal:
            selectedPastMeeting.meeting_goal || selectedPastMeeting.summary,
          key_highlights: selectedPastMeeting.key_highlights || [],
          action_items: selectedPastMeeting.action_items || [],
          phase1_agreed:
            selectedPastMeeting.phase1_agreed ||
            selectedPastMeeting.key_decisions ||
            [],
          phase2_deferred: selectedPastMeeting.phase2_deferred || [],
          detailed_topics: selectedPastMeeting.detailed_topics || [],
          participants: selectedPastMeeting.participants || [],
          summary: selectedPastMeeting.summary,
          key_decisions: selectedPastMeeting.key_decisions || [],
          agenda_topics: [],
          provider_used: selectedPastMeeting.summary_provider || "Kayıtlı Özet",
          generation_time_ms: 0,
        };
        setRichSummary(loadedSummary);
        setOriginalSummary(loadedSummary);
        setSummaryTranslations({ tr: loadedSummary });
      } else {
        setRichSummary(null);
        setOriginalSummary(null);
        setSummaryTranslations({});
      }
    } else {
      setRichSummary(null);
      setOriginalSummary(null);
      setSummaryTranslations({});
    }
  }, [selectedPastMeeting]);

  // Fetch real-time transcript when recording
  useEffect(() => {
    if (!isRecording || selectedPastMeeting) return;

    const interval = setInterval(async () => {
      try {
        const history = await invoke<TranscriptSegment[]>(
          "get_transcription_history",
        );
        setSegments(history);
      } catch (err) {
        console.error("Failed to fetch transcription history:", err);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [isRecording, selectedPastMeeting]);

  // Periodic background live transcription during recording
  useEffect(() => {
    if (!isRecording || selectedPastMeeting) return;

    let isAutoTranscribing = false;
    const transcribeInterval = setInterval(async () => {
      if (isAutoTranscribing) return;
      isAutoTranscribing = true;
      try {
        const res = await invoke<TranscriptSegment[]>(
          "transcribe_audio_buffer",
          {
            language: selectedLanguage,
          },
        );
        if (res && res.length > 0) {
          setSegments(res);
        }
      } catch {
        // Silent fallback during active recording
      } finally {
        isAutoTranscribing = false;
      }
    }, 15000);

    return () => clearInterval(transcribeInterval);
  }, [isRecording, selectedPastMeeting, selectedLanguage]);

  const handleTranscribeBuffer = async () => {
    setIsProcessing(true);
    try {
      const activeEngine =
        localStorage.getItem("echomind_active_engine") || "local";
      let cloudProvider: string | null = null;
      let apiKey: string | null = null;
      let modelVersion: string | null = null;

      if (activeEngine === "cloud_groq") {
        cloudProvider = "groq";
        apiKey = (await CredentialStore.get("echomind_groq_key")) || null;
        modelVersion =
          localStorage.getItem("echomind_groq_model_version") ||
          "whisper-large-v3-turbo";
      } else if (activeEngine === "cloud_gemini") {
        cloudProvider = "gemini";
        apiKey = (await CredentialStore.get("echomind_gemini_key")) || null;
        modelVersion =
          localStorage.getItem("echomind_gemini_model_version") ||
          "gemini-1.5-flash";
      } else if (activeEngine === "cloud_openai") {
        cloudProvider = "openai";
        apiKey = (await CredentialStore.get("echomind_openai_key")) || null;
        modelVersion =
          localStorage.getItem("echomind_openai_model_version") || "whisper-1";
      }

      const res = await invoke<TranscriptSegment[]>("transcribe_audio_buffer", {
        language: selectedLanguage,
        cloudProvider,
        apiKey,
        modelVersion,
      });
      setSegments(res);
    } catch (err) {
      console.error("Transcription error:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClear = async () => {
    try {
      await invoke("clear_transcription_history");
      setSegments([]);
    } catch (err) {
      console.error("Failed to clear transcription history:", err);
    }
  };

  const handleCopyAll = () => {
    const text = segments
      .map((s) => `[${s.timestamp_formatted}] ${s.speaker_name}: ${s.text}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleStartEditSpeaker = (speakerId: string, currentName: string) => {
    setEditingSpeakerId(speakerId);
    setEditingNameValue(currentName);
  };

  const handleSaveSpeakerName = async (speakerId: string) => {
    if (!editingNameValue.trim()) {
      setEditingSpeakerId(null);
      return;
    }
    const newName = editingNameValue.trim();

    setSegments((prev) =>
      prev.map((s) =>
        s.speaker_id === speakerId || s.speaker_name === speakerId
          ? { ...s, speaker_name: newName }
          : s,
      ),
    );

    if (selectedPastMeeting?.id) {
      try {
        await invoke("update_meeting_speaker_name", {
          meetingId: selectedPastMeeting.id,
          speakerId,
          newName,
        });
      } catch (err) {
        console.error("Failed to update speaker name in backend:", err);
      }
    }

    setEditingSpeakerId(null);
  };

  const handleToggleActionItem = async (index: number) => {
    if (!richSummary || !richSummary.action_items) return;
    const updatedItems = [...richSummary.action_items];
    if (updatedItems[index]) {
      updatedItems[index].is_completed = !updatedItems[index].is_completed;
      setRichSummary({ ...richSummary, action_items: updatedItems });

      if (selectedPastMeeting) {
        try {
          await invoke("toggle_action_item_status", {
            meetingId: selectedPastMeeting.id,
            actionIndex: index,
          });
        } catch (err) {
          console.error("Failed to toggle action item status:", err);
        }
      }
    }
  };

  const handleJumpToCitation = (citationIdx: number) => {
    const seg = segments.find((s) => s.id === citationIdx);
    if (seg) {
      setActiveTab("transcript");
      setHighlightedSegmentId(seg.id);
      setTimeout(() => {
        const el = document.getElementById(`segment-${seg.id}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
      setTimeout(() => {
        setHighlightedSegmentId(null);
      }, 3000);
    }
  };

  const handleGenerateSummary = async () => {
    if (segments.length === 0) return;
    setIsGeneratingSummary(true);
    try {
      const activeEngine =
        localStorage.getItem("echomind_active_engine") || "local";
      let provider = "local";
      let apiKey: string | null = null;

      if (activeEngine === "cloud_groq") {
        provider = "groq";
        apiKey = await CredentialStore.get("echomind_groq_key");
      } else if (activeEngine === "cloud_gemini") {
        provider = "gemini";
        apiKey = await CredentialStore.get("echomind_gemini_key");
      } else if (activeEngine === "cloud_openai") {
        provider = "openai";
        apiKey = await CredentialStore.get("echomind_openai_key");
      }

      const customEndpoint =
        localStorage.getItem("echomind_ollama_endpoint") || undefined;
      const customModel =
        localStorage.getItem("echomind_ollama_model") || undefined;

      const allTemplates = [...BUILTIN_TEMPLATES, ...customTemplates];
      const activeTpl =
        allTemplates.find((t) => t.id === selectedTemplateId) ||
        BUILTIN_TEMPLATES[0];

      const summaryRes = await invoke<SummaryResult>(
        "generate_meeting_summary",
        {
          meetingId: selectedPastMeeting?.id || "current_session",
          segments,
          provider,
          apiKey: apiKey || null,
          customEndpoint,
          customModel,
          templateId: activeTpl.id,
          customPrompt: activeTpl.systemPrompt || null,
        },
      );

      setRichSummary(summaryRes);
      setOriginalSummary(summaryRes);
      setSummaryTranslations({ tr: summaryRes });
      setSummaryLang("tr");
      setActiveTab("summary");
    } catch (err) {
      reportActionError("Summary generation error:", err);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleSummaryLanguageChange = async (targetLangCode: string) => {
    if (targetLangCode === summaryLang) return;

    if (summaryTranslations[targetLangCode]) {
      setSummaryLang(targetLangCode);
      setRichSummary(summaryTranslations[targetLangCode]);
      return;
    }

    const baseSummary = originalSummary || richSummary;
    if (!baseSummary) return;

    const targetLangObj = SUMMARY_LANGUAGES.find(
      (l) => l.code === targetLangCode,
    );
    const targetLangName = targetLangObj ? targetLangObj.name : targetLangCode;

    setIsTranslating(true);
    try {
      const activeEngine =
        localStorage.getItem("echomind_active_engine") || "local";
      let provider = "local";
      let apiKey: string | null = null;

      if (activeEngine === "cloud_groq") {
        provider = "groq";
        apiKey = await CredentialStore.get("echomind_groq_key");
      } else if (activeEngine === "cloud_gemini") {
        provider = "gemini";
        apiKey = await CredentialStore.get("echomind_gemini_key");
      } else if (activeEngine === "cloud_openai") {
        provider = "openai";
        apiKey = await CredentialStore.get("echomind_openai_key");
      }

      const customEndpoint =
        localStorage.getItem("echomind_ollama_endpoint") || undefined;
      const customModel =
        localStorage.getItem("echomind_ollama_model") || undefined;

      const translated = await invoke<SummaryResult>(
        "translate_meeting_summary",
        {
          summary: baseSummary,
          targetLanguage: targetLangName,
          targetLangCode,
          provider,
          apiKey: apiKey || null,
          customEndpoint,
          customModel,
        },
      );

      setSummaryTranslations((prev) => ({
        ...prev,
        [targetLangCode]: translated,
      }));
      setRichSummary(translated);
      setSummaryLang(targetLangCode);
    } catch (err) {
      reportActionError("Translation error:", err);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleRedactTranscript = async () => {
    if (!selectedPastMeeting || isRedacting) return;
    setIsRedacting(true);
    try {
      const activeEngine =
        localStorage.getItem("echomind_active_engine") || "local";
      let provider = "gemini";
      let apiKey: string | null = null;

      if (activeEngine === "cloud_gemini") {
        apiKey = await CredentialStore.get("echomind_gemini_key");
      } else if (activeEngine === "cloud_groq") {
        provider = "groq";
        apiKey = await CredentialStore.get("echomind_groq_key");
      } else if (activeEngine === "cloud_openai") {
        provider = "openai";
        apiKey = await CredentialStore.get("echomind_openai_key");
      }

      const updated = await invoke<MeetingRecord>(
        "enhance_meeting_transcript",
        {
          meetingId: selectedPastMeeting.id,
          provider: apiKey ? provider : null,
          apiKey: apiKey || null,
        },
      );

      if (updated && updated.segments) {
        setSegments(updated.segments);
      }
    } catch (err) {
      reportActionError("Redaction error:", err);
    } finally {
      setIsRedacting(false);
    }
  };

  const handleExportNotes = async () => {
    if (!selectedPastMeeting) return;
    try {
      const mdContent = await invoke<string>("export_meeting_notes", {
        meetingId: selectedPastMeeting.id,
        customSummary: richSummary || null,
        langCode: summaryLang || null,
      });
      const blob = new Blob([mdContent], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `EchoMind-${selectedPastMeeting.title.replace(/\s+/g, "-")}.md`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      reportActionError("Export notes error:", err);
    }
  };

  // Re-calculate cleaned segments whenever segments or filler filter changes
  useEffect(() => {
    if (!isFillerFilterActive || segments.length === 0) {
      setCleanedSegmentsMap({});
      setFillersRemovedCount(0);
      return;
    }

    let isMounted = true;

    const processCleaner = async () => {
      try {
        if (selectedPastMeeting?.id) {
          const res = await invoke<{
            segments: Array<{
              id: number;
              cleaned_text: string;
              removed_fillers_count: number;
            }>;
            total_fillers_removed: number;
          }>("filter_meeting_filler_words", {
            meetingId: selectedPastMeeting.id,
            langCode: selectedLanguage || null,
          });
          if (isMounted && res) {
            const map: Record<number, string> = {};
            res.segments.forEach((s) => {
              map[s.id] = s.cleaned_text;
            });
            setCleanedSegmentsMap(map);
            setFillersRemovedCount(res.total_fillers_removed);
          }
        } else {
          // Process segments in live session
          let totalCount = 0;
          const map: Record<number, string> = {};
          for (const seg of segments) {
            const [cleaned, count] = await invoke<[string, number]>(
              "clean_transcript_text",
              {
                rawText: seg.text,
                langCode: selectedLanguage || seg.language || null,
              },
            );
            map[seg.id] = cleaned;
            totalCount += count;
          }
          if (isMounted) {
            setCleanedSegmentsMap(map);
            setFillersRemovedCount(totalCount);
          }
        }
      } catch (err) {
        console.warn("Speech cleaner execution error:", err);
      }
    };

    processCleaner();

    return () => {
      isMounted = false;
    };
  }, [isFillerFilterActive, segments, selectedPastMeeting, selectedLanguage]);

  const handleToggleFillerFilter = () => {
    setIsFillerFilterActive((prev) => {
      const next = !prev;
      localStorage.setItem("echomind_filler_filter_active", String(next));
      return next;
    });
  };

  const filteredSegments = segments.filter(
    (s) =>
      s.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.speaker_name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const actionItemsCount = richSummary?.action_items?.length || 0;

  const isLowQualityTranscript = useMemo(() => {
    if (!segments || segments.length === 0) return false;
    const avgConfidence =
      segments.reduce((acc, s) => acc + (s.confidence || 0), 0) /
      segments.length;
    return avgConfidence < 0.6;
  }, [segments]);

  return (
    <div className="bento-card p-0 flex flex-col flex-1 min-h-0 bg-[#0b1324] border border-white/10 rounded-2xl shadow-xl overflow-hidden relative">
      {/* Global AI Processing Glassmorphism Overlay */}
      {(isGeneratingSummary || isRedacting) && (
        <div className="absolute inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="max-w-md w-full p-8 rounded-3xl bg-gradient-to-b from-slate-900/95 via-[#0c162d]/95 to-slate-950/95 border border-cyan-500/40 shadow-2xl shadow-cyan-950/50 flex flex-col items-center text-center space-y-5">
            <div className="relative flex items-center justify-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/40">
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-base font-bold text-white flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>
                  {isRedacting
                    ? "Transkript Redakte Ediliyor..."
                    : "Yapay Zekâ Toplantıyı Analiz Ediyor..."}
                </span>
              </h3>
              <p className="text-xs text-cyan-200/90 leading-relaxed">
                {isRedacting
                  ? "Konuşmacı isimleri, fonetik hatalar ve teknik terimler temizleniyor."
                  : "Diyaloglar taranıyor; toplantı amacı, stratejik kararlar, eylem maddeleri ve görevli kişiler derinlemesine sentezleniyor."}
              </p>
              <p className="text-[11px] text-slate-400 font-mono pt-1">
                ⏳ Uzun toplantılar ve kapsamlı analizler için bu işlem 1-2
                dakika sürebilir, lütfen bekleyiniz.
              </p>
            </div>

            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700/60">
              <div className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 rounded-full w-full" />
            </div>
          </div>
        </div>
      )}

      {/* Top Header: back, view tabs and search. Meeting actions live in the bottom bar. */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 bg-[#0f172a]/80 backdrop-blur-md">
        <div className="flex items-center gap-2 min-w-0">
          {selectedPastMeeting && onReturnToLiveSession && (
            <button
              onClick={onReturnToLiveSession}
              className="shrink-0 p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 transition border border-white/10"
              title={t("sidebar.backToLive")}
              aria-label={t("sidebar.backToLive")}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          )}

          <div
            role="tablist"
            className="flex items-center gap-1 p-1 bg-slate-900/90 rounded-xl border border-slate-800 text-xs font-medium min-w-0"
          >
            <button
              role="tab"
              aria-selected={activeTab === "transcript"}
              onClick={() => setActiveTab("transcript")}
              className={`min-w-0 px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === "transcript"
                  ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/40 font-semibold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0" />
              <span>
                {t("transcript.tabs.stream")} ({segments.length})
              </span>
            </button>

            <button
              role="tab"
              aria-selected={activeTab === "summary"}
              onClick={() => setActiveTab("summary")}
              className={`min-w-0 px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === "summary"
                  ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/40 font-semibold"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>{t("transcript.tabs.report")}</span>
            </button>

            {actionItemsCount > 0 && (
              <button
                role="tab"
                aria-selected={activeTab === "actions"}
                onClick={() => setActiveTab("actions")}
                className={`min-w-0 px-3 py-1.5 rounded-lg border transition flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === "actions"
                    ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/40 font-semibold"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {t("transcript.tabs.tasks")} ({actionItemsCount})
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activeTab === "transcript" && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("transcript.searchPlaceholder")}
                className="w-44 pl-8 pr-3 py-1.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          )}

          {!selectedPastMeeting && (
            <div className="flex items-center gap-2">
              {isRecording && isSpeaking && (
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {t("ui.transcript.speaking")}
                </span>
              )}
              <div className="flex items-center gap-1 bg-slate-900/80 border border-slate-800 p-0.5 rounded-lg text-[11px] text-slate-400">
                {["tr", "en", "auto"].map((l) => (
                  <button
                    key={l}
                    onClick={() => onLanguageChange(l)}
                    className={`px-2 py-0.5 rounded ${
                      selectedLanguage === l
                        ? "bg-cyan-500/20 text-cyan-300 font-semibold"
                        : "hover:text-slate-200"
                    }`}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Audio Player Bar for Past Meetings */}
      {selectedPastMeeting && selectedPastMeeting.audio_file_path && (
        <AudioPlayerBar
          isPlaying={isPlaying}
          audioCurrentTime={audioCurrentTime}
          audioDuration={audioDuration}
          meetingDuration={selectedPastMeeting.duration_seconds}
          meetingTitle={selectedPastMeeting.title}
          onTogglePlay={handleAudioPlayPause}
          onSeek={handleAudioSeek}
          formatPlayerTime={formatPlayerTime}
        />
      )}

      {/* Low Quality ASR Warning Banner */}
      {isLowQualityTranscript && (
        <div className="mx-4 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-3 text-amber-200 text-xs animate-in fade-in duration-150">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold text-amber-300">
              {t("transcript.lowQualityWarningTitle") ||
                "Transkript Güvenilirlik Uyarısı:"}
            </span>{" "}
            {t("transcript.lowQualityWarningDesc") ||
              "Bu kayıtta zayıf ses sinyali veya tekrarlayan konuşma desenleri tespit edildi. Transkript güvenilirliği düşük olabilir. Daha yüksek doğruluk için Ayarlar'dan Whisper Small modelini kullanabilir veya dili manuel olarak seçebilirsiniz."}
          </div>
        </div>
      )}

      {/* Main Tab Viewport */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 2xl:p-8 min-h-0">
        {activeTab === "transcript" && (
          <LiveFeedView
            segments={segments}
            filteredSegments={filteredSegments}
            searchQuery={searchQuery}
            isRecording={isRecording}
            isRedacting={isRedacting}
            highlightedSegmentId={highlightedSegmentId}
            editingSpeakerId={editingSpeakerId}
            editingNameValue={editingNameValue}
            selectedPastMeeting={selectedPastMeeting}
            isFillerFilterActive={isFillerFilterActive}
            fillersRemovedCount={fillersRemovedCount}
            cleanedSegmentsMap={cleanedSegmentsMap}
            suggestions={liveSuggestions}
            onDismissSuggestion={dismissSuggestion}
            onClearSuggestions={clearSuggestions}
            onToggleFillerFilter={handleToggleFillerFilter}
            onRedactTranscript={handleRedactTranscript}
            onStartEditSpeaker={handleStartEditSpeaker}
            onSaveSpeakerName={handleSaveSpeakerName}
            onCancelEditSpeaker={() => setEditingSpeakerId(null)}
            onEditingNameChange={setEditingNameValue}
            onSegmentPlay={handleSegmentPlay}
            onClipSoundbite={handleClipSoundbite}
            onOpenRetranscribe={() => setIsRetranscribeModalOpen(true)}
          />
        )}

        {/* Soundbite Clip Floating Toast Notification */}
        {actionError && (
          <div
            role="alert"
            data-testid="transcript-action-error"
            className="mx-4 mt-3 px-3 py-2 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs flex items-start justify-between gap-3"
          >
            <span className="[overflow-wrap:anywhere]">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="shrink-0 text-rose-300 hover:text-white"
              aria-label={t("common.close")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {soundbiteToast && (
          <div className="fixed bottom-16 right-8 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300 pointer-events-none">
            <div className="px-4 py-2.5 rounded-2xl bg-slate-900/95 border border-amber-500/40 shadow-2xl shadow-amber-950/50 text-amber-300 text-xs font-semibold flex items-center gap-2 backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>{soundbiteToast}</span>
            </div>
          </div>
        )}

        {activeTab === "summary" && (
          <LocalLlmHint onOpenModelHub={onOpenModelHub} />
        )}

        {activeTab === "summary" && (
          <SummaryCardsView
            richSummary={richSummary}
            summaryLang={summaryLang}
            isTranslating={isTranslating}
            selectedPastMeeting={selectedPastMeeting}
            selectedTemplateId={selectedTemplateId}
            customTemplates={customTemplates}
            onSelectTemplate={handleSelectTemplate}
            onOpenCreateCustom={() => setIsCustomTemplateModalOpen(true)}
            onDeleteCustomTemplate={handleDeleteCustomTemplate}
            onLanguageChange={handleSummaryLanguageChange}
            onToggleActionItem={handleToggleActionItem}
            onJumpToCitation={handleJumpToCitation}
            onGenerateSummary={handleGenerateSummary}
            onExportNotes={handleExportNotes}
            onSelectMeeting={onSelectMeeting}
            onAddTag={onAddTag}
            onRemoveTag={onRemoveTag}
          />
        )}

        {activeTab === "actions" && (
          <TasksDecisionsView
            actionItems={richSummary?.action_items || []}
            onToggleActionItem={handleToggleActionItem}
            onJumpToCitation={handleJumpToCitation}
          />
        )}
      </div>

      {/* Bottom Control Bar */}
      <div className="px-4 py-3 border-t border-white/10 flex justify-between items-center gap-3 bg-[#040e1f]/50 rounded-b-xl">
        {!selectedPastMeeting ? (
          <button
            onClick={handleTranscribeBuffer}
            disabled={isProcessing || (!isRecording && segments.length === 0)}
            className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-white text-slate-900 font-medium text-xs transition flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <>
                <Wand2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t("ui.transcript.transcribing")}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-slate-900" />
                <span>{t("ui.transcript.transcribe")}</span>
              </>
            )}
          </button>
        ) : (
          <span className="hidden 2xl:block min-w-0 truncate text-xs text-slate-400">
            {t("ui.transcript.pastRecording", {
              date: selectedPastMeeting.date_formatted,
            })}
          </span>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {selectedPastMeeting?.audio_file_path && (
            <Tooltip
              title={t("transcript.bar.retranscribe.label")}
              description={t("transcript.bar.retranscribe.hint")}
            >
              <button
                onClick={() => setIsRetranscribeModalOpen(true)}
                aria-label={t("transcript.bar.retranscribe.label")}
                className={`${BAR_BUTTON} border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:border-amber-400/60`}
              >
                <RotateCw className="w-4 h-4 shrink-0 text-amber-400" />
                <span className={BAR_LABEL}>
                  {t("transcript.bar.retranscribe.label")}
                </span>
              </button>
            </Tooltip>
          )}

          {selectedPastMeeting && segments.length > 0 && (
            <Tooltip
              title={t("transcript.bar.analytics.label")}
              description={t("transcript.bar.analytics.hint")}
            >
              <button
                onClick={handleOpenAnalytics}
                disabled={isLoadingAnalytics}
                aria-label={t("transcript.bar.analytics.label")}
                className={`${BAR_BUTTON} border-indigo-500/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20 hover:border-indigo-400/60`}
              >
                {isLoadingAnalytics ? (
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin text-indigo-400" />
                ) : (
                  <BarChart3 className="w-4 h-4 shrink-0 text-indigo-400" />
                )}
                <span className={BAR_LABEL}>
                  {t("transcript.bar.analytics.label")}
                </span>
              </button>
            </Tooltip>
          )}

          <Tooltip
            title={t(
              isCopied
                ? "transcript.bar.copied.label"
                : "transcript.bar.copy.label",
            )}
            description={t(
              isCopied
                ? "transcript.bar.copied.hint"
                : "transcript.bar.copy.hint",
            )}
          >
            <button
              onClick={handleCopyAll}
              disabled={segments.length === 0}
              aria-label={t("transcript.bar.copy.label")}
              className={`${BAR_BUTTON} border-slate-600/60 bg-slate-800/60 text-slate-200 hover:bg-slate-700 hover:border-slate-500`}
            >
              {isCopied ? (
                <Check className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4 shrink-0 text-slate-300" />
              )}
              <span className={BAR_LABEL}>
                {t(
                  isCopied
                    ? "transcript.bar.copied.label"
                    : "transcript.bar.copy.label",
                )}
              </span>
            </button>
          </Tooltip>

          {selectedPastMeeting && (
            <Tooltip
              title={t("transcript.bar.followUp.label")}
              description={t("transcript.bar.followUp.hint")}
              align="end"
            >
              <button
                onClick={() => setIsFollowUpModalOpen(true)}
                disabled={segments.length === 0}
                aria-label={t("transcript.bar.followUp.label")}
                className={`${BAR_BUTTON} border-violet-400/40 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-950/40 hover:from-violet-500 hover:to-indigo-500`}
              >
                <Mail className="w-4 h-4 shrink-0" />
                <span>{t("transcript.bar.followUp.label")}</span>
              </button>
            </Tooltip>
          )}

          <Tooltip
            title={t("transcript.bar.export.label")}
            description={t("transcript.bar.export.hint")}
            align="end"
          >
            <button
              onClick={() => setIsExportModalOpen(true)}
              disabled={segments.length === 0}
              aria-label={t("transcript.bar.export.label")}
              className={`${BAR_BUTTON} border-cyan-400/40 bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-950/40 hover:from-cyan-500 hover:to-blue-500`}
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>{t("transcript.bar.export.label")}</span>
            </button>
          </Tooltip>

          {!selectedPastMeeting && (
            <Tooltip title="Temizle" align="end">
              <button
                onClick={handleClear}
                disabled={segments.length === 0}
                aria-label="Temizle"
                className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-white/5 transition disabled:opacity-30"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* One-Click Follow-up Engine Modal */}
      {selectedPastMeeting && (
        <FollowUpModal
          isOpen={isFollowUpModalOpen}
          onClose={() => setIsFollowUpModalOpen(false)}
          meeting={selectedPastMeeting}
          summary={richSummary || null}
        />
      )}

      {/* Rich Export Suite Modal */}
      {selectedPastMeeting && (
        <ExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          meetingId={selectedPastMeeting.id}
          meetingTitle={selectedPastMeeting.title}
          activeSummary={richSummary}
          langCode={summaryLang}
        />
      )}

      {/* Retranscribe / Model Switch Modal */}
      {selectedPastMeeting && (
        <RetranscribeModal
          isOpen={isRetranscribeModalOpen}
          onClose={() => setIsRetranscribeModalOpen(false)}
          meeting={selectedPastMeeting}
          onRetranscribeSuccess={(updatedMeeting) => {
            setSegments(updatedMeeting.segments);
            if (updatedMeeting.meeting_goal || updatedMeeting.summary) {
              const synResult: SummaryResult = {
                meeting_goal: updatedMeeting.meeting_goal || "",
                key_highlights: updatedMeeting.key_highlights || [],
                action_items: updatedMeeting.action_items || [],
                phase1_agreed: updatedMeeting.phase1_agreed || [],
                phase2_deferred: updatedMeeting.phase2_deferred || [],
                detailed_topics: updatedMeeting.detailed_topics || [],
                participants: updatedMeeting.participants || [],
                summary: updatedMeeting.summary || "",
                key_decisions: updatedMeeting.key_decisions || [],
                agenda_topics: [],
                provider_used: updatedMeeting.summary_provider || "EchoMind",
                generation_time_ms: 0,
              };
              setRichSummary(synResult);
              setOriginalSummary(synResult);
              setSummaryTranslations({});
              setSummaryLang("tr");
            }
            if (onMeetingUpdated) {
              onMeetingUpdated(updatedMeeting);
            }
          }}
        />
      )}

      {/* Custom Template / Prompt Studio Modal */}
      <CustomTemplateModal
        isOpen={isCustomTemplateModalOpen}
        onClose={() => setIsCustomTemplateModalOpen(false)}
        onSaveTemplate={handleSaveCustomTemplate}
      />

      {/* Meeting & Participant Analytics Modal */}
      <MeetingAnalyticsModal
        isOpen={isAnalyticsModalOpen}
        onClose={() => setIsAnalyticsModalOpen(false)}
        analytics={meetingAnalytics}
        meetingTitle={selectedPastMeeting?.title}
      />
    </div>
  );
};

export default TranscriptViewer;
