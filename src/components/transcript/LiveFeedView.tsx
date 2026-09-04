import React from "react";
import {
  MessageSquare,
  Wand2,
  User,
  Edit2,
  Check,
  Play,
  Zap,
} from "lucide-react";
import { TranscriptSegment } from "../TranscriptViewer";
import { MeetingRecord } from "../../App";
import { useI18n } from "../../locales/i18nContext";

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
  onRedactTranscript: () => void;
  onStartEditSpeaker: (speakerId: string, currentName: string) => void;
  onSaveSpeakerName: (speakerId: string) => void;
  onCancelEditSpeaker: () => void;
  onEditingNameChange: (val: string) => void;
  onSegmentPlay: (startMs: number) => void;
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
  onRedactTranscript,
  onStartEditSpeaker,
  onSaveSpeakerName,
  onCancelEditSpeaker,
  onEditingNameChange,
  onSegmentPlay,
  onOpenRetranscribe,
}) => {
  const { t } = useI18n();

  return (
    <div className="max-w-5xl mx-auto w-full space-y-4">
      {selectedPastMeeting && segments.length > 0 && (
        <div className="flex items-center justify-between pb-3 mb-2 border-b border-white/5">
          <span className="text-xs 2xl:text-sm text-slate-400">
            {t("transcript.speakerInfo") ||
              "Konuşmacı ayrımı ve zaman damgalı diyalog akışı"}
          </span>
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

                {/* Timestamp & Play Segment Button */}
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
                {seg.text}
              </p>
            </div>
          );
        })
      )}
    </div>
  );
};
