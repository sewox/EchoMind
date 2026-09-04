import { FC, useEffect, useState } from "react";
import { Mic, Zap, X, Video } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { I18nProvider, useI18n } from "../locales/i18nContext";
import { MeetingAppInfo } from "../hooks/useMeetingDetector";

const IslandContent: FC = () => {
  const { t } = useI18n();
  const [appInfo, setAppInfo] = useState<MeetingAppInfo>({
    app_id: "meeting",
    display_name: "Google Meet",
    process_name: "Google Chrome",
    is_running: true,
    recommended_title: "Google Meet Toplantısı",
  });

  useEffect(() => {
    // Listen for meeting detection in the island overlay
    const unlistenDetected = listen<MeetingAppInfo[]>(
      "meeting-detected",
      (event) => {
        const apps = event.payload || [];
        if (apps.length > 0) {
          setAppInfo(apps[0]);
        }
      },
    );

    const unlistenEnded = listen("meeting-ended", () => {
      invoke("hide_island_window").catch(() => {});
    });

    // Check status on mount
    invoke<any>("get_detector_status")
      .then((status) => {
        if (status && status.detected_apps && status.detected_apps.length > 0) {
          setAppInfo(status.detected_apps[0]);
        }
      })
      .catch(() => {});

    return () => {
      unlistenDetected.then((f) => f());
      unlistenEnded.then((f) => f());
    };
  }, []);

  const handleStart = async () => {
    try {
      const selectedDevice =
        localStorage.getItem("echomind_selected_audio_device") || undefined;
      await invoke("start_meeting_recording", {
        deviceName: selectedDevice,
        meetingTitle: appInfo.recommended_title,
      });
    } catch (err) {
      console.error("Failed to start from island:", err);
    }
  };

  const handleAlwaysAutoStart = async () => {
    try {
      await invoke("update_detector_settings", {
        settings: {
          enabled: true,
          auto_start_record: true,
          auto_stop_on_app_close: true,
          ignored_apps: [],
        },
      });
      await handleStart();
    } catch (err) {
      console.error("Failed to update auto start:", err);
    }
  };

  const handleDismiss = async () => {
    await invoke("hide_island_window").catch(() => {});
  };

  return (
    <div className="w-full h-full flex items-center justify-center p-1 bg-transparent select-none font-sans">
      <div className="w-full bg-slate-950/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl px-4 py-2.5 shadow-2xl shadow-black/80 flex items-center justify-between gap-3 text-slate-100">
        {/* Left: App Info & Title (Draggable, Clean, NO pulse) */}
        <div
          data-tauri-drag-region
          className="flex items-center gap-2.5 min-w-0 cursor-grab active:cursor-grabbing flex-1"
        >
          <div
            data-tauri-drag-region
            className="w-7 h-7 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0"
          >
            <Video className="w-3.5 h-3.5 pointer-events-none" />
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-white truncate">
                {appInfo.display_name}
              </span>
              <span className="text-[10px] font-medium text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded border border-emerald-500/30">
                Aktif
              </span>
            </div>
            <span className="text-[11px] text-slate-400 truncate">
              Toplantıyı kaydetmek istiyor musunuz?
            </span>
          </div>
        </div>

        {/* Right: Clean Action Buttons (NO pulse) */}
        <div className="flex items-center gap-2 shrink-0 pointer-events-auto">
          <button
            type="button"
            onClick={handleAlwaysAutoStart}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700/80 transition active:scale-95 cursor-pointer"
            title={t("detector.autoStartAlways")}
          >
            <Zap className="w-3 h-3 text-amber-400" />
            <span className="hidden sm:inline text-[11px]">Otomatik</span>
          </button>

          <button
            type="button"
            onClick={handleStart}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 border border-cyan-400/40 shadow-sm transition active:scale-95 cursor-pointer"
            title={t("detector.startNow")}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>{t("detector.startNow")}</span>
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800/80 transition cursor-pointer"
            title={t("detector.dismiss")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export const MeetingIslandWindow: FC = () => {
  return (
    <I18nProvider>
      <IslandContent />
    </I18nProvider>
  );
};
