import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Sparkles,
  Calendar,
  ArrowRight,
  Tag,
  Users,
  Loader2,
} from "lucide-react";
import { RelatedMeetingItem } from "../../App";
import { useI18n } from "../../locales/i18nContext";
import { getTagColorClass } from "./MeetingTagsBar";

interface RelatedMeetingsCardProps {
  meetingId?: string;
  onSelectMeeting?: (meetingId: string) => void;
}

export const RelatedMeetingsCard: React.FC<RelatedMeetingsCardProps> = ({
  meetingId,
  onSelectMeeting,
}) => {
  const { t } = useI18n();
  const [relatedList, setRelatedList] = useState<RelatedMeetingItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!meetingId) {
      setRelatedList([]);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    const fetchRelated = async () => {
      try {
        const res = await invoke<RelatedMeetingItem[]>("get_related_meetings", {
          meetingId,
          maxResults: 4,
        });
        if (isMounted) {
          setRelatedList(Array.isArray(res) ? res : []);
        }
      } catch (err) {
        if (isMounted) setRelatedList([]);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchRelated();

    return () => {
      isMounted = false;
    };
  }, [meetingId]);

  if (!meetingId) return null;

  const validList = Array.isArray(relatedList) ? relatedList : [];

  return (
    <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900/90 to-[#121c2d]/90 border border-slate-800/80 shadow-lg space-y-3.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-950/60 border border-cyan-500/30 text-cyan-400">
            <Sparkles className="w-4 h-4 2xl:w-5 2xl:h-5 text-cyan-400" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm 2xl:text-base font-semibold text-white">
              {t("relatedMeetings.title") || "İlgili Geçmiş Toplantılar"}
            </h4>
            <p className="text-[11px] 2xl:text-xs text-slate-400">
              {t("relatedMeetings.subtitle") ||
                "Mevcut toplantıyla anlamsal, etiket ve konu bağı olan geçmiş görüşmeler"}
            </p>
          </div>
        </div>
        {isLoading && (
          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
          <span>{t("common.loading") || "Yükleniyor..."}</span>
        </div>
      ) : validList.length === 0 ? (
        <div className="py-5 text-center text-xs text-slate-500 border border-dashed border-white/5 rounded-xl px-4">
          <p className="font-medium text-slate-400">
            {t("relatedMeetings.noRelatedMeetings") ||
              "İlgili geçmiş toplantı bulunamadı"}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {t("relatedMeetings.noRelatedMeetingsDesc") ||
              "Benzer etiket, anahtar kelime veya katılımcıya sahip başka bir toplantı henüz yok."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {validList.map((item) => {
            const matchPercentage = Math.round(item.similarity_score * 100);
            return (
              <div
                key={item.id}
                onClick={() => onSelectMeeting && onSelectMeeting(item.id)}
                className="p-3.5 rounded-xl bg-slate-950/60 hover:bg-slate-900 border border-white/5 hover:border-cyan-500/40 transition cursor-pointer group flex flex-col justify-between space-y-2.5"
              >
                {/* Top: Title & Score Badge */}
                <div className="flex items-start justify-between gap-2">
                  <h5 className="font-semibold text-xs 2xl:text-sm text-slate-200 group-hover:text-cyan-300 transition line-clamp-1">
                    {item.title}
                  </h5>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${
                      matchPercentage >= 70
                        ? "bg-emerald-950/70 text-emerald-300 border-emerald-500/40"
                        : matchPercentage >= 40
                          ? "bg-cyan-950/70 text-cyan-300 border-cyan-500/40"
                          : "bg-slate-800 text-slate-300 border-slate-700"
                    }`}
                  >
                    %{matchPercentage}{" "}
                    {t("relatedMeetings.similarityScore") || "Benzer"}
                  </span>
                </div>

                {/* Shared info (Tags & Participants) */}
                <div className="flex items-center gap-2 flex-wrap text-[10px] 2xl:text-[11px]">
                  {item.shared_tags && item.shared_tags.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <Tag className="w-2.5 h-2.5 text-slate-500" />
                      {item.shared_tags.map((tName, tIdx) => {
                        const colors = getTagColorClass(tName);
                        return (
                          <span
                            key={tIdx}
                            className={`px-1.5 py-0.2 rounded text-[10px] border ${colors.bg} ${colors.text} ${colors.border}`}
                          >
                            {tName}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {item.shared_participants &&
                    item.shared_participants.length > 0 && (
                      <div className="flex items-center gap-1 text-slate-400 font-mono">
                        <Users className="w-2.5 h-2.5 text-slate-500" />
                        <span>{item.shared_participants.join(", ")}</span>
                      </div>
                    )}
                </div>

                {/* Bottom: Date & Jump Link */}
                <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1 font-mono text-[10px]">
                    <Calendar className="w-3 h-3 text-slate-500" />
                    {item.date_formatted}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onSelectMeeting) onSelectMeeting(item.id);
                    }}
                    className="inline-flex items-center gap-1 text-cyan-400 group-hover:text-cyan-300 font-medium text-[11px] hover:underline"
                  >
                    <span>
                      {t("relatedMeetings.jumpToMeeting") || "Toplantıya Git"}
                    </span>
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
