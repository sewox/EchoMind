import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  FastForward,
  Pause,
  Play,
  Square,
  Volume2,
} from "lucide-react";
import { useI18n, translatorFor } from "../../locales/i18nContext";
import { SummaryResult } from "../TranscriptViewer";

interface AudioMemoPlayerProps {
  summary: SummaryResult | null;
  meetingTitle?: string;
  /** Report language; the briefing is read in it. */
  langCode?: string;
}

interface TtsAvailability {
  supported: boolean;
  voice: string | null;
}

type Status = "idle" | "speaking" | "paused";

const SPEEDS = [1, 1.25, 1.5];

const filled = (items?: string[]) =>
  (items || []).map((s) => s.trim()).filter(Boolean);

/** Strips trailing sentence punctuation so the templates add exactly one. */
const sentence = (text: string) => text.trim().replace(/[.!?]+$/u, "");

/**
 * The text read aloud: goal, decisions, tasks and the overall summary from
 * the report, in the report's language. Empty when the report has none of them.
 */
export function buildMemoText(
  summary: SummaryResult | null | undefined,
  title: string | undefined,
  lang: string,
): string {
  if (!summary) return "";
  const t = translatorFor(lang);
  const k = (key: string, params?: Record<string, string>) =>
    t(`summary.audioMemo.${key}`, params);
  const parts: string[] = [];

  const goal = summary.meeting_goal?.trim();
  if (goal) parts.push(k("goal", { text: sentence(goal) }));

  const decisions = filled(summary.key_decisions);
  if (decisions.length)
    parts.push(k("decisions", { text: decisions.map(sentence).join("; ") }));

  const actions = (summary.action_items || [])
    .filter((a) => a.task?.trim())
    .map((a) =>
      a.assignee?.trim()
        ? k("assigned", {
            assignee: a.assignee.trim(),
            task: sentence(a.task),
          })
        : sentence(a.task),
    );
  if (actions.length) parts.push(k("actions", { text: actions.join("; ") }));

  const overview = summary.summary?.trim();
  if (overview) parts.push(k("overview", { text: sentence(overview) }));

  if (!parts.length) return "";
  const name = title?.trim();
  return [name ? k("intro", { title: name }) : k("untitled"), ...parts].join(
    " ",
  );
}

/**
 * Reads the report summary aloud with the operating system's voices
 * (AVSpeechSynthesizer on macOS, SAPI on Windows). Hidden where the system
 * offers no voices to the app (Linux for now).
 */
export const AudioMemoPlayer: React.FC<AudioMemoPlayerProps> = ({
  summary,
  meetingTitle,
  langCode = "tr",
}) => {
  const { t } = useI18n();
  const [availability, setAvailability] = useState<TtsAvailability | null>(
    null,
  );
  const [status, setStatus] = useState<Status>("idle");
  const [rate, setRate] = useState(1);
  const [voice, setVoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const text = useMemo(
    () => buildMemoText(summary, meetingTitle, langCode),
    [summary, meetingTitle, langCode],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() =>
        invoke<TtsAvailability>("tts_availability", { lang: langCode }),
      )
      .then((a) => {
        if (!cancelled) setAvailability(a ?? null);
      })
      .catch(() => {
        if (!cancelled) setAvailability({ supported: false, voice: null });
      });
    return () => {
      cancelled = true;
    };
  }, [langCode]);

  // The engine says when the reading ends on its own.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      unlisten = await listen<{ state: Status }>("tts-state", (event) => {
        if (event.payload.state === "idle") {
          started.current = false;
          setStatus("idle");
        }
      });
      if (cancelled) unlisten();
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Never keep reading after the meeting, language or report changes.
  useEffect(() => {
    return () => {
      if (started.current) {
        started.current = false;
        setStatus("idle");
        Promise.resolve()
          .then(() => invoke("tts_stop"))
          .catch(() => {});
      }
    };
  }, [text, langCode]);

  if (!availability || !availability.supported) return null;

  const errorText = (err: unknown) => {
    const code = err instanceof Error ? err.message : String(err);
    if (code === "no_voice") return t("summary.audioMemo.noVoice");
    if (code === "empty_text") return t("summary.audioMemo.noReport");
    return t("summary.audioMemo.error", { error: code });
  };

  const start = async (speed: number) => {
    setError(null);
    try {
      const used = await invoke<string>("tts_speak", {
        text,
        lang: langCode,
        rate: speed,
      });
      started.current = true;
      setVoice(used);
      setStatus("speaking");
    } catch (err) {
      started.current = false;
      setStatus("idle");
      setError(errorText(err));
    }
  };

  const handlePlayPause = async () => {
    if (status === "idle") return start(rate);
    try {
      setStatus(
        await invoke<Status>(
          status === "speaking" ? "tts_pause" : "tts_resume",
        ),
      );
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleStop = async () => {
    started.current = false;
    setStatus("idle");
    await invoke("tts_stop").catch(() => {});
  };

  // A new speed applies from the start: the system voices can't change pace
  // mid-sentence, so a running reading starts over.
  const handleSpeed = async () => {
    const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
    setRate(next);
    if (status !== "idle") await start(next);
  };

  const noVoice = !availability.voice;
  const notice = !text
    ? t("summary.audioMemo.noReport")
    : noVoice
      ? t("summary.audioMemo.noVoice")
      : error;
  const canPlay = Boolean(text) && !noVoice;

  return (
    <div
      data-testid="audio-memo"
      className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 flex items-center justify-center">
            <Volume2
              className={`w-4 h-4 ${status === "speaking" ? "animate-pulse" : ""}`}
            />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-white">
              {t("summary.audioMemo.button")}
            </h4>
            <p className="text-[11px] text-slate-400 truncate">
              {status === "speaking"
                ? t("summary.audioMemo.playing")
                : status === "paused"
                  ? t("summary.audioMemo.paused")
                  : t("summary.audioMemo.subtitle")}
              {status !== "idle" && voice && (
                <span className="text-slate-500">
                  {" · "}
                  {t("summary.audioMemo.voice", { voice })}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSpeed}
            disabled={!canPlay}
            className="h-8 px-2.5 rounded-lg text-xs font-mono font-semibold bg-slate-800 hover:bg-slate-700 text-indigo-200 border border-slate-700 transition flex items-center gap-1 disabled:opacity-40"
            title={t("summary.audioMemo.speed")}
            aria-label={`${t("summary.audioMemo.speed")}: ${rate}x`}
          >
            <FastForward className="w-3 h-3" />
            <span>{rate}x</span>
          </button>

          <button
            type="button"
            onClick={handlePlayPause}
            disabled={!canPlay}
            className="h-8 px-3.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === "speaking" ? (
              <>
                <Pause className="w-3.5 h-3.5 fill-current" />
                <span>{t("summary.audioMemo.pause")}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>
                  {status === "paused"
                    ? t("summary.audioMemo.resume")
                    : t("summary.audioMemo.play")}
                </span>
              </>
            )}
          </button>

          {status !== "idle" && (
            <button
              type="button"
              onClick={handleStop}
              className="h-8 w-8 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-700 transition flex items-center justify-center"
              title={t("summary.audioMemo.stop")}
              aria-label={t("summary.audioMemo.stop")}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p
          role={error ? "alert" : "status"}
          className="flex items-start gap-1.5 text-[11px] text-amber-200/90"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px text-amber-400" />
          <span>{notice}</span>
        </p>
      )}
    </div>
  );
};
