import React from "react";
import {
  Target,
  Lightbulb,
  CheckSquare,
  Square,
  UserCheck,
  Layers,
  Clock,
  FolderOpen,
  Users,
  Sparkles,
  Wand2,
  Download,
  RotateCw,
  Languages,
  Loader2,
} from "lucide-react";
import { SummaryResult, SUMMARY_LANGUAGES } from "../TranscriptViewer";
import { MeetingRecord } from "../../App";
import { useI18n } from "../../locales/i18nContext";

interface SummaryCardsViewProps {
  richSummary: SummaryResult | null;
  summaryLang: string;
  isTranslating: boolean;
  selectedPastMeeting?: MeetingRecord | null;
  onLanguageChange: (langCode: string) => void;
  onToggleActionItem: (index: number) => void;
  onJumpToCitation: (citationIndex: number) => void;
  onGenerateSummary: () => void;
  onOpenRetranscribe: () => void;
  onExportNotes: () => void;
}

export const SummaryCardsView: React.FC<SummaryCardsViewProps> = ({
  richSummary,
  summaryLang,
  isTranslating,
  selectedPastMeeting,
  onLanguageChange,
  onToggleActionItem,
  onJumpToCitation,
  onGenerateSummary,
  onOpenRetranscribe,
  onExportNotes,
}) => {
  const { t } = useI18n();

  return (
    <div className="max-w-5xl mx-auto w-full space-y-5 pb-8">
      {/* Top Controls: Language & Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-sm">
        {/* Language Selector */}
        <div className="flex items-center gap-2.5">
          <Languages className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="text-xs sm:text-sm font-semibold text-slate-300">
            {t("summary.translateTo")}
          </span>
          <div className="relative inline-flex items-center">
            <select
              value={summaryLang}
              onChange={(e) => onLanguageChange(e.target.value)}
              disabled={isTranslating || !richSummary}
              className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs sm:text-sm font-medium text-slate-100 hover:border-cyan-500 focus:border-cyan-500 focus:outline-none cursor-pointer transition disabled:opacity-50"
            >
              {SUMMARY_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
            {isTranslating && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 ml-2" />
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {selectedPastMeeting && (
            <button
              onClick={onOpenRetranscribe}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs sm:text-sm font-medium transition flex items-center gap-1.5"
              title={t("transcript.retranscribeTooltip")}
            >
              <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
              <span>{t("summary.changeModelAndRetranscribe")}</span>
            </button>
          )}

          {selectedPastMeeting && (
            <button
              onClick={onExportNotes}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs sm:text-sm font-medium transition flex items-center gap-1.5"
              title={t("summary.downloadMarkdown")}
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>{t("summary.downloadMarkdown")}</span>
            </button>
          )}
        </div>
      </div>

      {/* 1. 🎯 Toplantı Amacı (Purpose / Goal) */}
      {richSummary?.meeting_goal && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-cyan-950/40 to-blue-950/30 border border-cyan-500/30 space-y-2">
          <h4 className="text-xs sm:text-sm 2xl:text-base font-semibold text-cyan-300 flex items-center gap-2">
            <Target className="w-4 h-4 2xl:w-5 2xl:h-5 text-cyan-400" />
            {t("summary.purpose")}
          </h4>
          <p className="text-sm 2xl:text-base text-slate-100 leading-relaxed font-normal">
            {richSummary.meeting_goal}
          </p>
        </div>
      )}

      {/* 2. 💡 Alınan Dersler & Ana Çıkarımlar (Key Highlights) */}
      {richSummary?.key_highlights && richSummary.key_highlights.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-3">
          <h4 className="text-xs sm:text-sm 2xl:text-base font-semibold text-amber-300 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 2xl:w-5 2xl:h-5 text-amber-400" />
            {t("summary.keyHighlights")}
          </h4>
          <ul className="space-y-2 text-sm 2xl:text-base text-slate-200">
            {richSummary.key_highlights.map((item, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2.5 leading-relaxed"
              >
                <span className="text-amber-400 font-bold mt-0.5">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. ✅ Eylem Maddeleri & Sorumlu Kişiler */}
      {richSummary?.action_items && richSummary.action_items.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-3.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs sm:text-sm 2xl:text-base font-semibold text-emerald-300 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 2xl:w-5 2xl:h-5 text-emerald-400" />
              {t("summary.actionItems")} ({richSummary.action_items.length})
            </h4>
            <span className="text-xs 2xl:text-sm text-slate-400">
              {richSummary.action_items.filter((a) => a.is_completed).length} /{" "}
              {richSummary.action_items.length} {t("common.saved")}
            </span>
          </div>

          <div className="space-y-2.5">
            {richSummary.action_items.map((act, idx) => (
              <div
                key={idx}
                className={`p-3.5 2xl:p-4 rounded-xl border transition-all flex items-start justify-between gap-3.5 ${
                  act.is_completed
                    ? "bg-slate-950/40 border-slate-800/60 opacity-60"
                    : "bg-slate-950/80 border-slate-800 hover:border-emerald-500/40"
                }`}
              >
                <div className="flex items-start gap-3 flex-1">
                  <button
                    onClick={() => onToggleActionItem(idx)}
                    className="mt-0.5 text-slate-400 hover:text-emerald-400 transition"
                  >
                    {act.is_completed ? (
                      <CheckSquare className="w-4 h-4 2xl:w-5 2xl:h-5 text-emerald-400" />
                    ) : (
                      <Square className="w-4 h-4 2xl:w-5 2xl:h-5 text-slate-500 hover:text-slate-300" />
                    )}
                  </button>
                  <div className="space-y-1.5 flex-1">
                    <p
                      className={`text-sm 2xl:text-base text-slate-100 leading-relaxed font-normal ${
                        act.is_completed ? "line-through text-slate-400" : ""
                      }`}
                    >
                      {act.task}
                    </p>
                    {act.assignee && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-cyan-950/60 border border-cyan-500/30 text-xs 2xl:text-sm text-cyan-300 font-medium">
                        <UserCheck className="w-3.5 h-3.5" />
                        {act.assignee}
                      </span>
                    )}
                  </div>
                </div>

                {/* Numbered Citation Badges */}
                {act.source_citations && act.source_citations.length > 0 && (
                  <div className="flex items-center gap-1 shrink-0">
                    {act.source_citations.map((cite) => (
                      <button
                        key={cite}
                        onClick={() => onJumpToCitation(cite)}
                        className="w-6 h-6 rounded-full bg-slate-800 hover:bg-cyan-500/30 border border-slate-700 hover:border-cyan-400 text-xs font-mono text-cyan-300 flex items-center justify-center transition"
                        title={`Transkript #${cite} referansına git`}
                      >
                        {cite}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. ⚡ Aşama 1 — Mutabakat Sağlanan Değişiklikler */}
      {richSummary?.phase1_agreed && richSummary.phase1_agreed.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-3">
          <h4 className="text-xs sm:text-sm 2xl:text-base font-semibold text-cyan-300 flex items-center gap-2">
            <Layers className="w-4 h-4 2xl:w-5 2xl:h-5 text-cyan-400" />
            {t("summary.phase1")}
          </h4>
          <ul className="space-y-2 text-sm 2xl:text-base text-slate-200">
            {richSummary.phase1_agreed.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 leading-relaxed">
                <span className="text-cyan-400 font-bold">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. ⏳ Aşama 2 — Geleceğe Ertelenen Maddeler */}
      {richSummary?.phase2_deferred &&
        richSummary.phase2_deferred.length > 0 && (
          <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-3">
            <h4 className="text-xs sm:text-sm 2xl:text-base font-semibold text-purple-300 flex items-center gap-2">
              <Clock className="w-4 h-4 2xl:w-5 2xl:h-5 text-purple-400" />
              {t("summary.phase2")}
            </h4>
            <ul className="space-y-2 text-sm 2xl:text-base text-slate-200">
              {richSummary.phase2_deferred.map((item, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 leading-relaxed"
                >
                  <span className="text-purple-400 font-bold">⏳</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

      {/* 6. 📂 Konu Başlıklarına Göre Detaylı Özet */}
      {richSummary?.detailed_topics &&
        richSummary.detailed_topics.length > 0 && (
          <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-3.5">
            <h4 className="text-xs sm:text-sm 2xl:text-base font-semibold text-slate-200 flex items-center gap-2">
              <FolderOpen className="w-4 h-4 2xl:w-5 2xl:h-5 text-indigo-400" />
              {t("summary.topics")}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {richSummary.detailed_topics.map((tItem, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2"
                >
                  <h5 className="text-xs sm:text-sm 2xl:text-base font-semibold text-indigo-300">
                    {tItem.topic_title}
                  </h5>
                  <ul className="space-y-1.5 text-xs sm:text-sm 2xl:text-base text-slate-300">
                    {tItem.bullet_points.map((b, bIdx) => (
                      <li
                        key={bIdx}
                        className="flex items-start gap-2 leading-relaxed"
                      >
                        <span className="text-indigo-400">•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

      {/* 7. 👥 Katılımcılar */}
      {richSummary?.participants && richSummary.participants.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-2.5">
          <h4 className="text-xs sm:text-sm 2xl:text-base font-semibold text-slate-300 flex items-center gap-2">
            <Users className="w-4 h-4 2xl:w-5 2xl:h-5 text-slate-400" />
            {t("summary.participants")}
          </h4>
          <div className="flex items-center gap-2 flex-wrap">
            {richSummary.participants.map((p, idx) => (
              <span
                key={idx}
                className="px-3.5 py-1.5 rounded-full bg-slate-800 text-xs sm:text-sm text-slate-200 font-medium border border-slate-700"
              >
                👤 {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Default Placeholder if no summary is available */}
      {!richSummary && (
        <div className="p-8 text-center text-slate-500 text-sm border border-dashed border-white/10 rounded-2xl space-y-3">
          <Sparkles className="w-8 h-8 text-slate-600 mx-auto" />
          <p>{t("summary.emptySummary")}</p>
          {selectedPastMeeting && (
            <button
              onClick={onGenerateSummary}
              className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-xs sm:text-sm shadow-md shadow-cyan-600/20 transition inline-flex items-center gap-2"
            >
              <Wand2 className="w-4 h-4" />
              <span>{t("summary.rebuildReport")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
