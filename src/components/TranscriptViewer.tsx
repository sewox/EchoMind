import React, { useEffect, useState } from "react";
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
} from "lucide-react";
import { MeetingRecord, ActionItem, TopicBreakdown } from "../App";
import { ExportModal } from "./ExportModal";
import { RetranscribeModal } from "./RetranscribeModal";
import { AudioPlayerBar } from "./transcript/AudioPlayerBar";
import { TasksDecisionsView } from "./transcript/TasksDecisionsView";
import { SummaryCardsView } from "./transcript/SummaryCardsView";
import { LiveFeedView } from "./transcript/LiveFeedView";
import { CustomTemplateModal } from "./transcript/CustomTemplateModal";
import { MeetingAnalyticsModal } from "./transcript/MeetingAnalyticsModal";
import { MeetingTemplate, BUILTIN_TEMPLATES } from "../types/templates";
import { MeetingAnalytics } from "../types/analytics";
import { SoundbiteResult } from "../types/soundbite";
import { useI18n } from "../locales/i18nContext";

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
}

export const TranscriptViewer: React.FC<TranscriptViewerProps> = ({
  isRecording,
  isSpeaking,
  selectedLanguage,
  onLanguageChange,
  selectedPastMeeting,
  onReturnToLiveSession,
  onMeetingUpdated,
}) => {
  const { t } = useI18n();
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<
    "transcript" | "summary" | "actions"
  >("transcript");
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

  // Template & Custom Prompt Studio State
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() => {
    return localStorage.getItem("echomind_selected_template") || "general";
  });
  const [customTemplates, setCustomTemplates] = useState<MeetingTemplate[]>(() => {
    try {
      const saved = localStorage.getItem("echomind_custom_templates");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isCustomTemplateModalOpen, setIsCustomTemplateModalOpen] = useState<boolean>(false);

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
  const [isFillerFilterActive, setIsFillerFilterActive] = useState<boolean>(() => {
    return localStorage.getItem("echomind_filler_filter_active") === "true";
  });
  const [cleanedSegmentsMap, setCleanedSegmentsMap] = useState<Record<number, string>>({});
  const [fillersRemovedCount, setFillersRemovedCount] = useState<number>(0);

  // Meeting Analytics Modal State
  const [isAnalyticsModalOpen, setIsAnalyticsModalOpen] = useState<boolean>(false);
  const [meetingAnalytics, setMeetingAnalytics] = useState<MeetingAnalytics | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState<boolean>(false);

  const handleOpenAnalytics = async () => {
    if (segments.length === 0) return;
    setIsLoadingAnalytics(true);
    try {
      if (selectedPastMeeting?.id) {
        const res = await invoke<MeetingAnalytics>("get_meeting_analytics_by_id", {
          meetingId: selectedPastMeeting.id,
        });
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
      console.error("Analytics fetch error:", err);
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  // Soundbite Clipper State
  const [soundbiteToast, setSoundbiteToast] = useState<string | null>(null);

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
      console.error("Soundbite clip error:", err);
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
        apiKey = localStorage.getItem("echomind_groq_key") || null;
        modelVersion =
          localStorage.getItem("echomind_groq_model_version") ||
          "whisper-large-v3-turbo";
      } else if (activeEngine === "cloud_gemini") {
        cloudProvider = "gemini";
        apiKey = localStorage.getItem("echomind_gemini_key") || null;
        modelVersion =
          localStorage.getItem("echomind_gemini_model_version") ||
          "gemini-1.5-flash";
      } else if (activeEngine === "cloud_openai") {
        cloudProvider = "openai";
        apiKey = localStorage.getItem("echomind_openai_key") || null;
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
        apiKey = localStorage.getItem("echomind_groq_key");
      } else if (activeEngine === "cloud_gemini") {
        provider = "gemini";
        apiKey = localStorage.getItem("echomind_gemini_key");
      } else if (activeEngine === "cloud_openai") {
        provider = "openai";
        apiKey = localStorage.getItem("echomind_openai_key");
      }

      const customEndpoint =
        localStorage.getItem("echomind_ollama_endpoint") || undefined;
      const customModel =
        localStorage.getItem("echomind_ollama_model") || undefined;

      const allTemplates = [...BUILTIN_TEMPLATES, ...customTemplates];
      const activeTpl =
        allTemplates.find((t) => t.id === selectedTemplateId) || BUILTIN_TEMPLATES[0];

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
      console.error("Summary generation error:", err);
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
        apiKey = localStorage.getItem("echomind_groq_key");
      } else if (activeEngine === "cloud_gemini") {
        provider = "gemini";
        apiKey = localStorage.getItem("echomind_gemini_key");
      } else if (activeEngine === "cloud_openai") {
        provider = "openai";
        apiKey = localStorage.getItem("echomind_openai_key");
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
      console.error("Translation error:", err);
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
        apiKey = localStorage.getItem("echomind_gemini_key");
      } else if (activeEngine === "cloud_groq") {
        provider = "groq";
        apiKey = localStorage.getItem("echomind_groq_key");
      } else if (activeEngine === "cloud_openai") {
        provider = "openai";
        apiKey = localStorage.getItem("echomind_openai_key");
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
      console.error("Redaction error:", err);
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
      console.error("Export notes error:", err);
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
            segments: Array<{ id: number; cleaned_text: string; removed_fillers_count: number }>;
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
            const [cleaned, count] = await invoke<[string, number]>("clean_transcript_text", {
              rawText: seg.text,
              langCode: selectedLanguage || seg.language || null,
            });
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

      {/* Top Header & Tab Navigation */}
      <div className="p-4 border-b border-white/10 flex flex-wrap justify-between items-center gap-3 bg-[#0f172a]/80 backdrop-blur-md">
        {/* Left: Title & Tabs */}
        <div className="flex items-center gap-3 flex-wrap">
          {selectedPastMeeting && onReturnToLiveSession && (
            <button
              onClick={onReturnToLiveSession}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition flex items-center gap-1.5 text-xs font-medium border border-white/10"
              title="Canlı Toplantı Ekranına Dön"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t("sidebar.backToLive")}</span>
            </button>
          )}

          {/* Segmented Tab Controls */}
          <div className="flex items-center p-1 bg-slate-900/90 rounded-xl border border-slate-800 text-xs font-medium">
            <button
              onClick={() => setActiveTab("transcript")}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                activeTab === "transcript"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>
                {t("transcript.tabs.stream")} ({segments.length})
              </span>
            </button>

            <button
              onClick={() => setActiveTab("summary")}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                activeTab === "summary"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm font-semibold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{t("transcript.tabs.report")}</span>
            </button>

            {actionItemsCount > 0 && (
              <button
                onClick={() => setActiveTab("actions")}
                className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                  activeTab === "actions"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm font-semibold"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  {t("transcript.tabs.tasks")} ({actionItemsCount})
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Right: Search Box & Language */}
        <div className="flex items-center gap-3">
          {activeTab === "transcript" && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("transcript.searchPlaceholder")}
                className="pl-8 pr-3 py-1 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/70"
              />
            </div>
          )}

          {/* Top Bar Retranscribe & Export Buttons */}
          {selectedPastMeeting && (
            <div className="flex items-center gap-2">
              {selectedPastMeeting.audio_file_path && (
                <button
                  onClick={() => setIsRetranscribeModalOpen(true)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 text-xs font-semibold shadow-sm transition flex items-center gap-1.5 shrink-0"
                  title={t("transcript.retranscribeTooltip")}
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>{t("transcript.retranscribe")}</span>
                </button>
              )}

              {segments.length > 0 && (
                <button
                  onClick={handleOpenAnalytics}
                  disabled={isLoadingAnalytics}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/30 text-xs font-semibold shadow-sm transition flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  title={t("transcript.analytics.modalSubtitle")}
                >
                  <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{isLoadingAnalytics ? "..." : t("transcript.analytics.button")}</span>
                </button>
              )}

              {segments.length > 0 && (
                <button
                  onClick={() => setIsExportModalOpen(true)}
                  className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-cyan-900/30 transition flex items-center gap-1.5 shrink-0"
                  title={t("transcript.shareReportTooltip")}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t("transcript.shareReport")}</span>
                </button>
              )}
            </div>
          )}

          {!selectedPastMeeting && (
            <div className="flex items-center gap-2">
              {isRecording && isSpeaking && (
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Konuşuluyor
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
        {soundbiteToast && (
          <div className="fixed bottom-16 right-8 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300 pointer-events-none">
            <div className="px-4 py-2.5 rounded-2xl bg-slate-900/95 border border-amber-500/40 shadow-2xl shadow-amber-950/50 text-amber-300 text-xs font-semibold flex items-center gap-2 backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>{soundbiteToast}</span>
            </div>
          </div>
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
            onOpenRetranscribe={() => setIsRetranscribeModalOpen(true)}
            onExportNotes={handleExportNotes}
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
      <div className="p-3 border-t border-white/10 flex justify-between items-center bg-[#040e1f]/50 rounded-b-xl px-6">
        {!selectedPastMeeting ? (
          <button
            onClick={handleTranscribeBuffer}
            disabled={isProcessing || (!isRecording && segments.length === 0)}
            className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-white text-slate-900 font-medium text-xs transition flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <>
                <Wand2 className="w-3.5 h-3.5 animate-spin" />
                <span>Yazıya Dönüştürülüyor...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-slate-900" />
                <span>Yazıya Dönüştür</span>
              </>
            )}
          </button>
        ) : (
          <span className="text-xs text-slate-400 font-mono">
            Geçmiş Kayıt: {selectedPastMeeting.date_formatted}
          </span>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyAll}
            disabled={segments.length === 0}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 font-medium text-xs hover:bg-white/10 hover:text-white transition flex items-center gap-1.5 disabled:opacity-30"
          >
            {isCopied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>Kopyala</span>
          </button>

          <button
            onClick={() => setIsExportModalOpen(true)}
            disabled={segments.length === 0}
            className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium text-xs shadow-md shadow-cyan-900/30 transition flex items-center gap-1.5 disabled:opacity-30"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Raporu Dışa Aktar</span>
          </button>

          {!selectedPastMeeting && (
            <button
              onClick={handleClear}
              disabled={segments.length === 0}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5 transition disabled:opacity-30"
              title="Temizle"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

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
