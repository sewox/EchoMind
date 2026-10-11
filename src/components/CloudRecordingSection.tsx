import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, CloudUpload } from "lucide-react";
import { useI18n } from "../locales/i18nContext";

interface CloudRecordingState {
  enabled: boolean;
  provider: string | null;
  has_key: boolean;
  allowed: boolean;
}

const PROVIDER_NAMES: Record<string, string> = {
  groq: "Groq",
  openai: "OpenAI",
  gemini: "Gemini",
};

/**
 * Cloud speech recognition for recordings (live and after them). Off by
 * default: recordings stay on the device and the cloud engine is used only
 * for imports and re-transcriptions. `activeEngine` refreshes the state when
 * the engine changes.
 */
export const CloudRecordingSection: React.FC<{ activeEngine: string }> = ({
  activeEngine,
}) => {
  const { t } = useI18n();
  const [state, setState] = useState<CloudRecordingState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => invoke<CloudRecordingState>("get_cloud_recording"))
      .then((s) => {
        if (!cancelled && s) setState(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeEngine]);

  if (!state) return null;

  const toggle = async () => {
    setSaving(true);
    try {
      const next = await invoke<CloudRecordingState>("set_cloud_recording", {
        enabled: !state.enabled,
      });
      if (next) setState(next);
    } catch {
      // Keep the shown state: nothing changed.
    } finally {
      setSaving(false);
    }
  };

  const provider = state.provider
    ? (PROVIDER_NAMES[state.provider] ?? state.provider)
    : null;
  const notice = !state.allowed
    ? t("cloudRecording.paranoid")
    : !state.enabled
      ? null
      : !provider
        ? t("cloudRecording.noEngine")
        : !state.has_key
          ? t("cloudRecording.noKey", { provider })
          : null;
  const status =
    state.allowed && state.enabled && provider && state.has_key
      ? t("cloudRecording.active", { provider })
      : t("cloudRecording.onDevice");

  return (
    <section
      data-testid="cloud-recording-section"
      className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="font-semibold text-white text-sm flex items-center gap-2">
            <CloudUpload className="w-4 h-4 text-amber-400" />
            {t("cloudRecording.title")}
          </h3>
          <p className="text-slate-400">{t("cloudRecording.desc")}</p>
          <p className="text-[11px] text-slate-500">{status}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          aria-label={t("cloudRecording.title")}
          disabled={saving || !state.allowed}
          onClick={toggle}
          className={`relative shrink-0 w-10 h-6 rounded-full transition disabled:opacity-40 ${
            state.enabled ? "bg-amber-500" : "bg-slate-700"
          }`}
        >
          <span
            className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
              state.enabled ? "left-5" : "left-1"
            }`}
          />
        </button>
      </div>
      {notice && (
        <p
          role="status"
          className="flex items-start gap-1.5 text-[11px] text-amber-200/90"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px text-amber-400" />
          <span>{notice}</span>
        </p>
      )}
    </section>
  );
};
