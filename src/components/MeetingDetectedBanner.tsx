import { FC, useEffect, useRef } from "react";
import { Mic, Zap, X, Radio } from "lucide-react";
import { useI18n } from "../locales/i18nContext";
import { MeetingAppInfo } from "../hooks/useMeetingDetector";

interface MeetingDetectedBannerProps {
  appInfo: MeetingAppInfo;
  onStart: (app: MeetingAppInfo) => void;
  onAlwaysAutoStart: (app: MeetingAppInfo) => void;
  onDismiss: (appId: string) => void;
}

// Gentle pleasant notification chime synthesized via Web Audio API
const playGentleChime = () => {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Harmonic bell tone 1 (587.33 Hz - D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.12, now + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.6);

    // Harmonic bell tone 2 (880 Hz - A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.08);
    gain2.gain.setValueAtTime(0, now + 0.08);
    gain2.gain.linearRampToValueAtTime(0.15, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.8);
  } catch {
    // AudioContext fallback silent
  }
};

export const MeetingDetectedBanner: FC<MeetingDetectedBannerProps> = ({
  appInfo,
  onStart,
  onAlwaysAutoStart,
  onDismiss,
}) => {
  const { t } = useI18n();
  const hasPlayedChime = useRef(false);

  useEffect(() => {
    if (!hasPlayedChime.current) {
      hasPlayedChime.current = true;
      playGentleChime();
    }
  }, []);

  return (
    <div
      role="alert"
      className="fixed top-6 left-1/2 -translate-x-1/2 z-[99999] pointer-events-auto max-w-xl w-[92vw] md:w-auto animate-in fade-in slide-in-from-top-6 zoom-in-95 duration-400"
    >
      {/* Floating Dynamic Island Container */}
      <div className="bg-[#050811]/95 backdrop-blur-2xl border border-cyan-400/50 rounded-full px-5 py-3 shadow-2xl shadow-cyan-950/90 flex items-center justify-between gap-4 md:gap-6 relative overflow-hidden group hover:border-cyan-300 transition-all duration-300 ring-4 ring-cyan-500/10">
        {/* Ambient Top Glow */}
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-48 h-20 bg-cyan-400/20 rounded-full blur-2xl pointer-events-none group-hover:bg-cyan-400/30 transition-all duration-500" />

        {/* Left: App Info */}
        <div className="flex items-center gap-3.5 z-10 shrink-0">
          <div className="w-8 h-8 rounded-full bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Radio className="w-4 h-4 text-cyan-400" />
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-500/30">
                {t("detector.detectedApp")}
              </span>
              <span className="text-xs font-semibold text-white">
                {appInfo.display_name}
              </span>
            </div>
            <span className="text-[11px] text-slate-300 line-clamp-1 font-medium mt-0.5">
              {t("detector.bannerDesc")}
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 z-10 shrink-0">
          {/* Always Auto Start */}
          <button
            onClick={() => onAlwaysAutoStart(appInfo)}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 border border-white/10 transition active:scale-95"
            title={t("detector.autoStartAlways")}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>{t("detector.autoStartAlways")}</span>
          </button>

          {/* Start Meeting Now */}
          <button
            onClick={() => onStart(appInfo)}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-500 border border-cyan-400/40 shadow-sm transition active:scale-95"
            title={t("detector.startNow")}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>{t("detector.startNow")}</span>
          </button>

          {/* Dismiss button */}
          <button
            onClick={() => onDismiss(appInfo.app_id)}
            className="text-slate-400 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition"
            title={t("detector.dismiss")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
