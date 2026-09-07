import React from "react";
import {
  BarChart3,
  Clock,
  Users,
  Award,
  Zap,
  X,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { MeetingAnalytics } from "../../types/analytics";
import { useI18n } from "../../locales/i18nContext";

interface MeetingAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  analytics: MeetingAnalytics | null;
  meetingTitle?: string;
}

export const MeetingAnalyticsModal: React.FC<MeetingAnalyticsModalProps> = ({
  isOpen,
  onClose,
  analytics,
  meetingTitle,
}) => {
  const { t } = useI18n();

  if (!isOpen || !analytics) return null;

  const formatSecs = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    if (score >= 50) return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    return "text-rose-400 bg-rose-500/10 border-rose-500/20";
  };

  const getScoreBadgeText = (score: number) => {
    if (score >= 80) return "🌟 Dengeli & Katılımcı";
    if (score >= 50) return "⚖️ Orta Düzey Denge";
    return "⚠️ Monolog / Baskın Konuşmacı";
  };

  const speakerColors = [
    "from-indigo-500 to-purple-600",
    "from-blue-500 to-cyan-500",
    "from-emerald-500 to-teal-500",
    "from-amber-500 to-orange-500",
    "from-rose-500 to-pink-500",
    "from-violet-500 to-fuchsia-500",
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="analytics-modal-title"
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800 bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 id="analytics-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
                {t("transcript.analytics.modalTitle")}
              </h2>
              <p className="text-xs text-slate-400">
                {meetingTitle ? `${meetingTitle} • ` : ""}
                {t("transcript.analytics.modalSubtitle")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title={t("transcript.analytics.close")}
            aria-label={t("transcript.analytics.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {/* Top KPI Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Balance Score Card */}
            <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <Award className="w-4 h-4 text-indigo-400" />
                  {t("transcript.analytics.balanceScore")}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getScoreColor(analytics.meeting_balance_score)}`}>
                  {getScoreBadgeText(analytics.meeting_balance_score)}
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-extrabold text-white">
                  %{analytics.meeting_balance_score}
                </span>
                <span className="text-xs text-slate-400">/ 100</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                {t("transcript.analytics.balanceScoreDesc")}
              </p>
            </div>

            {/* Talk vs Silence Card */}
            <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <Clock className="w-4 h-4 text-cyan-400" />
                  {t("transcript.analytics.talkTime")}
                </span>
                <span className="text-[11px] font-mono text-cyan-300">
                  {formatSecs(analytics.total_speech_seconds)}
                </span>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-slate-700/60 rounded-full h-2.5 overflow-hidden flex my-2">
                <div
                  className="bg-cyan-500 h-full transition-all duration-500"
                  style={{ width: `${Math.max(0, 100 - analytics.silence_percentage)}%` }}
                  title={`${t("transcript.analytics.talkTime")}: %${(100 - analytics.silence_percentage).toFixed(1)}`}
                />
                <div
                  className="bg-slate-600 h-full transition-all duration-500"
                  style={{ width: `${analytics.silence_percentage}%` }}
                  title={`${t("transcript.analytics.silenceTime")}: %${analytics.silence_percentage.toFixed(1)}`}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{t("transcript.analytics.silenceTime")}: %{analytics.silence_percentage.toFixed(0)}</span>
                <span>{formatSecs(analytics.total_duration_seconds)}</span>
              </div>
            </div>

            {/* Speaking Pace & WPM */}
            <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <Zap className="w-4 h-4 text-amber-400" />
                  {t("transcript.analytics.pace")}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  {analytics.meeting_pace_label}
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-extrabold text-white">
                  {analytics.average_wpm}
                </span>
                <span className="text-xs text-slate-400">{t("transcript.analytics.wpm")}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
                <span>{t("transcript.analytics.totalWords")}:</span>
                <span className="font-semibold text-slate-200">{analytics.total_words.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Participant Breakdown Section */}
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-700/40 pb-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-400" />
                {t("transcript.analytics.speakerStatsTitle")} ({analytics.speaker_stats.length})
              </h3>
              {analytics.dominant_speaker && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-amber-400" />
                  {t("transcript.analytics.dominantSpeaker")}: <strong className="text-slate-200">{analytics.dominant_speaker}</strong> (%{analytics.dominant_speaker_percentage.toFixed(0)})
                </span>
              )}
            </div>

            <div className="space-y-4">
              {analytics.speaker_stats.map((spk, idx) => {
                const colorGradient = speakerColors[idx % speakerColors.length];
                return (
                  <div key={spk.speaker_id || idx} className="space-y-2 p-3 rounded-lg bg-slate-800/40 border border-slate-700/30">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 font-medium text-slate-200">
                        <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${colorGradient}`} />
                        <span>{spk.speaker_name}</span>
                        <span className="text-slate-500 font-mono">({spk.segment_count} {t("transcript.analytics.segments")})</span>
                      </div>
                      <div className="flex items-center gap-3 font-mono text-slate-300">
                        <span>{formatSecs(spk.total_speech_seconds)}</span>
                        <span className="font-bold text-white">%{spk.talk_percentage.toFixed(1)}</span>
                      </div>
                    </div>

                    {/* Speaker Bar */}
                    <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r ${colorGradient} transition-all duration-500`}
                        style={{ width: `${spk.talk_percentage}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3 h-3 text-slate-500" />
                        {spk.word_count} kelime • {spk.wpm} WPM
                      </span>
                      {spk.longest_monologue_seconds > 0 && (
                        <span className="text-slate-500">
                          {t("transcript.analytics.longestMonologue")}: {formatSecs(spk.longest_monologue_seconds)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI Insights Section */}
          {analytics.key_insights && analytics.key_insights.length > 0 && (
            <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-xl p-4 space-y-2">
              <h3 className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                {t("transcript.analytics.insightsTitle")}
              </h3>
              <ul className="space-y-1.5">
                {analytics.key_insights.map((insight, i) => (
                  <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                    <span className="text-indigo-400 font-bold">•</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-800/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-medium bg-slate-700 hover:bg-slate-600 text-white transition-colors shadow-sm"
          >
            {t("transcript.analytics.close")}
          </button>
        </div>
      </div>
    </div>
  );
};
