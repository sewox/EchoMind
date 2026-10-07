import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { englishVoice } from "./useVoicePacks";

export interface NeuralSection {
  text: string;
  foreign?: string[];
}

interface Callbacks {
  /** The section finished playing on its own. */
  onEnded: () => void;
  /** Share of the current section played (0..1). */
  onProgress: (fraction: number) => void;
  /** Share of the section being waited for that is rendered (0..1). */
  onRenderProgress?: (fraction: number) => void;
}

interface Rendered {
  job: number;
  url: Promise<string>;
}

let nextJob = 1;

/**
 * The on-device neural voices (EMA for Turkish, Kokoro for English): renders a section to WAV in the
 * backend, plays it in an <audio> element, renders the next one meanwhile.
 * Speed changes apply at once (the browser keeps the pitch).
 */
export function useNeuralVoice(
  lang: string,
  { onEnded, onProgress, onRenderProgress }: Callbacks,
) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, Rendered>());
  // The render `play` is waiting for; its progress goes to onRenderProgress.
  const waiting = useRef<number | null>(null);
  const handlers = useRef({ onEnded, onProgress, onRenderProgress });
  handlers.current = { onEnded, onProgress, onRenderProgress };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      unlisten = await listen<{ job: number; fraction: number }>(
        "neural-voice-progress",
        (event) => {
          if (event.payload.job === waiting.current)
            handlers.current.onRenderProgress?.(event.payload.fraction);
        },
      );
      if (cancelled) unlisten();
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const render = useCallback(
    (section: NeuralSection): Rendered => {
      const key = `${englishVoice()}\u0000${section.text}`;
      let rendered = urls.current.get(key);
      if (!rendered) {
        const job = nextJob++;
        const url = invoke<ArrayBuffer>("neural_voice_render", {
          text: section.text,
          lang,
          foreign: section.foreign ?? [],
          voice: englishVoice(),
          job,
        }).then((bytes) =>
          URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })),
        );
        // A failed render may be retried later.
        url.catch(() => urls.current.delete(key));
        rendered = { job, url };
        urls.current.set(key, rendered);
      }
      return rendered;
    },
    [lang],
  );

  const element = () => {
    if (!audio.current) {
      const a = new Audio();
      a.addEventListener("ended", () => handlers.current.onEnded());
      a.addEventListener("timeupdate", () => {
        if (a.duration > 0)
          handlers.current.onProgress(a.currentTime / a.duration);
      });
      audio.current = a;
    }
    return audio.current;
  };

  /** Plays `sections[index]` (rendering it if needed) and prepares the next. */
  const play = useCallback(
    async (sections: NeuralSection[], index: number, rate: number) => {
      const { job, url: pending } = render(sections[index]);
      waiting.current = job;
      let url: string;
      try {
        url = await pending;
      } finally {
        if (waiting.current === job) waiting.current = null;
      }
      handlers.current.onRenderProgress?.(1);
      const a = element();
      a.src = url;
      a.playbackRate = rate;
      await a.play();
      if (index + 1 < sections.length)
        render(sections[index + 1]).url.catch(() => {});
    },
    [render],
  );

  const pause = useCallback(() => audio.current?.pause(), []);
  const resume = useCallback(async () => {
    await audio.current?.play();
  }, []);
  const stop = useCallback(() => {
    const a = audio.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
  }, []);
  const setRate = useCallback((rate: number) => {
    if (audio.current) audio.current.playbackRate = rate;
  }, []);

  /** Forget rendered audio (a new script or report). */
  const reset = useCallback(() => {
    stop();
    const old = urls.current;
    urls.current = new Map();
    old.forEach(({ url }) =>
      url.then((u) => URL.revokeObjectURL(u)).catch(() => {}),
    );
  }, [stop]);

  useEffect(() => () => reset(), [reset]);

  return { play, pause, resume, stop, setRate, reset };
}
