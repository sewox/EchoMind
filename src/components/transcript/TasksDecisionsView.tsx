import React from "react";
import { CheckSquare, Square, UserCheck } from "lucide-react";
import { ActionItem } from "../../App";
import { useI18n } from "../../locales/i18nContext";

interface TasksDecisionsViewProps {
  actionItems: ActionItem[];
  onToggleActionItem: (index: number) => void;
  onJumpToCitation: (citationIndex: number) => void;
}

export const TasksDecisionsView: React.FC<TasksDecisionsViewProps> = ({
  actionItems,
  onToggleActionItem,
  onJumpToCitation,
}) => {
  const { t } = useI18n();

  if (!actionItems || actionItems.length === 0) {
    return (
      <div className="py-16 text-center text-slate-500 text-xs">
        {t("summary.emptyActions") || "Kayıtlı eylem maddesi bulunmuyor."}
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-5xl mx-auto w-full">
      {actionItems.map((act, idx) => (
        <div
          key={idx}
          className={`p-4 rounded-2xl border transition-all flex items-start justify-between gap-4 ${
            act.is_completed
              ? "bg-slate-950/40 border-slate-800/60 opacity-60"
              : "bg-slate-900/80 border-slate-800 hover:border-emerald-500/40 shadow-sm"
          }`}
        >
          <div className="flex items-start gap-3.5 flex-1">
            <button
              onClick={() => onToggleActionItem(idx)}
              className="mt-0.5 text-slate-400 hover:text-emerald-400 transition"
            >
              {act.is_completed ? (
                <CheckSquare className="w-5 h-5 text-emerald-400" />
              ) : (
                <Square className="w-5 h-5 text-slate-500 hover:text-slate-300" />
              )}
            </button>
            <div className="space-y-1.5 flex-1">
              <p
                className={`text-xs text-slate-200 leading-relaxed font-medium ${
                  act.is_completed ? "line-through text-slate-400" : ""
                }`}
              >
                {act.task}
              </p>
              {act.assignee && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-cyan-950/70 border border-cyan-500/30 text-xs text-cyan-300 font-medium">
                  <UserCheck className="w-3.5 h-3.5" />
                  {t("summary.responsible")}: {act.assignee}
                </span>
              )}
            </div>
          </div>

          {act.source_citations && act.source_citations.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              {act.source_citations.map((cite) => (
                <button
                  key={cite}
                  onClick={() => onJumpToCitation(cite)}
                  className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-cyan-500/30 border border-slate-700 hover:border-cyan-400 text-xs font-mono text-cyan-300 flex items-center gap-1 transition"
                  title={`Transkript #${cite} referansına git`}
                >
                  <span>#{cite}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
