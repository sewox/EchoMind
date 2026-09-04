import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Sparkles,
  X,
  Search,
  Send,
  Loader2,
  Bot,
  User,
  Copy,
  Check,
  Bookmark,
  Calendar,
  Clock,
  ExternalLink,
  Target,
  CheckSquare,
  Zap,
  MessageSquare,
  HelpCircle,
  ArrowRight,
  FolderOpen,
} from "lucide-react";
import { useI18n } from "../locales/i18nContext";

export interface SearchMatch {
  match_type: string;
  matched_text: string;
  snippet: string;
  timestamp_formatted?: string;
  start_time_ms?: number;
  speaker_name?: string;
}

export interface GlobalSearchResult {
  meeting_id: string;
  meeting_title: string;
  date_formatted: string;
  duration_formatted: string;
  matches: SearchMatch[];
  score: number;
}

export interface GlobalAssistantResponse {
  answer: string;
  cited_meeting_ids: string[];
  provider_used: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: string;
  citedMeetingIds?: string[];
  timestamp: string;
}

interface GlobalAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMeeting?: (meetingId: string) => void;
}

const QUICK_PROMPTS = [
  {
    icon: "✅",
    label: "Açık Görevler ve Sorumlular",
    prompt:
      "Tüm toplantılardaki açık eylem maddelerini, görevleri ve sorumluları listele.",
  },
  {
    icon: "⚡",
    label: "Alınan Tüm Kritik Kararlar",
    prompt:
      "Geçmiş tüm toplantılarda varılan mutabakatları ve alınan kesin kararları özetle.",
  },
  {
    icon: "🎯",
    label: "Toplantı Hedefleri ve Süreç",
    prompt:
      "Toplantıların temel amaçlarını ve hangi konuların sonraki fazlara ertelendiğini karşılaştır.",
  },
  {
    icon: "💰",
    label: "Bütçe & Finansal Konular",
    prompt:
      "Toplantılarda bütçe, KDV, ödeme ve maliyetler hakkında ne konuşuldu?",
  },
];

export const GlobalAssistantModal: React.FC<GlobalAssistantModalProps> = ({
  isOpen,
  onClose,
  onSelectMeeting,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"chat" | "search">("chat");
  const [inputQuery, setInputQuery] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // Search Tab States
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([]);
  const [searchFilter, setSearchFilter] = useState<string>("all");

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Merhaba! Ben **EchoMind Kurumsal Toplantı Asistanı**.\n\nTüm toplantı arşivinizi, alınan kararları, eylem maddelerini ve konuşma dökümlerini tarayarak sorularınızı yanıtlayabilirim. Aşağıdaki hazır başlıklardan birini seçebilir veya dilediğiniz soruyu sorabilirsiniz.",
      provider: "EchoMind Knowledge Core",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && activeTab === "chat") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, activeTab]);

  if (!isOpen) return null;

  const handleSendMessage = async (customText?: string) => {
    const textToSend = customText || inputQuery;
    if (!textToSend.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customText) setInputQuery("");
    setIsLoading(true);

    try {
      const activeEngine =
        localStorage.getItem("echomind_active_engine") || "local";
      let provider = "local";
      let apiKey: string | null = null;

      if (activeEngine === "cloud_groq") {
        provider = "groq";
        apiKey = localStorage.getItem("echomind_groq_key");
      } else if (activeEngine === "cloud_gemini") {
        provider = "gemini";
        apiKey = localStorage.getItem("echomind_gemini_key");
      } else if (activeEngine === "cloud_openai") {
        provider = "openai";
        apiKey = localStorage.getItem("echomind_openai_key");
      }

      const customEndpoint =
        localStorage.getItem("echomind_ollama_endpoint") || undefined;
      const customModel =
        localStorage.getItem("echomind_ollama_model") || undefined;

      const response = await invoke<GlobalAssistantResponse>(
        "ask_global_assistant",
        {
          query: textToSend.trim(),
          provider,
          apiKey,
          customEndpoint,
          customModel,
        },
      );

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response.answer,
        provider: response.provider_used,
        citedMeetingIds: response.cited_meeting_ids,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error("Asistan sorgulama hatası:", err);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `⚠️ Soru yanıtlanırken bir hata oluştu: ${typeof err === "string" ? err : "Bilinmeyen hata"}`,
        provider: "Hata",
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGlobalSearch = async (term: string) => {
    setSearchTerm(term);
    if (!term.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const results = await invoke<GlobalSearchResult[]>(
        "global_search_meetings",
        {
          query: term.trim(),
        },
      );
      setSearchResults(results || []);
    } catch (err) {
      console.error("Global arama hatası:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  const handleOpenMeeting = (meetingId: string) => {
    onSelectMeeting?.(meetingId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200 select-text">
      <div className="relative w-full max-w-4xl h-[85vh] rounded-3xl bg-gradient-to-b from-slate-900/95 via-[#0b1428]/95 to-slate-950/95 border border-cyan-500/30 shadow-2xl shadow-cyan-950/60 flex flex-col overflow-hidden select-text">
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-slate-900/40 select-none">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/30">
              <Sparkles className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base md:text-lg font-bold text-white">
                  {t("assistant.title")}
                </h2>
              </div>
              <p className="text-xs text-slate-400">
                {t("assistant.subtitle")}
              </p>
            </div>
          </div>

          {/* Navigation Tabs & Close */}
          <div className="flex items-center gap-3">
            <div className="flex items-center p-1 rounded-xl bg-slate-950/80 border border-slate-800 text-xs">
              <button
                onClick={() => setActiveTab("chat")}
                className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
                  activeTab === "chat"
                    ? "bg-cyan-500/20 text-cyan-300 font-semibold shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Bot className="w-3.5 h-3.5" />
                <span>{t("assistant.title")}</span>
              </button>
              <button
                onClick={() => setActiveTab("search")}
                className={`px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 ${
                  activeTab === "search"
                    ? "bg-cyan-500/20 text-cyan-300 font-semibold shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>{t("common.search")}</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
              title={t("common.close")}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab 1: AI Chat Assistant */}
        {activeTab === "chat" && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 pr-3 select-text">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3.5 ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-2xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-cyan-900/40 mt-1 select-none">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div
                    className={`max-w-2xl rounded-2xl p-4 text-xs md:text-sm leading-relaxed shadow-lg select-text ${
                      msg.role === "user"
                        ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-tr-none"
                        : "bg-slate-900/90 border border-slate-800 text-slate-200 rounded-tl-none"
                    }`}
                  >
                    {/* Header Info */}
                    <div className="flex items-center justify-between gap-4 mb-2 pb-1.5 border-b border-white/10 text-[11px] opacity-80 select-none">
                      <span className="font-semibold">
                        {msg.role === "user"
                          ? "Siz"
                          : msg.provider || "EchoMind Asistan"}
                      </span>
                      <div className="flex items-center gap-2 font-mono text-[10px]">
                        <span>{msg.timestamp}</span>
                        {msg.role === "assistant" && (
                          <button
                            onClick={() => handleCopy(msg.content, msg.id)}
                            className="p-1 rounded hover:bg-white/10 transition"
                            title="Yanıtı Kopyala"
                          >
                            {copiedMessageId === msg.id ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3 text-slate-400 hover:text-white" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Markdown / Text Content */}
                    <div className="whitespace-pre-wrap font-sans space-y-2 select-text cursor-text">
                      {msg.content}
                    </div>

                    {/* Clickable Citations Footer */}
                    {msg.citedMeetingIds && msg.citedMeetingIds.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-white/10 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 flex items-center gap-1 font-medium">
                          <Bookmark className="w-3 h-3 text-cyan-400" />
                          <span>İlgili Toplantılar:</span>
                        </span>
                        {msg.citedMeetingIds.map((id) => (
                          <button
                            key={id}
                            onClick={() => handleOpenMeeting(id)}
                            className="px-2 py-0.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-[10px] font-semibold transition flex items-center gap-1"
                          >
                            <span>Toplantıyı Aç</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-2xl bg-slate-800 text-slate-300 flex items-center justify-center shrink-0 border border-slate-700 mt-1">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3.5 justify-start">
                  <div className="w-8 h-8 rounded-2xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-cyan-900/40">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-cyan-300">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Toplantı arşivi taranıyor ve analiz ediliyor...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Prompts Bar */}
            <div className="px-6 py-2 border-t border-white/5 bg-slate-950/40 flex items-center gap-2 overflow-x-auto shrink-0">
              <span className="text-[11px] text-slate-500 shrink-0 font-medium flex items-center gap-1">
                <HelpCircle className="w-3 h-3" />
                <span>Örnekler:</span>
              </span>
              {QUICK_PROMPTS.map((qp, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(qp.prompt)}
                  disabled={isLoading}
                  className="px-2.5 py-1 rounded-full bg-slate-900 hover:bg-slate-800 border border-white/10 hover:border-cyan-500/40 text-slate-300 text-xs font-medium transition flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  <span>{qp.icon}</span>
                  <span>{qp.label}</span>
                </button>
              ))}
            </div>

            {/* Input Box */}
            <div className="p-4 md:p-6 border-t border-white/10 bg-slate-900/60 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="relative flex items-center"
              >
                <input
                  type="text"
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  placeholder={t("assistant.placeholder")}
                  disabled={isLoading}
                  className="w-full pl-4 pr-24 py-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 shadow-inner"
                />
                <button
                  type="submit"
                  disabled={!inputQuery.trim() || isLoading}
                  className="absolute right-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-cyan-900/40 transition flex items-center gap-1.5 disabled:opacity-40"
                >
                  <span>{t("assistant.askButton")}</span>
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Tab 2: Global Deep Search */}
        {activeTab === "search" && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-6 gap-4">
            {/* Search Input */}
            <div className="relative shrink-0">
              <Search className="w-4 h-4 absolute left-4 top-3.5 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => handleGlobalSearch(e.target.value)}
                placeholder="Tüm toplantı başlıkları, hedefleri, kararları, görevleri ve konuşmalarında ara..."
                className="w-full pl-11 pr-10 py-3 rounded-2xl bg-slate-950/90 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                autoFocus
              />
              {searchTerm && (
                <button
                  onClick={() => handleGlobalSearch("")}
                  className="absolute right-3.5 top-3.5 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-2 shrink-0 overflow-x-auto pb-1 text-xs">
              {[
                { key: "all", label: "Tümü" },
                { key: "title", label: "🏷️ Başlıklar" },
                { key: "goal", label: "🎯 Hedefler" },
                { key: "decision", label: "⚡ Kararlar" },
                { key: "action_item", label: "✅ Eylem Maddeleri" },
                { key: "transcript", label: "💬 Konuşma Transkripti" },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setSearchFilter(f.key)}
                  className={`px-3 py-1 rounded-lg border transition ${
                    searchFilter === f.key
                      ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Results List */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              {isSearching ? (
                <div className="text-center py-16 flex flex-col items-center gap-2 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                  <span className="text-xs">
                    Tüm toplantı arşivi taranıyor...
                  </span>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-16 text-slate-500 text-xs border border-dashed border-white/10 rounded-2xl p-8 flex flex-col items-center gap-2">
                  <Search className="w-8 h-8 text-slate-600" />
                  <span>
                    {searchTerm
                      ? `"${searchTerm}" ile eşleşen bir toplantı kaydı bulunamadı.`
                      : "Aramak istediğiniz konuyu, kişiyi veya kararı yazın."}
                  </span>
                </div>
              ) : (
                searchResults.map((res) => {
                  const filteredMatches =
                    searchFilter === "all"
                      ? res.matches
                      : res.matches.filter((m) =>
                          m.match_type.includes(searchFilter),
                        );

                  if (filteredMatches.length === 0) return null;

                  return (
                    <div
                      key={res.meeting_id}
                      className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-cyan-500/40 transition shadow-lg space-y-3"
                    >
                      {/* Meeting Header */}
                      <div className="flex items-center justify-between border-b border-white/10 pb-3">
                        <div>
                          <h4 className="text-sm md:text-base font-bold text-white flex items-center gap-2">
                            <span>{res.meeting_title}</span>
                          </h4>
                          <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {res.date_formatted}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {res.duration_formatted}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleOpenMeeting(res.meeting_id)}
                          className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-cyan-900/30 transition flex items-center gap-1.5 shrink-0"
                        >
                          <span>Toplantıya Git</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Matches in this meeting */}
                      <div className="space-y-2">
                        {filteredMatches.map((m, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-xl bg-slate-950/60 border border-white/5 flex items-start gap-2.5 text-xs text-slate-300"
                          >
                            <span className="mt-0.5">
                              {m.match_type === "goal" && (
                                <Target className="w-3.5 h-3.5 text-amber-400" />
                              )}
                              {m.match_type === "decision" && (
                                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                              )}
                              {m.match_type === "action_item" && (
                                <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                              )}
                              {m.match_type === "transcript" && (
                                <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                              )}
                              {m.match_type === "title" && (
                                <Bookmark className="w-3.5 h-3.5 text-blue-400" />
                              )}
                              {m.match_type.includes("topic") && (
                                <FolderOpen className="w-3.5 h-3.5 text-purple-400" />
                              )}
                            </span>
                            <div className="flex-1">
                              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                                <span className="font-semibold uppercase tracking-wider text-cyan-400">
                                  {m.match_type === "goal"
                                    ? "Toplantı Amacı"
                                    : m.match_type === "decision"
                                      ? "Alınan Karar"
                                      : m.match_type === "action_item"
                                        ? "Eylem Maddesi"
                                        : m.match_type === "transcript"
                                          ? `Konuşma (${m.speaker_name || "Bilinmeyen"})`
                                          : "Gündem Başlığı"}
                                </span>
                                {m.timestamp_formatted && (
                                  <span className="font-mono text-slate-400">
                                    {m.timestamp_formatted}
                                  </span>
                                )}
                              </div>
                              <p className="leading-relaxed">{m.snippet}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
