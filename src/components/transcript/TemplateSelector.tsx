import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  UserCheck,
  Layers,
  TrendingUp,
  Lightbulb,
  Sliders,
  ChevronDown,
  Plus,
  Trash2,
  Check,
} from "lucide-react";
import { MeetingTemplate, BUILTIN_TEMPLATES } from "../../types/templates";
import { useI18n } from "../../locales/i18nContext";

interface TemplateSelectorProps {
  selectedTemplateId: string;
  customTemplates: MeetingTemplate[];
  onSelectTemplate: (template: MeetingTemplate) => void;
  onOpenCreateCustom: () => void;
  onDeleteCustomTemplate: (templateId: string) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  selectedTemplateId,
  customTemplates,
  onSelectTemplate,
  onOpenCreateCustom,
  onDeleteCustomTemplate,
}) => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const allTemplates = [...BUILTIN_TEMPLATES, ...customTemplates];
  const activeTemplate =
    allTemplates.find((tpl) => tpl.id === selectedTemplateId) || BUILTIN_TEMPLATES[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const renderIcon = (iconName: string, className = "w-4 h-4") => {
    switch (iconName) {
      case "UserCheck":
        return <UserCheck className={className} />;
      case "Layers":
        return <Layers className={className} />;
      case "TrendingUp":
        return <TrendingUp className={className} />;
      case "Lightbulb":
        return <Lightbulb className={className} />;
      case "Sliders":
        return <Sliders className={className} />;
      case "Sparkles":
      default:
        return <Sparkles className={className} />;
    }
  };

  return (
    <div className="relative inline-flex items-center" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-750 border border-slate-700 hover:border-cyan-500/50 text-slate-200 text-xs sm:text-sm font-medium transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
        title="Toplantı format şablonunu seçin"
        aria-expanded={isOpen}
      >
        <span className="text-cyan-400">{renderIcon(activeTemplate.icon)}</span>
        <span className="truncate max-w-[140px] sm:max-w-[200px]">
          {activeTemplate.name}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 sm:w-80 rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl backdrop-blur-xl z-50 p-2 space-y-1 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            {t("summary.templateTitle") || "Toplantı Şablonları"}
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar pr-1">
            {/* Built-in Templates */}
            {BUILTIN_TEMPLATES.map((template) => {
              const isSelected = template.id === activeTemplate.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    onSelectTemplate(template);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl text-xs transition-colors ${
                    isSelected
                      ? "bg-cyan-500/15 border border-cyan-500/30 text-cyan-200"
                      : "hover:bg-slate-800/70 text-slate-300 hover:text-slate-100"
                  }`}
                >
                  <div
                    className={`mt-0.5 p-1.5 rounded-lg ${
                      isSelected
                        ? "bg-cyan-500/20 text-cyan-300"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {renderIcon(template.icon, "w-3.5 h-3.5")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold flex items-center justify-between">
                      <span className="truncate">{template.name}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                      {template.description}
                    </p>
                  </div>
                </button>
              );
            })}

            {/* Custom Templates Section */}
            {customTemplates.length > 0 && (
              <>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-cyan-400/80 uppercase tracking-wider border-t border-slate-800 mt-2">
                  {t("summary.customTemplates") || "Özel Şablonlarınız"}
                </div>
                {customTemplates.map((template) => {
                  const isSelected = template.id === activeTemplate.id;
                  return (
                    <div
                      key={template.id}
                      className={`group flex items-start justify-between gap-2 p-2.5 rounded-xl text-xs transition-colors ${
                        isSelected
                          ? "bg-cyan-500/15 border border-cyan-500/30 text-cyan-200"
                          : "hover:bg-slate-800/70 text-slate-300 hover:text-slate-100"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectTemplate(template);
                          setIsOpen(false);
                        }}
                        className="flex-1 text-left flex items-start gap-2.5 min-w-0"
                      >
                        <div
                          className={`mt-0.5 p-1.5 rounded-lg ${
                            isSelected
                              ? "bg-cyan-500/20 text-cyan-300"
                              : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          <Sliders className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold truncate">{template.name}</div>
                          <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                            {template.description}
                          </p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteCustomTemplate(template.id);
                        }}
                        className="p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Şablonu sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Create Custom Template Action */}
          <div className="pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenCreateCustom();
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-cyan-500/10 to-blue-500/10 hover:from-cyan-500/20 hover:to-blue-500/20 border border-cyan-500/30 text-cyan-300 hover:text-cyan-200 text-xs font-semibold transition-all shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t("summary.createCustomTemplate") || "+ Özel Prompt Şablonu Oluştur"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
