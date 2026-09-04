import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AudioStatus } from "../App";

export function useAudioRecording() {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [audioStatus, setAudioStatus] = useState<AudioStatus | null>(null);

  // Sync with global recording events & Rust audio engine status continuously
  useEffect(() => {
    const unlistenStart = listen<{ title?: string }>(
      "trigger-start-recording",
      () => {
        setIsRecording(true);
      },
    );
    const unlistenStop = listen("trigger-stop-recording", () => {
      setIsRecording(false);
    });

    const checkStatus = () => {
      try {
        const res = invoke<AudioStatus>("get_audio_status");
        if (res && typeof res.then === "function") {
          res
            .then((status) => {
              if (status) {
                setIsRecording(status.is_recording);
                setAudioStatus(status.is_recording ? status : null);
              }
            })
            .catch(() => {});
        }
      } catch {
        // safe fallback
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 500);

    return () => {
      clearInterval(interval);
      unlistenStart.then((f) => f());
      unlistenStop.then((f) => f());
    };
  }, []);

  // Recording duration timer
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isRecording) {
      timer = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordingSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isRecording]);

  const startRecording = async () => {
    try {
      await invoke("start_audio_capture");
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
      throw err;
    }
  };

  const stopRecording = async () => {
    try {
      await invoke("stop_audio_capture");
      setIsRecording(false);
    } catch (err) {
      console.error("Failed to stop recording:", err);
      throw err;
    }
  };

  const cancelRecording = async () => {
    try {
      await invoke("cancel_audio_capture");
      setIsRecording(false);
      setRecordingSeconds(0);
    } catch (err) {
      console.error("Failed to cancel recording:", err);
    }
  };

  return {
    isRecording,
    recordingSeconds,
    audioStatus,
    startRecording,
    stopRecording,
    cancelRecording,
    setIsRecording,
  };
}
