import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface MeetingAppInfo {
  app_id: string;
  display_name: string;
  process_name: string;
  is_running: boolean;
  recommended_title: string;
}

export interface DetectorSettings {
  enabled: boolean;
  auto_start_record: boolean;
  auto_stop_on_app_close: boolean;
  ignored_apps: string[];
}

export interface DetectorStatus {
  is_active: boolean;
  detected_apps: MeetingAppInfo[];
  active_count: number;
  last_check_timestamp: string;
  settings: DetectorSettings;
}

export interface UseMeetingDetectorOptions {
  isRecording: boolean;
  onAutoStartMeeting?: (app: MeetingAppInfo) => void;
  onAutoStopMeeting?: () => void;
}

export function useMeetingDetector({
  isRecording,
  onAutoStartMeeting,
  onAutoStopMeeting,
}: UseMeetingDetectorOptions) {
  const [activeApps, setActiveApps] = useState<MeetingAppInfo[]>([]);
  const [promptApp, setPromptApp] = useState<MeetingAppInfo | null>(null);
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  const [settings, setSettings] = useState<DetectorSettings>({
    enabled: true,
    auto_start_record: false,
    auto_stop_on_app_close: true,
    ignored_apps: [],
  });

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;

  const onAutoStartRef = useRef(onAutoStartMeeting);
  onAutoStartRef.current = onAutoStartMeeting;

  const onAutoStopRef = useRef(onAutoStopMeeting);
  onAutoStopRef.current = onAutoStopMeeting;

  // Fetch initial detector status
  const fetchStatus = useCallback(async () => {
    try {
      const status = await invoke<DetectorStatus>("get_detector_status");
      if (status) {
        setIsMonitoring(status.is_active);
        const apps = status.detected_apps || [];
        setActiveApps(apps);
        if (status.settings) {
          setSettings(status.settings);
        }
        if (apps.length > 0 && !isRecordingRef.current) {
          setPromptApp(apps[0]);
        }
      }
    } catch {
      // Ignored in non-Tauri or initial mount
    }
  }, []);

  // Update detector settings
  const updateSettings = useCallback(
    async (newSettings: Partial<DetectorSettings>) => {
      setSettings((prev) => {
        const merged = { ...prev, ...newSettings };
        settingsRef.current = merged;
        invoke<DetectorStatus>("update_detector_settings", { settings: merged })
          .then((res) => {
            if (res && res.settings) {
              setSettings(res.settings);
            }
          })
          .catch(() => {});
        return merged;
      });
    },
    [],
  );

  // Dismiss prompt for current session
  const dismissPrompt = useCallback((_appId?: string) => {
    setPromptApp(null);
  }, []);

  // Start detector monitoring and subscribe to events
  useEffect(() => {
    let unlistenDetected: UnlistenFn | undefined;
    let unlistenEnded: UnlistenFn | undefined;

    const setup = async () => {
      try {
        await invoke("start_meeting_detector");
        setIsMonitoring(true);

        unlistenDetected = await listen<MeetingAppInfo[]>(
          "meeting-detected",
          (event) => {
            const apps = event.payload || [];
            setActiveApps(apps);

            if (apps.length > 0 && !isRecordingRef.current) {
              const primary = apps[0];
              if (settingsRef.current.auto_start_record) {
                onAutoStartRef.current?.(primary);
              } else {
                setPromptApp(primary);
              }
            }
          },
        );

        unlistenEnded = await listen<MeetingAppInfo[]>("meeting-ended", () => {
          setActiveApps([]);
          setPromptApp(null);

          if (
            isRecordingRef.current &&
            settingsRef.current.auto_stop_on_app_close
          ) {
            onAutoStopRef.current?.();
          }
        });
      } catch {
        // Fallback for tests or initial environment
      }
    };

    setup();
    fetchStatus();

    return () => {
      unlistenDetected?.();
      unlistenEnded?.();
    };
  }, [fetchStatus]);

  // When recording starts, clear prompt
  useEffect(() => {
    if (isRecording) {
      setPromptApp(null);
    }
  }, [isRecording]);

  return {
    activeApps,
    promptApp,
    isMonitoring,
    settings,
    dismissPrompt,
    updateSettings,
    fetchStatus,
  };
}
