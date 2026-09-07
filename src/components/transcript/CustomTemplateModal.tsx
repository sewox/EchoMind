import React, { useState } from "react";
import { X, Sliders, Sparkles, AlertCircle } from "lucide-react";
import { MeetingTemplate } from "../../types/templates";
import { useI18n } from "../../locales/i18nContext";

interface CustomTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveTemplate: (template: MeetingTemplate) => void;
}

export const CustomTemplateModal: React.FC<CustomTemplateModalProps> = ({
  isOpen,
  onClose,
  onSaveTemplate,
}) => {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("summary.templateNameRequired") || "Lütfen bir şablon adı girin.");
      return;
    }
    if (!systemPrompt.trim()) {
      setError(
        t("summary.templatePromptRequired") || "Lütfen yapay zekaya verilecek sistem promptunu girin."
      );
      return;
    }

    const newTemplate: MeetingTemplate = {
      id: `custom_${Date.now()}`,
      name: name.trim(),
      description: description.trim() || "Kullanıcı tanımlı özel prompt şablonu",
      icon: "Sliders",
      isCustom: true,
      systemPrompt: systemPrompt.trim(),
    };

    onSaveTemplate(newTemplate);
    setName("");
    setDescription("");
    setSystemPrompt("");
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-700/80 shadow-2xl p-6 sm:p-7 space-y-5 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                {t("summary.promptStudioTitle") || "Özel Prompt & Şablon Stüdyosu"}
                <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase bg-cyan-500/15 text-cyan-300 rounded-full border border-cyan-500/30">
                  Yeni
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {t("summary.promptStudioDesc") ||
                  "Toplantılarınıza ve şirket süreçlerinize özel AI analiz formatı tasarlayın."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          {/* Template Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              {t("summary.templateNameLabel") || "Şablon Adı"} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Örn: Haftalık Pazarlama Değerlendirmesi"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/60 transition-all"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              {t("summary.templateDescLabel") || "Kısa Açıklama"}
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Örn: Kampanya metrikleri, bütçe harcaması ve kreatif aksiyonlar"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/60 transition-all"
            />
          </div>

          {/* System Prompt Instruction */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-300">
                {t("summary.systemPromptLabel") || "Özel Sistem Promptu & Rol Yönergesi"} *
              </label>
              <span className="text-[10px] text-cyan-400 font-medium flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> JSON Çıktısı Otomatik Sağlanır
              </span>
            </div>
            <textarea
              rows={5}
              value={systemPrompt}
              onChange={(e) => {
                setSystemPrompt(e.target.value);
                if (error) setError(null);
              }}
              placeholder="SEN KIDEMLİ BİR PAZARLAMA STRATEJİSTİSİN. Bu toplantıyı incelerken CAC, ROAS hedeflerine, belirlenen kreatif testlere ve bütçe kararlarına odaklanarak analiz et..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100 placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/60 transition-all custom-scrollbar resize-none font-mono"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 text-xs sm:text-sm font-medium transition-colors"
            >
              {t("common.cancel") || "İptal"}
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs sm:text-sm font-semibold shadow-lg shadow-cyan-500/20 transition-all"
            >
              {t("summary.saveTemplate") || "Şablonu Kaydet"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
