import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  FileText,
  FileCode,
  Mail,
  Database,
  Printer,
  Download,
  Copy,
  Check,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { SummaryResult } from "./TranscriptViewer";
import { useI18n } from "../locales/i18nContext";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  meetingId: string;
  meetingTitle: string;
  activeSummary?: SummaryResult | null;
  langCode?: string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  meetingId,
  meetingTitle,
  activeSummary,
  langCode,
}) => {
  const { t } = useI18n();
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const showToast = (msg: string, isError = false) => {
    if (isError) {
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(null), 4000);
    } else {
      setSuccessMessage(msg);
      setTimeout(() => setSuccessMessage(null), 4000);
    }
  };

  const handleCopy = async (type: "markdown" | "email" | "transcript") => {
    try {
      let content = "";
      if (type === "markdown") {
        content = await invoke<string>("export_meeting_notes", {
          meetingId,
          customSummary: activeSummary || null,
          langCode: langCode || null,
        });
      } else if (type === "email") {
        content = await invoke<string>("export_meeting_email_digest", {
          meetingId,
          customSummary: activeSummary || null,
          langCode: langCode || null,
        });
      } else if (type === "transcript") {
        // Plain text transcript
        const md = await invoke<string>("export_meeting_notes", {
          meetingId,
          customSummary: activeSummary || null,
          langCode: langCode || null,
        });
        content = md;
      }
      await navigator.clipboard.writeText(content);
      setCopiedType(type);
      showToast("Panoya kopyalandı!");
      setTimeout(() => setCopiedType(null), 2500);
    } catch (err) {
      console.error("Kopyalama hatası:", err);
      showToast("Kopyalama başarısız oldu.", true);
    }
  };

  const handleSaveFile = async (
    format: "html" | "md" | "email" | "json" | "txt",
  ) => {
    setIsSaving(format);
    try {
      const savedPath = await invoke<string>("save_meeting_export_file", {
        meetingId,
        exportType: format,
        customSummary: activeSummary || null,
        langCode: langCode || null,
      });
      showToast(`Dosya başarıyla kaydedildi: ${savedPath}`);
    } catch (err: any) {
      if (typeof err === "string" && err.includes("iptal")) {
        // User cancelled dialog, ignore
      } else {
        console.error("Dosya kaydetme hatası:", err);
        showToast("Dosya kaydedilemedi.", true);
      }
    } finally {
      setIsSaving(null);
    }
  };

  const handleOpenPrintableHtml = async () => {
    try {
      await invoke<string>("open_meeting_html_report", {
        meetingId,
        customSummary: activeSummary || null,
        langCode: langCode || null,
      });
      showToast("Görsel rapor varsayılan tarayıcınızda açıldı!");
    } catch (err) {
      console.error("HTML önizleme hatası:", err);
      showToast("Görsel rapor açılamadı.", true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl rounded-3xl bg-gradient-to-b from-slate-900/95 via-[#0c162d]/95 to-slate-950/95 border border-cyan-500/30 shadow-2xl shadow-cyan-950/60 p-6 md:p-8 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/30">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
                <span>{t("exportModal.title")}</span>
                <Sparkles className="w-4 h-4 text-amber-400" />
              </h2>
              <p className="text-xs text-slate-400 truncate max-w-md">
                {meetingTitle || t("common.appName")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toast Alert Banner */}
        {successMessage && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-in fade-in duration-150">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span className="truncate">{successMessage}</span>
          </div>
        )}
        {errorMessage && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2 animate-in fade-in duration-150">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="truncate">{errorMessage}</span>
          </div>
        )}

        {/* Export Options Grid */}
        <div className="flex-1 overflow-y-auto py-5 space-y-4 pr-1">
          {/* 1. PDF / Printable HTML */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-cyan-500/20 hover:border-cyan-500/40 transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 mt-0.5">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <span>{t("exportModal.pdfHtmlTitle")}</span>
                  <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-bold">
                    {t("common.recommended")}
                  </span>
                </h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {t("exportModal.pdfHtmlDesc")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
              <button
                onClick={handleOpenPrintableHtml}
                className="flex-1 md:flex-none px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/30 transition flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{t("exportModal.openPrintButton")}</span>
              </button>
              <button
                onClick={() => handleSaveFile("html")}
                disabled={isSaving === "html"}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {isSaving === "html"
                    ? t("common.loading")
                    : t("exportModal.downloadHtmlButton")}
                </span>
              </button>
            </div>
          </div>

          {/* 2. Markdown Report */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 hover:border-white/20 transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 mt-0.5">
                <FileCode className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">
                  {t("exportModal.markdownTitle")}
                </h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {t("exportModal.markdownDesc")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
              <button
                onClick={() => handleCopy("markdown")}
                className="flex-1 md:flex-none px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center justify-center gap-1.5"
              >
                {copiedType === "markdown" ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>
                  {copiedType === "markdown"
                    ? t("common.copied")
                    : t("common.copy")}
                </span>
              </button>
              <button
                onClick={() => handleSaveFile("md")}
                disabled={isSaving === "md"}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {isSaving === "md"
                    ? t("common.loading")
                    : ".md " + t("common.download")}
                </span>
              </button>
            </div>
          </div>

          {/* 3. Email & Slack Digest */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 hover:border-white/20 transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 mt-0.5">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">
                  {t("exportModal.emailDigestTitle")}
                </h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {t("exportModal.emailDigestDesc")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
              <button
                onClick={() => handleCopy("email")}
                className="flex-1 md:flex-none px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center justify-center gap-1.5"
              >
                {copiedType === "email" ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>
                  {copiedType === "email"
                    ? t("common.copied")
                    : t("exportModal.copyButton")}
                </span>
              </button>
              <button
                onClick={() => handleSaveFile("email")}
                disabled={isSaving === "email"}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {isSaving === "email"
                    ? t("common.loading")
                    : ".txt " + t("common.download")}
                </span>
              </button>
            </div>
          </div>

          {/* 4. Plain Text Transcript */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 hover:border-white/20 transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mt-0.5">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">
                  {t("exportModal.rawTextTitle")}
                </h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {t("exportModal.rawTextDesc")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
              <button
                onClick={() => handleCopy("transcript")}
                className="flex-1 md:flex-none px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center justify-center gap-1.5"
              >
                {copiedType === "transcript" ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>
                  {copiedType === "transcript"
                    ? t("common.copied")
                    : t("common.copy")}
                </span>
              </button>
              <button
                onClick={() => handleSaveFile("txt")}
                disabled={isSaving === "txt"}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {isSaving === "txt"
                    ? t("common.loading")
                    : ".txt " + t("common.download")}
                </span>
              </button>
            </div>
          </div>

          {/* 5. Structured JSON Data */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-white/10 hover:border-white/20 transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 mt-0.5">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">
                  {t("exportModal.jsonTitle")}
                </h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {t("exportModal.jsonDesc")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
              <button
                onClick={() => handleSaveFile("json")}
                disabled={isSaving === "json"}
                className="w-full md:w-auto px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {isSaving === "json"
                    ? t("common.loading")
                    : ".json " + t("common.download")}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-white/10 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-medium transition"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
};
