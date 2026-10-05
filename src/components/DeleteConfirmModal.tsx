import React from "react";
import { Trash2, AlertTriangle, Calendar, Clock } from "lucide-react";
import { ModalShell } from "./ui/ModalShell";
import { MeetingRecord } from "../App";
import { useI18n } from "../locales/i18nContext";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  meeting: MeetingRecord | null;
  onConfirm: () => void;
  onClose: () => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  meeting,
  onConfirm,
  onClose,
}) => {
  const { t } = useI18n();

  if (!isOpen || !meeting) return null;

  return (
    <ModalShell
      onClose={onClose}
      icon={Trash2}
      tone="danger"
      size="sm"
      title={t("sidebar.deleteMeetingTitle")}
      subtitle={t("sidebar.deleteMeetingConfirm")}
      closeLabel={t("common.close")}
      footer={
        <div className="ml-auto flex items-center gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-xl shadow-lg shadow-rose-600/20 transition flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t("common.delete")}</span>
          </button>
        </div>
      }
    >
      {/* Target Meeting Info Card */}
      <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
        <p className="font-medium text-xs text-slate-200 truncate">
          {meeting.title || "İsimsiz Toplantı"}
        </p>
        <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3 text-slate-500" />
            {meeting.date_formatted}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-slate-500" />
            {meeting.duration_formatted}
          </span>
        </div>
      </div>

      {/* Warning Note */}
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] leading-relaxed">
        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        <span>
          Bu toplantı kaydı, ses dökümü ve yapay zeka analizleri kalıcı olarak
          silinecektir. Bu işlem geri alınamaz.
        </span>
      </div>
    </ModalShell>
  );
};
