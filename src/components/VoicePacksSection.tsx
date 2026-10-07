import React, { useState } from "react";
import {
  AudioLines,
  CheckCircle2,
  Download,
  Loader2,
  Trash2,
} from "lucide-react";
import { useI18n } from "../locales/i18nContext";
import {
  ENGLISH_VOICES,
  EnglishVoice,
  englishVoice,
  setEnglishVoice,
  useVoicePacks,
} from "../hooks/useVoicePacks";

const mb = (bytes: number) => Math.round(bytes / 1_000_000);

/** Model Hub section: natural on-device voices for the audio briefing. */
export const VoicePacksSection: React.FC = () => {
  const { t } = useI18n();
  const { packs, downloads, download, remove } = useVoicePacks();
  const [voice, setVoice] = useState<EnglishVoice>(englishVoice);

  if (packs.length === 0) return null;

  const choose = (v: EnglishVoice) => {
    setVoice(v);
    setEnglishVoice(v);
  };

  return (
    <section
      className="pt-4 mt-2 border-t border-slate-800/80 space-y-3"
      data-testid="voice-packs-section"
    >
      <div>
        <h3 className="font-semibold text-white text-sm flex items-center gap-2">
          <AudioLines className="w-4 h-4 text-cyan-400" />
          {t("voicePacks.title")}
        </h3>
        <p className="text-xs text-slate-400 mt-1">{t("voicePacks.desc")}</p>
      </div>

      {packs.map((p) => {
        const dl = downloads[p.key];
        const busy = dl?.status === "downloading";
        return (
          <div
            key={p.key}
            data-testid={`voice-pack-${p.key}`}
            className={`p-3 rounded-xl border space-y-2 ${
              p.installed
                ? "bg-slate-800/90 border-emerald-500/70"
                : "bg-slate-900/60 border-slate-800"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">
                  {t(`voicePacks.${p.lang === "tr" ? "turkish" : "english"}`)}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {p.name} · {mb(p.size_bytes)} MB
                </div>
              </div>
              <div className="shrink-0">
                {p.installed ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-emerald-300 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t("voicePacks.installed")}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(p.key)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-slate-800"
                      title={t("voicePacks.delete")}
                      aria-label={t("voicePacks.delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : p.downloadable ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => download(p.key)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-60 flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {t("voicePacks.downloading", {
                          percent: Math.round(dl.percent),
                        })}
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        {t("voicePacks.download", { size: mb(p.size_bytes) })}
                      </>
                    )}
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">
                    {t("voicePacks.soon")}
                  </span>
                )}
              </div>
            </div>
            {busy && (
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                  style={{ width: `${Math.max(2, dl.percent)}%` }}
                />
              </div>
            )}
            {dl?.status === "error" && (
              <p
                role="alert"
                className="text-[11px] text-rose-300 [overflow-wrap:anywhere]"
              >
                {t("voicePacks.error", { error: dl.error ?? "" })}
              </p>
            )}
            {p.lang === "en" && p.installed && (
              <div
                role="radiogroup"
                aria-label={t("voicePacks.voice")}
                className="flex gap-2"
              >
                {ENGLISH_VOICES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={voice === v}
                    onClick={() => choose(v)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] border transition ${
                      voice === v
                        ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-200"
                        : "border-slate-700 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {t(`voicePacks.${v}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
};
