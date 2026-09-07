import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, Square, Volume2, Sparkles, FastForward } from "lucide-react";
import { SummaryResult } from "../TranscriptViewer";
import { useI18n } from "../../locales/i18nContext";

interface AudioMemoPlayerProps {
  summary: SummaryResult | null;
  meetingTitle?: string;
  langCode?: string;
}

export const AudioMemoPlayer: React.FC<AudioMemoPlayerProps> = ({
  summary,
  meetingTitle,
  langCode = "tr",
}) => {
  const { t } = useI18n();
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [rate, setRate] = useState<number>(1);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Stop speech when component unmounts
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (!summary) return null;

  // Generate pleasant narrative podcast text
  const generateMemoNarrative = () => {
    const parts: string[] = [];

    if (langCode === "tr") {
      parts.push(`İşte ${meetingTitle || "toplantınız"} için hazırlanan yapay zekâ sesli bülteni.`);
      if (summary.meeting_goal && summary.meeting_goal.trim().length > 0) {
        parts.push(`Toplantının temel amacı: ${summary.meeting_goal}.`);
      }
      if (summary.key_decisions && summary.key_decisions.length > 0) {
        parts.push(`Alınan önemli kararlar şunlardır: ${summary.key_decisions.join(". ")}.`);
      }
      if (summary.action_items && summary.action_items.length > 0) {
        const actions = summary.action_items
          .map((a) => (a.assignee ? `${a.assignee} sorumlu: ${a.task}` : a.task))
          .join(". ");
        parts.push(`Belirlenen aksiyon maddeleri ve görevler: ${actions}.`);
      }
      if (summary.summary && summary.summary.trim().length > 0) {
        parts.push(`Genel değerlendirme: ${summary.summary}.`);
      }
    } else {
      parts.push(`Here is the AI executive audio memo for ${meetingTitle || "your meeting"}.`);
      if (summary.meeting_goal && summary.meeting_goal.trim().length > 0) {
        parts.push(`Meeting Goal: ${summary.meeting_goal}.`);
      }
      if (summary.key_decisions && summary.key_decisions.length > 0) {
        parts.push(`Key Decisions Agreed: ${summary.key_decisions.join(". ")}.`);
      }
      if (summary.action_items && summary.action_items.length > 0) {
        const actions = summary.action_items
          .map((a) => (a.assignee ? `${a.assignee} assigned to ${a.task}` : a.task))
          .join(". ");
        parts.push(`Action Items and Tasks: ${actions}.`);
      }
    }

    return parts.join(" ");
  };

  const handlePlayPause = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      alert("Tarayıcınız veya işletim sisteminiz ses sentezini (SpeechSynthesis) desteklemiyor.");
      return;
    }

    if (isPlaying) {
      if (isPaused) {
        window.speechSynthesis.resume();
        setIsPaused(false);
      } else {
        window.speechSynthesis.pause();
        setIsPaused(true);
      }
    } else {
      window.speechSynthesis.cancel();
      const text = generateMemoNarrative();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = langCode === "tr" ? "tr-TR" : "en-US";
      utterance.rate = rate;

      utterance.onend = () => {
        setIsPlaying(false);
        setIsPaused(false);
      };

      utterance.onerror = () => {
        setIsPlaying(false);
        setIsPaused(false);
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      setIsPlaying(true);
      setIsPaused(false);
    }
  };

  const handleStop = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setIsPaused(false);
  };

  const handleSpeedToggle = () => {
    const speeds = [1, 1.25, 1.5, 2];
    const nextIndex = (speeds.indexOf(rate) + 1) % speeds.length;
    const newRate = speeds[nextIndex];
    setRate(newRate);

    if (isPlaying) {
      // Re-trigger with new rate
      window.speechSynthesis.cancel();
      const text = generateMemoNarrative();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = langCode === "tr" ? "tr-TR" : "en-US";
      utterance.rate = newRate;
      utterance.onend = () => {
        setIsPlaying(false);
        setIsPaused(false);
      };
      utterance.onerror = () => {
        setIsPlaying(false);
        setIsPaused(false);
      };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      setIsPaused(false);
    }
  };

  return (
    <div className="flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-slate-900/60 border border-indigo-500/30 shadow-lg shadow-indigo-950/20 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
          <Volume2 className={`w-4 h-4 ${isPlaying && !isPaused ? "animate-pulse text-amber-300" : ""}`} />
        </div>
        <div>
          <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            {t("summary.audioMemo.button") || "🎙️ Sesli Bülteni Dinle (AI Podcast)"}
          </h4>
          <p className="text-[11px] text-indigo-200/80">
            {isPlaying
              ? isPaused
                ? t("summary.audioMemo.paused") || "Duraklatıldı"
                : t("summary.audioMemo.playing") || "Sesli Özet Dinleniyor..."
              : "Yönetici özetini podcast akıcılığında dinleyin"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSpeedToggle}
          className="px-2.5 py-1 rounded-lg text-xs font-mono font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-500/20 transition flex items-center gap-1"
          title={`${t("summary.audioMemo.speed") || "Hız"}: ${rate}x`}
        >
          <FastForward className="w-3 h-3" />
          <span>{rate}x</span>
        </button>

        <button
          onClick={handlePlayPause}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-md transition flex items-center gap-1.5 ${
            isPlaying && !isPaused
              ? "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20"
              : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30"
          }`}
        >
          {isPlaying && !isPaused ? (
            <>
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>{t("summary.audioMemo.paused") || "Duraklat"}</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{t("summary.audioMemo.play") || "Dinle"}</span>
            </>
          )}
        </button>

        {isPlaying && (
          <button
            onClick={handleStop}
            className="p-1.5 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-700 transition"
            title={t("summary.audioMemo.stop") || "Durdur"}
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        )}
      </div>
    </div>
  );
};
