import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  Mail,
  CheckSquare,
  Calendar,
  MessageSquare,
  Copy,
  Check,
  Download,
  ExternalLink,
  Sparkles,
  User,
  Send,
  FileText,
} from "lucide-react";
import { MeetingRecord } from "../App";
import { useI18n } from "../locales/i18nContext";

export interface FollowUpBundleData {
  email_subject: string;
  email_body: string;
  email_html: string;
  mailto_url: string;
  action_items_md: string;
  action_items_csv: string;
  slack_md: string;
  ics_content: string;
}

export type FollowUpTone = "standard" | "executive" | "sales" | "casual";

interface FollowUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: MeetingRecord;
  summary?: any | null;
}

export const FollowUpModal: React.FC<FollowUpModalProps> = ({
  isOpen,
  onClose,
  meeting,
}) => {
  const { t, language } = useI18n();
  const [activeTab, setActiveTab] = useState<
    "email" | "actions" | "calendar" | "slack"
  >("email");
  const [tone, setTone] = useState<FollowUpTone>("standard");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [eventDate, setEventDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 16);
  });
  const [eventDuration, setEventDuration] = useState<number>(30);
  const [eventTitle, setEventTitle] = useState<string>(
    () => `Takip / Follow-up: ${meeting.title}`,
  );
  const [bundle, setBundle] = useState<FollowUpBundleData | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEventTitle(`Takip / Follow-up: ${meeting.title}`);
      loadBundle();
    }
  }, [isOpen, meeting, tone, language]);

  const loadBundle = async () => {
    try {
      const res = await invoke<FollowUpBundleData>("export_followup_bundle", {
        meetingId: meeting.id,
        customSummary: null,
        langCode: language,
      });
      setBundle(res);
    } catch (err) {
      console.error("Follow-up bundle hatası:", err);
    }
  };

  if (!isOpen) return null;

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
    } catch (err) {
      console.error("Kopyalama başarısız:", err);
    }
  };

  const handleDownloadIcs = async () => {
    try {
      const summaryText = meeting.summary || meeting.meeting_goal || "";
      const ics = await invoke<string>("generate_meeting_ics", {
        meetingTitle: eventTitle,
        startDatetimeIso: eventDate,
        durationMinutes: eventDuration,
        description: `EchoMind AI Takip Toplantısı: ${meeting.title}\nÖzet: ${summaryText.slice(0, 150)}...`,
        location: "EchoMind Sanal Toplantı Odası",
      });

      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Takip_${meeting.id}.ics`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setCopiedKey("ics");
      setTimeout(() => setCopiedKey(null), 2500);
    } catch (err) {
      console.error("ICS indirme hatası:", err);
    }
  };

  const handleOpenMailClient = () => {
    if (bundle?.mailto_url) {
      window.location.href = bundle.mailto_url;
    }
  };

  const actionItems = meeting.action_items || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200 cursor-pointer"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-3xl bg-slate-900 border border-cyan-500/30 rounded-3xl shadow-2xl shadow-cyan-950/50 p-6 md:p-8 relative overflow-hidden flex flex-col max-h-[90vh] text-slate-100 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glowing Accents */}
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-60 h-60 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-400 shadow-inner">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-lg">
                  {t("followUp.modalTitle") || "One-Click Follow-up Engine"}
                </h3>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  AI Generated
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {t("followUp.modalSubtitle") ||
                  "Toplantı sonrası profesyonel takip e-postası ve aksiyon çıktısı"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Kapat"
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-slate-800/80 mb-5 pb-1 overflow-x-auto">
          {[
            {
              id: "email" as const,
              label: t("followUp.tabs.email") || "📧 Takip E-Postası",
              icon: Mail,
            },
            {
              id: "actions" as const,
              label: t("followUp.tabs.actions") || "✅ Görevler & Sorumlular",
              icon: CheckSquare,
            },
            {
              id: "calendar" as const,
              label: t("followUp.tabs.calendar") || "📅 Takvim Daveti (.ics)",
              icon: Calendar,
            },
            {
              id: "slack" as const,
              label: t("followUp.tabs.slack") || "💬 Slack & Teams",
              icon: MessageSquare,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl transition cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${isActive ? "text-cyan-400" : "text-slate-500"}`}
                />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main Tab Content */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* TAB 1: FOLLOW-UP EMAIL */}
          {activeTab === "email" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Tone Switcher */}
              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-slate-300 font-medium">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>{t("followUp.toneLabel") || "İletişim Tonu:"}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    {
                      id: "standard" as const,
                      label: t("followUp.tones.standard") || "Standart",
                    },
                    {
                      id: "executive" as const,
                      label: t("followUp.tones.executive") || "Yönetici",
                    },
                    {
                      id: "sales" as const,
                      label: t("followUp.tones.sales") || "Müşteri",
                    },
                    {
                      id: "casual" as const,
                      label: t("followUp.tones.casual") || "Samimi",
                    },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTone(item.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                        tone === item.id
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject Box */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-cyan-400" />
                    {t("followUp.emailSubject") || "Konu"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(bundle?.email_subject || "", "subject")
                    }
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedKey === "subject" ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>
                      {copiedKey === "subject"
                        ? t("common.copied")
                        : t("followUp.copySubject")}
                    </span>
                  </button>
                </div>
                <input
                  type="text"
                  readOnly
                  value={
                    bundle?.email_subject || `${meeting.title} - Takip Notları`
                  }
                  className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs font-medium text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Body Box */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-cyan-400" />
                    {t("followUp.emailBody") || "E-Posta Metni"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(bundle?.email_body || "", "body")}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedKey === "body" ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>
                      {copiedKey === "body"
                        ? t("common.copied")
                        : t("followUp.copyBody")}
                    </span>
                  </button>
                </div>
                <textarea
                  readOnly
                  rows={8}
                  value={bundle?.email_body || meeting.summary}
                  className="w-full p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 leading-relaxed focus:outline-none focus:border-cyan-500 resize-none select-all"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleOpenMailClient}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-cyan-950/50 transition cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>
                    {t("followUp.openInMailClient") ||
                      "E-Posta İstemcisinde Aç"}
                  </span>
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleCopy(bundle?.email_body || "", "all_email")
                  }
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center gap-2 border border-slate-700 transition cursor-pointer"
                >
                  {copiedKey === "all_email" ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  <span>
                    {copiedKey === "all_email"
                      ? t("common.copied")
                      : t("followUp.copyEmail")}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: ACTION ITEMS & TASKS */}
          {activeTab === "actions" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  {t("followUp.actionItemsTitle")} ({actionItems.length})
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(bundle?.action_items_md || "", "tasks_md")
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 border border-slate-700 transition cursor-pointer"
                  >
                    {copiedKey === "tasks_md" ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>Markdown</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(bundle?.action_items_csv || "", "tasks_csv")
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 border border-slate-700 transition cursor-pointer"
                  >
                    {copiedKey === "tasks_csv" ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>CSV</span>
                  </button>
                </div>
              </div>

              {actionItems.length === 0 ? (
                <div className="p-8 text-center rounded-2xl bg-slate-950/60 border border-slate-800 text-slate-400 text-xs">
                  {t("followUp.actionItemsEmpty")}
                </div>
              ) : (
                <div className="space-y-2">
                  {actionItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-start justify-between gap-3 hover:border-slate-700 transition"
                    >
                      <div className="flex items-start gap-3">
                        <span className="w-5 h-5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="text-xs font-medium text-slate-200 leading-snug">
                            {item.task}
                          </p>
                          {item.assignee && (
                            <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-cyan-400">
                              <User className="w-3 h-3" />
                              <span>@{item.assignee}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-mono shrink-0 ${
                          item.is_completed
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                        }`}
                      >
                        {item.is_completed ? "DONE" : "PENDING"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CALENDAR INVITE (.ICS) */}
          {activeTab === "calendar" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="p-4 rounded-2xl bg-gradient-to-tr from-cyan-950/40 via-slate-900/60 to-slate-950/60 border border-cyan-500/30 space-y-1">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-cyan-400" />
                  {t("followUp.calendarTitle")}
                </h4>
                <p className="text-xs text-slate-400">
                  {t("followUp.calendarDesc")}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    {t("followUp.meetingTitleLabel")}
                  </label>
                  <input
                    type="text"
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      {t("followUp.eventDateLabel")}
                    </label>
                    <input
                      type="datetime-local"
                      value={eventDate}
                      onChange={(e) => setEventDate(e.target.value)}
                      className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      {t("followUp.eventDurationLabel")}
                    </label>
                    <select
                      value={eventDuration}
                      onChange={(e) => setEventDuration(Number(e.target.value))}
                      className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                    >
                      <option value={15}>15 Dakika</option>
                      <option value={30}>30 Dakika</option>
                      <option value={45}>45 Dakika</option>
                      <option value={60}>1 Saat</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleDownloadIcs}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition cursor-pointer"
                >
                  {copiedKey === "ics" ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>
                    {copiedKey === "ics"
                      ? t("followUp.toastIcsDownloaded")
                      : t("followUp.downloadIcs")}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: SLACK & TEAMS */}
          {activeTab === "slack" && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                  {t("followUp.slackTitle")}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(bundle?.slack_md || "", "slack")}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-semibold flex items-center gap-1.5 hover:bg-cyan-500/30 transition cursor-pointer"
                >
                  {copiedKey === "slack" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {copiedKey === "slack"
                      ? t("common.copied")
                      : t("followUp.copySlack")}
                  </span>
                </button>
              </div>

              <textarea
                readOnly
                rows={10}
                value={bundle?.slack_md || meeting.summary}
                className="w-full p-3.5 bg-slate-950/90 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 leading-relaxed focus:outline-none focus:border-cyan-500 resize-none select-all"
              />
            </div>
          )}
        </div>

        {/* Modal Footer with One-Click Bundle Export */}
        <div className="border-t border-slate-800/80 pt-4 mt-4 flex items-center justify-between gap-3 text-xs">
          <div className="text-slate-400 text-[11px] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Zero-Trust Local-First Engine</span>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                const bundleData = await invoke<FollowUpBundleData>(
                  "export_followup_bundle",
                  {
                    meetingId: meeting.id,
                    customSummary: null,
                    langCode: language,
                  },
                );
                const fullText = `=== E-POSTA ===\nKonu: ${bundleData.email_subject}\n\n${bundleData.email_body}\n\n=== AKSİYONLAR ===\n${bundleData.action_items_md}\n\n=== SLACK ===\n${bundleData.slack_md}\n\n=== CALENDAR ICS ===\n${bundleData.ics_content}`;
                const blob = new Blob([fullText], {
                  type: "text/plain;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.setAttribute(
                  "download",
                  `FollowUp_Bundle_${meeting.id}.txt`,
                );
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                setCopiedKey("bundle");
                setTimeout(() => setCopiedKey(null), 2500);
              } catch (err) {
                console.error("Bundle download error:", err);
              }
            }}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold flex items-center gap-2 shadow-md shadow-indigo-950/40 transition cursor-pointer"
          >
            {copiedKey === "bundle" ? (
              <Check className="w-3.5 h-3.5 text-emerald-300" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>
              {t("followUp.oneClickExportBundle") || "Tüm Paketi Dışa Aktar"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
