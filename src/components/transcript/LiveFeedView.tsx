import React, { useState } from "react";
import {
  MessageSquare,
  Wand2,
  User,
  Edit2,
  Check,
  Play,
  Zap,
  Sparkles,
  Scissors,
  HelpCircle,
  ShieldAlert,
  CheckCircle2,
  Lightbulb,
  Copy,
  X,
} from "lucide-react";
import { TranscriptSegment } from "../TranscriptViewer";
import { MeetingRecord } from "../../App";
import { useI18n } from "../../locales/i18nContext";
import { LiveSuggestionItem } from "../../types/suggestions";

interface LiveFeedViewProps {
  segments: TranscriptSegment[];
  filteredSegments: TranscriptSegment[];
  searchQuery: string;
  isRecording: boolean;
  isRedacting: boolean;
  highlightedSegmentId: number | null;
  editingSpeakerId: string | null;
  editingNameValue: string;
  selectedPastMeeting?: MeetingRecord | null;
  isFillerFilterActive?: boolean;
  fillersRemovedCount?: number;
  cleanedSegmentsMap?: Record<number, string>;
  suggestions?: LiveSuggestionItem[];
  onDismissSuggestion?: (id: string) => void;
  onClearSuggestions?: () => void;
  onToggleFillerFilter?: () => void;
  onRedactTranscript: () => void;
  onStartEditSpeaker: (speakerId: string, currentName: string) => void;
  onSaveSpeakerName: (speakerId: string) => void;
  onCancelEditSpeaker: () => void;
  onEditingNameChange: (val: string) => void;
  onSegmentPlay: (startMs: number) => void;
  onClipSoundbite?: (segment: TranscriptSegment) => void;
  onOpenRetranscribe?: () => void;
}

export const LiveFeedView: React.FC<LiveFeedViewProps> = ({
  segments,
  filteredSegments,
  searchQuery,
  isRecording,
  isRedacting,
  highlightedSegmentId,
  editingSpeakerId,
  editingNameValue,
  selectedPastMeeting,
  isFillerFilterActive = false,
  fillersRemovedCount = 0,
  cleanedSegmentsMap = {},
  suggestions = [],
  onDismissSuggestion,
  onClearSuggestions,
  onToggleFillerFilter,
  onRedactTranscript,
  onStartEditSpeaker,
  onSaveSpeakerName,
  onCancelEditSpeaker,
  onEditingNameChange,
  onSegmentPlay,
  onClipSoundbite,
  onOpenRetranscribe,
}) => {
  const { t } = useI18n();
  const [copiedSuggestionId, setCopiedSuggestionId] = useState<string | null>(
    null,
  );

  const handleCopySuggestion = (suggestion: LiveSuggestionItem) => {
    navigator.clipboard.writeText(
      `${suggestion.text}\n${suggestion.rationale}`,
    );
    setCopiedSuggestionId(suggestion.id);
    setTimeout(() => setCopiedSuggestionId(null), 2000);
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case "question":
        return {
          icon: <HelpCircle className="w-3.5 h-3.5" />,
          label: t("liveSuggestions.smartQuestion") || "Soru Önerisi",
          bg: "bg-purple-950/70 border-purple-500/40 text-purple-300",
        };
      case "objection":
        return {
          icon: <ShieldAlert className="w-3.5 h-3.5" />,
          label: t("liveSuggestions.objectionHandling") || "İtiraz Karşılama",
          bg: "bg-amber-950/70 border-amber-500/40 text-amber-300",
        };
      case "action":
        return {
          icon: <CheckCircle2 className="w-3.5 h-3.5" />,
          label: t("liveSuggestions.actionClue") || "Aksiyon İpucu",
          bg: "bg-emerald-950/70 border-emerald-500/40 text-emerald-300",
        };
      case "insight":
      default:
        return {
          icon: <Lightbulb className="w-3.5 h-3.5" />,
          label: t("liveSuggestions.summaryNudge") || "Özet İpucu",
          bg: "bg-yellow-950/70 border-yellow-500/40 text-yellow-300",
        };
    }
  };

  return (
    <div className="max-w-5xl mx-auto w-full space-y-4">
      {segments.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-2 border-b border-white/5">
          <div className="flex items-center gap-2">
            <span className="text-xs 2xl:text-sm text-slate-400">
              {t("transcript.speakerInfo") ||
                "Konuşmacı ayrımı ve zaman damgalı diyalog akışı"}
            </span>
            {isFillerFilterActive && fillersRemovedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-[10px] 2xl:text-xs font-semibold animate-in fade-in duration-200">
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>
                  {t("transcript.fillerFilter.activeBadge", {
                    count: fillersRemovedCount,
                  }) || `${fillersRemovedCount} dolgu kelime temizlendi`}
                </span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Filler Words Filter Toggle */}
            {onToggleFillerFilter && (
              <button
                onClick={onToggleFillerFilter}
                className={`px-3 py-1.5 rounded-xl border text-xs 2xl:text-sm font-medium transition flex items-center gap-1.5 cursor-pointer ${
                  isFillerFilterActive
                    ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white border-cyan-400/50 shadow-md shadow-cyan-900/40"
                    : "bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-700"
                }`}
                title={
                  isFillerFilterActive
                    ? t("transcript.fillerFilter.tooltipOriginal") ||
                      "Ham transkripte dön"
                    : t("transcript.fillerFilter.tooltipClean") ||
                      "Dolgu kelimeleri ve takılmaları temizle"
                }
              >
                <Sparkles
                  className={`w-3.5 h-3.5 ${
                    isFillerFilterActive
                      ? "text-amber-300 fill-amber-300"
                      : "text-slate-400"
                  }`}
                />
                <span>
                  {t("transcript.fillerFilter.toggle") || "Konuşmayı Netleştir"}
                </span>
              </button>
            )}

            {/* Smart Redaction Button (Only for past meetings) */}
            {selectedPastMeeting && (
              <button
                onClick={onRedactTranscript}
                disabled={isRedacting}
                className="px-3 py-1.5 rounded-xl bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-500/30 text-xs 2xl:text-sm font-medium transition flex items-center gap-1.5 disabled:opacity-50"
                title="Ses tanıma (ASR) ve fonetik kelime hatalarını yapay zeka ile otomatik düzelt"
              >
                <Wand2
                  className={`w-3.5 h-3.5 ${isRedacting ? "animate-spin" : ""}`}
                />
                <span>
                  {isRedacting
                    ? t("transcript.redacting") || "Redakte Ediliyor..."
                    : t("transcript.smartRedaction") ||
                      "✍️ Akıllı Redaksiyon & Düzeltme"}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Live Smart Suggestions Panel */}
      {suggestions && suggestions.length > 0 && (
        <div
          data-testid="live-suggestions-panel"
          className="p-4 rounded-2xl bg-gradient-to-br from-purple-950/40 via-slate-900/60 to-indigo-950/40 border border-purple-500/30 backdrop-blur-md shadow-xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-300"
        >
          <div className="flex items-center justify-between pb-1 border-b border-purple-500/20">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
              </span>
              <h4 className="text-xs 2xl:text-sm font-bold text-purple-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                {t("liveSuggestions.title") || "Canlı Akıllı Öneriler"}
              </h4>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-900/60 text-purple-300 border border-purple-500/30">
                {suggestions.length}{" "}
                {t("liveSuggestions.badge") || "Canlı Asistan"}
              </span>
            </div>

            {onClearSuggestions && (
              <button
                onClick={onClearSuggestions}
                className="text-[11px] text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                {t("common.delete") || "Temizle"}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {suggestions.map((item) => {
              const badge = getCategoryBadge(item.category);
              const isCopied = copiedSuggestionId === item.id;

              return (
                <div
                  key={item.id}
                  data-testid={`suggestion-card-${item.id}`}
                  className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-purple-500/40 transition-all flex flex-col justify-between gap-2 shadow-sm"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] 2xl:text-xs font-semibold border ${badge.bg}`}
                      >
                        {badge.icon}
                        <span>{badge.label}</span>
                      </span>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleCopySuggestion(item)}
                          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                          title={
                            t("liveSuggestions.copyTooltip") ||
                            "Öneriyi kopyala"
                          }
                        >
                          {isCopied ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                        {onDismissSuggestion && (
                          <button
                            onClick={() => onDismissSuggestion(item.id)}
                            className="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-800 transition cursor-pointer"
                            title={t("liveSuggestions.dismiss") || "Kapat"}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    <h5 className="text-xs 2xl:text-sm font-semibold text-slate-100">
                      {item.text}
                    </h5>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {item.rationale}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {filteredSegments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500 space-y-3">
          <MessageSquare className="w-8 h-8 text-slate-600" />
          <p className="text-sm">
            {searchQuery
              ? t("transcript.noSearchResults") ||
                "Aramanızla eşleşen konuşma bulunamadı."
              : isRecording
                ? t("transcript.listeningLive") ||
                  "Konuşmalar dinleniyor, anlık yazıya dökülecek..."
                : t("transcript.noRecordings") ||
                  "Henüz bir konuşma kaydı bulunmuyor."}
          </p>
          {!isRecording &&
            !searchQuery &&
            selectedPastMeeting &&
            selectedPastMeeting.audio_file_path &&
            onOpenRetranscribe && (
              <button
                onClick={onOpenRetranscribe}
                className="mt-3 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-lg shadow-cyan-950/50 flex items-center gap-2 transition cursor-pointer"
              >
                <Zap className="w-4 h-4" />
                <span>Model Seç ve Çözümle</span>
              </button>
            )}
        </div>
      ) : (
        filteredSegments.map((seg) => {
          const isUser =
            seg.speaker_name.toLowerCase().includes("ben") ||
            seg.speaker_name.toLowerCase().includes("user") ||
            seg.speaker_name.toLowerCase().includes("mikrofon");
          const isHighlighted = highlightedSegmentId === seg.id;
          const displaySpeechText =
            isFillerFilterActive && cleanedSegmentsMap[seg.id]
              ? cleanedSegmentsMap[seg.id]
              : seg.text;

          return (
            <div
              key={seg.id}
              id={`segment-${seg.id}`}
              className={`p-4 2xl:p-5 rounded-2xl border transition-all duration-300 ${
                isHighlighted
                  ? "bg-cyan-950/60 border-cyan-400 shadow-lg shadow-cyan-950/50 scale-[1.005]"
                  : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700"
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                {/* Speaker Name with Inline Rename Option */}
                <div className="flex items-center gap-2">
                  <div
                    className={`p-1.5 px-2.5 rounded-lg text-xs 2xl:text-sm font-semibold ${
                      isUser
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                    }`}
                  >
                    <User className="w-3.5 h-3.5 inline mr-1.5" />
                    {editingSpeakerId === seg.speaker_id ? (
                      <div
                        className="inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={editingNameValue}
                          onChange={(e) => onEditingNameChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              onSaveSpeakerName(seg.speaker_id);
                            if (e.key === "Escape") onCancelEditSpeaker();
                          }}
                          autoFocus
                          className="bg-slate-950 border border-cyan-400 rounded px-1.5 py-0.5 text-xs 2xl:text-sm text-white focus:outline-none"
                        />
                        <button
                          onClick={() => onSaveSpeakerName(seg.speaker_id)}
                          className="p-0.5 text-emerald-400 hover:text-emerald-300"
                          title={t("common.save") || "Kaydet"}
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <span>{seg.speaker_name}</span>
                    )}
                  </div>

                  {editingSpeakerId !== seg.speaker_id && (
                    <button
                      onClick={() =>
                        onStartEditSpeaker(seg.speaker_id, seg.speaker_name)
                      }
                      className="text-slate-500 hover:text-slate-300 p-0.5 transition"
                      title={t("transcript.renameSpeaker") || "İsmi Değiştir"}
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Timestamp & Play Segment & Clip Soundbite Buttons */}
                <div className="flex items-center gap-2">
                  {selectedPastMeeting?.audio_file_path && (
                    <button
                      onClick={() => onSegmentPlay(seg.start_time_ms)}
                      className="p-1 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition"
                      title={t("transcript.playSentence") || "Bu Cümleyi Dinle"}
                    >
                      <Play className="w-3.5 h-3.5 fill-slate-400 hover:fill-cyan-300" />
                    </button>
                  )}
                  {selectedPastMeeting?.audio_file_path && onClipSoundbite && (
                    <button
                      onClick={() => onClipSoundbite(seg)}
                      className="p-1 rounded-md text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition"
                      title={
                        t("transcript.clipSoundbite") ||
                        "✂️ Ses Parçası Kırp (Soundbite)"
                      }
                    >
                      <Scissors className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <span className="text-xs 2xl:text-sm font-mono text-slate-400">
                    {seg.timestamp_formatted}
                  </span>
                  <span className="text-[10px] 2xl:text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
                    #{seg.id}
                  </span>
                </div>
              </div>

              {/* Speech Text */}
              <p className="text-sm 2xl:text-base text-slate-100 leading-relaxed pl-1 pt-1 font-normal">
                {displaySpeechText}
              </p>
            </div>
          );
        })
      )}
    </div>
  );
};
