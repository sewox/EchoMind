import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  FastForward,
  Loader2,
  Pause,
  Play,
  Square,
  Volume2,
} from "lucide-react";
import { useI18n, translatorFor } from "../../locales/i18nContext";
import { useNeuralVoice } from "../../hooks/useNeuralVoice";
import { SummaryResult } from "../TranscriptViewer";

interface AudioMemoPlayerProps {
  summary: SummaryResult | null;
  meetingTitle?: string;
  /** Report language; the briefing is written and read in it. */
  langCode?: string;
}

interface TtsAvailability {
  supported: boolean;
  voice: string | null;
}

export interface BriefingSection {
  title: string;
  text: string;
  /** Words the script writer marked as English (for the Turkish voice). */
  foreign?: string[];
}

type Status = "idle" | "preparing" | "speaking" | "paused";
type Length = "short" | "standard";

const SPEEDS = [1, 1.25, 1.5];
/** Share of the preparation bar for writing the script when a neural voice
 * then renders the first section (the rest is the rendering). */
const SCRIPT_SHARE = 0.75;

interface Prep {
  step: "script" | "voice";
  /** Share of this step done (0..1). */
  fraction: number;
}

const filled = (items?: string[]) =>
  (items || []).map((s) => s.trim()).filter(Boolean);

/** Strips trailing sentence punctuation so the templates add exactly one. */
const sentence = (text: string) => text.trim().replace(/[.!?]+$/u, "");

/**
 * The report read as it is (goal, decisions, tasks, summary) when no
 * on-device model can write a briefing. Empty when the report has none.
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

const call = <T,>(cmd: string, args?: Record<string, unknown>) =>
  Promise.resolve().then(() =>
    args === undefined ? invoke<T>(cmd) : invoke<T>(cmd, args),
  );

/**
 * Reads the meeting as an audio briefing with the operating system's voices
 * (AVSpeechSynthesizer on macOS, SAPI on Windows). The on-device model writes
 * a spoken script in sections; without it the report itself is read. Hidden
 * where the system offers no voices to the app (Linux for now).
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
  const [length, setLength] = useState<Length>("short");
  const [sections, setSections] = useState<BriefingSection[] | null>(null);
  const [fromTemplate, setFromTemplate] = useState(false);
  const [current, setCurrent] = useState(0);
  // Share of the current section read so far (0…1).
  const [sectionProgress, setSectionProgress] = useState(0);
  const [prep, setPrep] = useState<Prep>({ step: "script", fraction: 0 });
  const [voice, setVoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The on-device neural Turkish voice is installed (falls back to the
  // system voice for other languages or if it fails).
  const [neural, setNeural] = useState(false);

  // The engine's end-of-reading event needs the latest values.
  const live = useRef({ sections, current, rate, status, neural });
  live.current = { sections, current, rate, status, neural };
  const started = useRef(false);
  const advanceRef = useRef<() => void>(() => {});
  const voiceEngine = useNeuralVoice(langCode, {
    onEnded: () => advanceRef.current(),
    onProgress: setSectionProgress,
    onRenderProgress: (fraction) => {
      if (live.current.status === "preparing")
        setPrep({ step: "voice", fraction });
    },
  });

  const template = useMemo(
    () => buildMemoText(summary, meetingTitle, langCode),
    [summary, meetingTitle, langCode],
  );

  useEffect(() => {
    let cancelled = false;
    call<TtsAvailability>("tts_availability", { lang: langCode })
      .then((a) => {
        if (!cancelled) setAvailability(a ?? null);
      })
      .catch(() => {
        if (!cancelled) setAvailability({ supported: false, voice: null });
      });
    call<boolean>("neural_voice_available", { lang: langCode })
      .then((ok) => {
        if (!cancelled) setNeural(ok === true);
      })
      .catch(() => {
        if (!cancelled) setNeural(false);
      });
    return () => {
      cancelled = true;
    };
  }, [langCode]);

  const errorText = (err: unknown) => {
    const code = err instanceof Error ? err.message : String(err);
    if (code === "no_voice") return t("summary.audioMemo.noVoice");
    if (code === "empty_text" || code === "empty_report")
      return t("summary.audioMemo.noReport");
    return t("summary.audioMemo.error", { error: code });
  };

  const speakSection = async (
    list: BriefingSection[],
    index: number,
    speed: number,
  ): Promise<void> => {
    if (live.current.neural) {
      try {
        await voiceEngine.play(list, index, speed);
        started.current = true;
        setVoice(t("summary.audioMemo.neuralVoice"));
        setCurrent(index);
        setSectionProgress(0);
        setStatus("speaking");
        return;
      } catch (err) {
        // The neural voice failed: say so and use the system voice instead.
        setNeural(false);
        live.current.neural = false;
        setError(
          t("summary.audioMemo.neuralFailed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
    try {
      const used = await call<string>("tts_speak", {
        text: list[index].text,
        lang: langCode,
        rate: speed,
      });
      started.current = true;
      setVoice(used);
      setCurrent(index);
      setSectionProgress(0);
      setStatus("speaking");
    } catch (err) {
      started.current = false;
      setStatus("idle");
      setError(errorText(err));
    }
  };

  // Next section when one ends on its own; idle after the last.
  advanceRef.current = () => {
    const { sections: list, current: index, rate: speed } = live.current;
    if (list && index + 1 < list.length && started.current) {
      speakSection(list, index + 1, speed);
    } else {
      started.current = false;
      setStatus("idle");
      setCurrent(0);
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      unlisten = await listen<{ state: string }>("tts-state", (event) => {
        if (event.payload.state !== "idle" || live.current.neural) return;
        advanceRef.current();
      });
      if (cancelled) unlisten();
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
    // Registered once; speakSection reads the latest values from `live`.
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      unlisten = await listen<{ percent: number }>(
        "briefing-progress",
        (event) =>
          setPrep({ step: "script", fraction: event.payload.percent / 100 }),
      );
      if (cancelled) unlisten();
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Where the system voice is in the current section, for the progress bar
  // (the neural voice reports it from its <audio> element).
  useEffect(() => {
    if (status !== "speaking" || neural) return;
    const timer = setInterval(() => {
      call<number>("tts_progress")
        .then((p) => {
          if (typeof p === "number") setSectionProgress(p);
        })
        .catch(() => {});
    }, 300);
    return () => clearInterval(timer);
  }, [status, current, neural]);

  // A new report, language or length needs a new script; never keep reading
  // the old one.
  useEffect(() => {
    setSections(null);
    setFromTemplate(false);
    setCurrent(0);
    return () => {
      voiceEngine.reset();
      if (started.current) {
        started.current = false;
        setStatus("idle");
        call("tts_stop").catch(() => {});
      }
    };
    // voiceEngine is stable for a language; this runs for content changes.
  }, [template, langCode, length]);

  if (!neural && (!availability || !availability.supported)) return null;

  const prepare = async (): Promise<BriefingSection[] | null> => {
    if (sections) return sections;
    let list: BriefingSection[];
    try {
      list = await call<BriefingSection[]>("generate_briefing", {
        title: meetingTitle ?? "",
        report: summary,
        lang: langCode,
        length,
      });
      if (!Array.isArray(list) || !list.length) throw new Error("empty");
      setFromTemplate(false);
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      // Without a model (or if it failed) the report itself is read.
      list = [{ title: t("summary.audioMemo.button"), text: template }];
      setFromTemplate(true);
      if (code !== "no_model") setError(errorText(err));
    }
    setSections(list);
    return list;
  };

  const handlePlayPause = async () => {
    if (status === "idle") {
      // One wait, one bar: writing the script, then the first section's audio.
      setError(null);
      setStatus("preparing");
      live.current.status = "preparing";
      setPrep({ step: sections ? "voice" : "script", fraction: 0 });
      const list = await prepare();
      if (!list) return;
      if (live.current.neural) setPrep({ step: "voice", fraction: 0 });
      await speakSection(list, 0, rate);
      return;
    }
    if (status === "preparing") return;
    try {
      if (neural) {
        if (status === "speaking") voiceEngine.pause();
        else await voiceEngine.resume();
        setStatus(status === "speaking" ? "paused" : "speaking");
        return;
      }
      const next = await call<Status>(
        status === "speaking" ? "tts_pause" : "tts_resume",
      );
      setStatus(next === "idle" ? "idle" : next);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const handleStop = async () => {
    started.current = false;
    setStatus("idle");
    setCurrent(0);
    voiceEngine.stop();
    if (!neural) await call("tts_stop").catch(() => {});
  };

  // The neural voice changes pace at once; the system voices can't change
  // pace mid-sentence, so their current section starts over.
  const handleSpeed = async () => {
    const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
    setRate(next);
    if (neural) {
      voiceEngine.setRate(next);
      return;
    }
    if ((status === "speaking" || status === "paused") && sections)
      await speakSection(sections, current, next);
  };

  const handleJump = (index: number) => {
    if (sections && status !== "preparing") speakSection(sections, index, rate);
  };

  const noVoice = !neural && !availability?.voice;
  const notice = !template
    ? t("summary.audioMemo.noReport")
    : noVoice
      ? t("summary.audioMemo.noVoice")
      : error;
  const canPlay = Boolean(template) && !noVoice;
  const busy = status === "preparing";
  const reading = status === "speaking" || status === "paused";

  // Overall position across sections, weighted by their length.
  const lengths = (sections || []).map((s) => Math.max(1, s.text.length));
  const totalChars = lengths.reduce((a, b) => a + b, 0) || 1;
  const doneChars =
    lengths.slice(0, current).reduce((a, b) => a + b, 0) +
    (lengths[current] || 0) * sectionProgress;
  const overall = Math.round((doneChars / totalChars) * 100);

  // Writing and rendering on one scale; without a neural voice the script is
  // the whole wait (the system voice starts at once).
  const scriptShare = neural ? SCRIPT_SHARE : 1;
  const prepPercent = Math.round(
    100 *
      (prep.step === "script"
        ? prep.fraction * scriptShare
        : scriptShare + prep.fraction * (1 - scriptShare)),
  );

  const statusLine =
    status === "preparing"
      ? `${t("summary.audioMemo.preparing", { percent: prepPercent })} · ${t(
          prep.step === "script"
            ? "summary.audioMemo.stepScript"
            : "summary.audioMemo.stepVoice",
        )}`
      : status === "speaking"
        ? t("summary.audioMemo.playing")
        : status === "paused"
          ? t("summary.audioMemo.paused")
          : t("summary.audioMemo.subtitle");

  return (
    <div
      data-testid="audio-memo"
      className="p-3.5 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 flex items-center justify-center">
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Volume2
                className={`w-4 h-4 ${status === "speaking" ? "animate-pulse" : ""}`}
              />
            )}
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-white">
              {t("summary.audioMemo.button")}
            </h4>
            <p className="text-[11px] text-slate-400 truncate">
              {statusLine}
              {(status === "speaking" || status === "paused") && voice && (
                <span className="text-slate-500">
                  {" · "}
                  {t("summary.audioMemo.voice", { voice })}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div
            role="radiogroup"
            aria-label={t("summary.audioMemo.length")}
            className="flex items-center p-0.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-semibold"
          >
            {(["short", "standard"] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={length === l}
                disabled={!canPlay || busy}
                onClick={() => setLength(l)}
                title={t(`summary.audioMemo.${l}`)}
                className={`h-7 px-2 rounded-md transition disabled:opacity-40 ${
                  length === l
                    ? "bg-indigo-500/25 text-indigo-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t(`summary.audioMemo.${l}Duration`)}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSpeed}
            disabled={!canPlay || busy}
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
            disabled={!canPlay || busy}
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

          {(status === "speaking" || status === "paused") && (
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

      {busy && (
        <div
          className="h-1 rounded-full bg-slate-800 overflow-hidden"
          role="progressbar"
          aria-label={t("summary.audioMemo.preparing", {
            percent: prepPercent,
          })}
          aria-valuenow={prepPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-indigo-500 transition-all"
            style={{ width: `${Math.max(3, prepPercent)}%` }}
          />
        </div>
      )}

      {sections && reading && (
        <div className="space-y-2" data-testid="audio-memo-progress">
          <div
            className="relative h-1.5 rounded-full bg-slate-800 overflow-hidden"
            role="progressbar"
            aria-label={t("summary.audioMemo.progress")}
            aria-valuenow={overall}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-indigo-400 transition-[width] duration-300"
              style={{ width: `${overall}%` }}
            />
            {lengths.slice(0, -1).map((_, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="absolute top-0 h-full w-0.5 bg-slate-900"
                style={{
                  left: `${(lengths.slice(0, i + 1).reduce((a, b) => a + b, 0) / totalChars) * 100}%`,
                }}
              />
            ))}
          </div>
          <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2">
            <div className="text-[11px] font-semibold text-indigo-200">
              {t("summary.audioMemo.section", {
                current: current + 1,
                total: sections.length,
              })}
              {" · "}
              {sections[current]?.title}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {sections[current]?.text}
            </p>
          </div>
        </div>
      )}

      {sections && sections.length > 1 && (
        <ol className="flex flex-wrap gap-1.5">
          {sections.map((s, i) => {
            const active = status !== "idle" && i === current;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => handleJump(i)}
                  aria-current={active ? "step" : undefined}
                  className={`h-7 px-2.5 rounded-lg border text-[11px] font-medium transition ${
                    active
                      ? "bg-indigo-500/20 border-indigo-400/50 text-indigo-100"
                      : "bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                  }`}
                >
                  <span className="text-slate-500 mr-1">{i + 1}.</span>
                  {s.title}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {fromTemplate && !error && status !== "idle" && (
        <p className="text-[11px] text-slate-500">
          {t("summary.audioMemo.templateNote")}
        </p>
      )}

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
