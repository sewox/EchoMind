import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface NeuralSection {
  text: string;
  foreign?: string[];
}

interface Callbacks {
  /** The section finished playing on its own. */
  onEnded: () => void;
  /** Share of the current section played (0..1). */
  onProgress: (fraction: number) => void;
}

/**
 * The on-device neural Turkish voice (EMA): renders a section to WAV in the
 * backend, plays it in an <audio> element, renders the next one meanwhile.
 * Speed changes apply at once (the browser keeps the pitch).
 */
export function useNeuralVoice(
  lang: string,
  { onEnded, onProgress }: Callbacks,
) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, Promise<string>>());
  const handlers = useRef({ onEnded, onProgress });
  handlers.current = { onEnded, onProgress };

  const render = useCallback(
    (section: NeuralSection): Promise<string> => {
      const key = section.text;
      let url = urls.current.get(key);
      if (!url) {
        url = invoke<ArrayBuffer>("neural_voice_render", {
          text: section.text,
          lang,
          foreign: section.foreign ?? [],
        }).then((bytes) =>
          URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })),
        );
        // A failed render may be retried later.
        url.catch(() => urls.current.delete(key));
        urls.current.set(key, url);
      }
      return url;
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
      const url = await render(sections[index]);
      const a = element();
      a.src = url;
      a.playbackRate = rate;
      await a.play();
      if (index + 1 < sections.length)
        render(sections[index + 1]).catch(() => {});
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
    old.forEach((p) => p.then((u) => URL.revokeObjectURL(u)).catch(() => {}));
  }, [stop]);

  useEffect(() => () => reset(), [reset]);

  return { play, pause, resume, stop, setRate, reset };
}
