import React, { useState } from "react";
import { Tag, Plus, X } from "lucide-react";
import { useI18n } from "../../locales/i18nContext";

interface MeetingTagsBarProps {
  tags?: string[];
  meetingId?: string;
  onAddTag?: (meetingId: string, tag: string) => void;
  onRemoveTag?: (meetingId: string, tag: string) => void;
  readOnly?: boolean;
}

export function getTagColorClass(tag: string): {
  bg: string;
  text: string;
  border: string;
} {
  const lower = tag.toLowerCase();
  if (
    lower.includes("finans") ||
    lower.includes("bütçe") ||
    lower.includes("finance") ||
    lower.includes("budget") ||
    lower.includes("finanz")
  ) {
    return {
      bg: "bg-emerald-950/60",
      text: "text-emerald-300",
      border: "border-emerald-500/40",
    };
  }
  if (
    lower.includes("yönetim") ||
    lower.includes("strateji") ||
    lower.includes("management") ||
    lower.includes("strategy") ||
    lower.includes("führung")
  ) {
    return {
      bg: "bg-indigo-950/60",
      text: "text-indigo-300",
      border: "border-indigo-500/40",
    };
  }
  if (
    lower.includes("yazılım") ||
    lower.includes("teknoloji") ||
    lower.includes("tech") ||
    lower.includes("software") ||
    lower.includes("code")
  ) {
    return {
      bg: "bg-cyan-950/60",
      text: "text-cyan-300",
      border: "border-cyan-500/40",
    };
  }
  if (
    lower.includes("tasarım") ||
    lower.includes("design") ||
    lower.includes("ui") ||
    lower.includes("ux")
  ) {
    return {
      bg: "bg-fuchsia-950/60",
      text: "text-fuchsia-300",
      border: "border-fuchsia-500/40",
    };
  }
  if (
    lower.includes("satış") ||
    lower.includes("müşteri") ||
    lower.includes("sales") ||
    lower.includes("client") ||
    lower.includes("vertrieb")
  ) {
    return {
      bg: "bg-amber-950/60",
      text: "text-amber-300",
      border: "border-amber-500/40",
    };
  }
  if (
    lower.includes("pazarlama") ||
    lower.includes("marketing") ||
    lower.includes("growth") ||
    lower.includes("croissance")
  ) {
    return {
      bg: "bg-rose-950/60",
      text: "text-rose-300",
      border: "border-rose-500/40",
    };
  }
  if (
    lower.includes("insan") ||
    lower.includes("i̇nsan") ||
    lower.includes("kaynak") ||
    lower.includes("ik") ||
    lower.includes("hr") ||
    lower.includes("recruitment") ||
    lower.includes("personal")
  ) {
    return {
      bg: "bg-violet-950/60",
      text: "text-violet-300",
      border: "border-violet-500/40",
    };
  }
  if (
    lower.includes("sprint") ||
    lower.includes("operasyon") ||
    lower.includes("operations") ||
    lower.includes("agile")
  ) {
    return {
      bg: "bg-yellow-950/60",
      text: "text-yellow-300",
      border: "border-yellow-500/40",
    };
  }
  return {
    bg: "bg-slate-800/80",
    text: "text-slate-200",
    border: "border-slate-700/60",
  };
}

export const MeetingTagsBar: React.FC<MeetingTagsBarProps> = ({
  tags = [],
  meetingId,
  onAddTag,
  onRemoveTag,
  readOnly = false,
}) => {
  const { t } = useI18n();
  const [isAdding, setIsAdding] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");

  const handleSave = () => {
    if (!meetingId || !newTagInput.trim() || !onAddTag) {
      setIsAdding(false);
      setNewTagInput("");
      return;
    }
    onAddTag(meetingId, newTagInput.trim());
    setNewTagInput("");
    setIsAdding(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setIsAdding(false);
      setNewTagInput("");
    }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <div className="flex items-center gap-1 text-[11px] text-slate-400 font-medium mr-1">
        <Tag className="w-3.5 h-3.5 text-slate-500" />
        <span>{t("tags.title") || "Etiketler"}:</span>
      </div>

      {tags.length === 0 && !isAdding && (
        <span className="text-[11px] text-slate-500 italic">
          {t("tags.noTags") || "Etiket yok"}
        </span>
      )}

      {tags.map((tag, idx) => {
        const colors = getTagColorClass(tag);
        return (
          <span
            key={idx}
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-medium border transition ${colors.bg} ${colors.text} ${colors.border}`}
          >
            <span>{tag}</span>
            {!readOnly && meetingId && onRemoveTag && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveTag(meetingId, tag);
                }}
                className="p-0.5 hover:bg-white/20 rounded text-slate-400 hover:text-white transition"
                title={t("tags.removeTag") || "Etiketi Kaldır"}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </span>
        );
      })}

      {!readOnly && meetingId && onAddTag && (
        <>
          {isAdding ? (
            <div className="inline-flex items-center gap-1">
              <input
                type="text"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSave}
                autoFocus
                placeholder={t("tags.addTagPlaceholder") || "Yeni etiket..."}
                className="px-2 py-0.5 bg-slate-950 border border-cyan-500 rounded-lg text-[11px] text-white focus:outline-none w-28"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-dashed border-slate-700 hover:border-slate-500 text-[11px] text-slate-400 hover:text-cyan-300 transition"
              title={t("tags.addTag") || "Etiket Ekle"}
            >
              <Plus className="w-3 h-3" />
              <span>{t("tags.addTag") || "Ekle"}</span>
            </button>
          )}
        </>
      )}
    </div>
  );
};
