import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { AudioMemoPlayer, buildMemoText } from "./AudioMemoPlayer";
import { SummaryResult } from "../TranscriptViewer";
import { I18nProvider } from "../../locales/i18nContext";
import { globalTestEventListeners } from "../../test/setup";

const mockSummary: SummaryResult = {
  meeting_goal: "Yeni özellikleri canlıya almak.",
  key_highlights: ["CI/CD hızı 2 dakikanın altına indirildi"],
  action_items: [
    {
      task: "Sürüm notlarını hazırla",
      assignee: "Sercan",
      source_citations: [],
      is_completed: false,
    },
    {
      task: "Genel görev",
      assignee: undefined,
      source_citations: [],
      is_completed: false,
    },
  ],
  phase1_agreed: [],
  phase2_deferred: [],
  detailed_topics: [],
  participants: ["Sercan", "Burak"],
  summary: "Toplantı verimli geçti.",
  key_decisions: ["v0.1.0 bu hafta yayınlanacak"],
  agenda_topics: [],
  provider_used: "EchoMind",
  generation_time_ms: 120,
};

const emptySummary: SummaryResult = {
  ...mockSummary,
  meeting_goal: " ",
  action_items: [],
  key_decisions: [],
  summary: "",
};

type Backend = {
  supported?: boolean;
  voice?: string | null;
  speak?: () => Promise<unknown>;
  /** Default: no on-device model, so the report template is read. */
  briefing?: () => Promise<unknown>;
};

const SCRIPT = [
  { title: "Amaç", text: "Sürüm planlandı." },
  { title: "Görevler", text: "Sercan notları yazacak." },
];

const mockBackend = ({
  supported = true,
  voice = "Yelda",
  speak = () => Promise.resolve("Yelda"),
  briefing = () => Promise.reject("no_model"),
}: Backend = {}) =>
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd === "tts_availability")
      return Promise.resolve({ supported, voice });
    if (cmd === "generate_briefing") return briefing();
    if (cmd === "tts_speak") return speak();
    if (cmd === "tts_pause") return Promise.resolve("paused");
    if (cmd === "tts_resume") return Promise.resolve("speaking");
    if (cmd === "tts_progress") return Promise.resolve(0.5);
    return Promise.resolve("idle");
  });

const renderPlayer = (
  props: Partial<React.ComponentProps<typeof AudioMemoPlayer>> = {},
) =>
  render(
    <I18nProvider>
      <AudioMemoPlayer
        summary={mockSummary}
        meetingTitle="Sprint Planlama"
        langCode="tr"
        {...props}
      />
    </I18nProvider>,
  );

const endReading = () =>
  act(async () => {
    globalTestEventListeners["tts-state"].forEach((cb) =>
      cb({ payload: { state: "idle" } }),
    );
  });

const click = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
  });

describe("buildMemoText", () => {
  it("reads goal, decisions, tasks and the summary in the report language", () => {
    expect(buildMemoText(mockSummary, "Sprint Planlama", "tr")).toBe(
      "Sprint Planlama toplantısının sesli bülteni. " +
        "Toplantının amacı: Yeni özellikleri canlıya almak. " +
        "Alınan kararlar: v0.1.0 bu hafta yayınlanacak. " +
        "Görevler: Sercan: Sürüm notlarını hazırla; Genel görev. " +
        "Genel özet: Toplantı verimli geçti.",
    );
    const en = buildMemoText(mockSummary, undefined, "en");
    expect(en).toMatch(/^Audio briefing for this meeting\./);
    expect(en).toContain("Summary: Toplantı verimli geçti.");
    expect(buildMemoText(mockSummary, "X", "de")).toContain("Entscheidungen:");
    expect(buildMemoText(mockSummary, "X", "fr-FR")).toContain("Décisions");
    expect(buildMemoText(mockSummary, "X", "es")).toContain("Decisiones");
  });

  it("skips missing parts and is empty without any", () => {
    expect(
      buildMemoText({ ...emptySummary, summary: "Kısa." }, "T", "tr"),
    ).toBe("T toplantısının sesli bülteni. Genel özet: Kısa.");
    expect(buildMemoText(emptySummary, "T", "tr")).toBe("");
    expect(buildMemoText(null, "T", "tr")).toBe("");
    expect(
      buildMemoText(
        { ...emptySummary, key_decisions: undefined as any },
        "T",
        "tr",
      ),
    ).toBe("");
  });
});

describe("AudioMemoPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete globalTestEventListeners["tts-state"];
  });

  it("is hidden where the system offers no voices", async () => {
    mockBackend({ supported: false, voice: null });
    const { container } = renderPlayer();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("is hidden when the backend cannot be reached", async () => {
    (invoke as any).mockRejectedValue(new Error("no backend"));
    const { container } = renderPlayer();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("reads the summary with the native voice, pauses, resumes and stops", async () => {
    mockBackend();
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    expect(invoke).toHaveBeenCalledWith("tts_speak", {
      text: buildMemoText(mockSummary, "Sprint Planlama", "tr"),
      lang: "tr",
      rate: 1,
    });
    expect(screen.getByText("Okunuyor…")).toBeInTheDocument();
    expect(screen.getByText(/Ses: Yelda/)).toBeInTheDocument();

    await click(screen.getByRole("button", { name: /Duraklat/ }));
    expect(invoke).toHaveBeenCalledWith("tts_pause");
    expect(screen.getByText("Duraklatıldı")).toBeInTheDocument();

    await click(screen.getByRole("button", { name: /Devam et/ }));
    expect(invoke).toHaveBeenCalledWith("tts_resume");

    await click(screen.getByRole("button", { name: "Durdur" }));
    expect(invoke).toHaveBeenCalledWith("tts_stop");
    expect(
      screen.queryByRole("button", { name: "Durdur" }),
    ).not.toBeInTheDocument();
  });

  it("returns to idle when the engine finishes on its own", async () => {
    mockBackend();
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    await waitFor(() =>
      expect(globalTestEventListeners["tts-state"]?.length).toBe(1),
    );
    act(() => {
      globalTestEventListeners["tts-state"].forEach((cb) =>
        cb({ payload: { state: "idle" } }),
      );
    });
    expect(screen.getByText(/Rapor özetini/)).toBeInTheDocument();
  });

  it("restarts at the new speed while reading", async () => {
    mockBackend();
    renderPlayer();
    await click(await screen.findByRole("button", { name: "Hız: 1x" }));
    expect(invoke).not.toHaveBeenCalledWith("tts_speak", expect.anything());
    await click(screen.getByRole("button", { name: /Dinle/ }));
    await click(screen.getByRole("button", { name: "Hız: 1.25x" }));
    expect(invoke).toHaveBeenLastCalledWith("tts_speak", {
      text: expect.any(String),
      lang: "tr",
      rate: 1.5,
    });
  });

  it("explains an empty report instead of pretending to play", async () => {
    mockBackend();
    renderPlayer({ summary: emptySummary });
    expect(
      await screen.findByText("Dinlenecek özet yok. Önce raporu oluşturun."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dinle/ })).toBeDisabled();
  });

  it("explains a missing voice for the language", async () => {
    mockBackend({ voice: null });
    renderPlayer();
    expect(
      await screen.findByText(/Bu dil için yüklü bir sistem sesi yok/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dinle/ })).toBeDisabled();
  });

  it("shows why reading failed", async () => {
    mockBackend({ speak: () => Promise.reject("audio device busy") });
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Seslendirme başlatılamadı: audio device busy",
    );
    expect(
      screen.queryByRole("button", { name: "Durdur" }),
    ).not.toBeInTheDocument();
  });

  it("maps engine error codes to clear messages", async () => {
    mockBackend({ speak: () => Promise.reject(new Error("no_voice")) });
    const { unmount } = renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Bu dil için yüklü bir sistem sesi yok/,
    );
    unmount();

    mockBackend({ speak: () => Promise.reject("empty_text") });
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Dinlenecek özet yok");
  });

  it("stops reading when it goes away", async () => {
    mockBackend();
    const { unmount } = renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    (invoke as any).mockClear();
    unmount();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("tts_stop"));
  });

  it("does not call stop on unmount when nothing was read", async () => {
    mockBackend();
    const { unmount } = renderPlayer();
    await screen.findByRole("button", { name: /Dinle/ });
    (invoke as any).mockClear();
    unmount();
    await act(async () => {});
    expect(invoke).not.toHaveBeenCalledWith("tts_stop");
  });

  it("surfaces a failed pause", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "tts_availability")
        return Promise.resolve({ supported: true, voice: "Yelda" });
      if (cmd === "tts_speak") return Promise.resolve("Yelda");
      return Promise.reject("engine gone");
    });
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    await click(screen.getByRole("button", { name: /Duraklat/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("engine gone");
  });

  it("reads the model's script section by section", async () => {
    mockBackend({ briefing: () => Promise.resolve(SCRIPT) });
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    expect(invoke).toHaveBeenCalledWith("generate_briefing", {
      title: "Sprint Planlama",
      report: mockSummary,
      lang: "tr",
      length: "short",
    });
    expect(invoke).toHaveBeenLastCalledWith("tts_speak", {
      text: "Sürüm planlandı.",
      lang: "tr",
      rate: 1,
    });
    expect(screen.getByRole("button", { name: /1\.\s*Amaç/ })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(
      screen.queryByText(/Rapor modeli yüklü olmadığı/),
    ).not.toBeInTheDocument();

    await waitFor(() =>
      expect(globalTestEventListeners["tts-state"]?.length).toBe(1),
    );
    await endReading();
    expect(invoke).toHaveBeenLastCalledWith("tts_speak", {
      text: "Sercan notları yazacak.",
      lang: "tr",
      rate: 1,
    });
    expect(
      screen.getByRole("button", { name: /2\.\s*Görevler/ }),
    ).toHaveAttribute("aria-current", "step");

    await endReading();
    expect(screen.getByText(/Rapor özetini/)).toBeInTheDocument();

    // Played again: the script is reused, not written again.
    (invoke as any).mockClear();
    await click(screen.getByRole("button", { name: /Dinle/ }));
    expect(invoke).not.toHaveBeenCalledWith(
      "generate_briefing",
      expect.anything(),
    );
  });

  it("jumps to a section", async () => {
    mockBackend({ briefing: () => Promise.resolve(SCRIPT) });
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    await click(screen.getByRole("button", { name: /2\.\s*Görevler/ }));
    expect(invoke).toHaveBeenLastCalledWith("tts_speak", {
      text: "Sercan notları yazacak.",
      lang: "tr",
      rate: 1,
    });
  });

  it("shows progress while the script is written", async () => {
    let finish: (v: unknown) => void = () => {};
    mockBackend({
      briefing: () => new Promise((resolve) => (finish = resolve)),
    });
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    await waitFor(() =>
      expect(globalTestEventListeners["briefing-progress"]?.length).toBe(1),
    );
    act(() => {
      globalTestEventListeners["briefing-progress"].forEach((cb) =>
        cb({ payload: { percent: 41.6 } }),
      );
    });
    expect(
      screen.getByText("Bülten hazırlanıyor… %42 · Metin yazılıyor"),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    expect(screen.getByRole("button", { name: /Dinle/ })).toBeDisabled();
    await act(async () => finish(SCRIPT));
    expect(screen.getByText("Okunuyor…")).toBeInTheDocument();
  });

  it("asks for a longer script when the length changes", async () => {
    mockBackend({ briefing: () => Promise.resolve(SCRIPT) });
    renderPlayer();
    await click(await screen.findByRole("radio", { name: /~3 dk/ }));
    expect(screen.getByRole("radio", { name: /~3 dk/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await click(screen.getByRole("button", { name: /Dinle/ }));
    expect(invoke).toHaveBeenCalledWith(
      "generate_briefing",
      expect.objectContaining({ length: "standard" }),
    );
  });

  it("reads the report and says why when the model fails", async () => {
    mockBackend({ briefing: () => Promise.reject("model crashed") });
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    expect(invoke).toHaveBeenLastCalledWith("tts_speak", {
      text: buildMemoText(mockSummary, "Sprint Planlama", "tr"),
      lang: "tr",
      rate: 1,
    });
    expect(screen.getByRole("alert")).toHaveTextContent("model crashed");
  });

  it("notes that the report is read when no model is installed", async () => {
    mockBackend();
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    expect(
      screen.getByText(/Rapor modeli yüklü olmadığı için/),
    ).toBeInTheDocument();
  });

  it("shows where the reading is and the text being read", async () => {
    mockBackend({ briefing: () => Promise.resolve(SCRIPT) });
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    const panel = screen.getByTestId("audio-memo-progress");
    expect(panel).toHaveTextContent("Bölüm 1/2 · Amaç");
    expect(panel).toHaveTextContent("Sürüm planlandı.");
    // Half of the first section (16 of 39 characters) read.
    await waitFor(() =>
      expect(
        screen.getByRole("progressbar", { name: "Bültenin okunan kısmı" }),
      ).toHaveAttribute("aria-valuenow", "21"),
    );
    await click(screen.getByRole("button", { name: "Durdur" }));
    expect(screen.queryByTestId("audio-memo-progress")).not.toBeInTheDocument();
  });
});

class FakeAudio {
  static last: FakeAudio | null = null;
  src = "";
  playbackRate = 1;
  currentTime = 0;
  duration = 0;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  private listeners: Record<string, (() => void)[]> = {};
  constructor() {
    FakeAudio.last = this;
  }
  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ||= []).push(cb);
  }
  fire(type: string) {
    (this.listeners[type] || []).forEach((cb) => cb());
  }
}

describe("AudioMemoPlayer with the neural voice", () => {
  const renders: string[] = [];

  const neuralBackend = (
    render: () => Promise<unknown> = () => Promise.resolve(new ArrayBuffer(8)),
  ) =>
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === "tts_availability")
        return Promise.resolve({ supported: true, voice: "Yelda" });
      if (cmd === "neural_voice_available") return Promise.resolve(true);
      if (cmd === "generate_briefing")
        return Promise.resolve(
          SCRIPT.map((s, i) => ({ ...s, foreign: i ? [] : ["deadline"] })),
        );
      if (cmd === "neural_voice_render") {
        renders.push(args.text);
        return render();
      }
      if (cmd === "tts_speak") return Promise.resolve("Yelda");
      return Promise.resolve("idle");
    });

  beforeEach(() => {
    vi.clearAllMocks();
    renders.length = 0;
    FakeAudio.last = null;
    (globalThis as any).Audio = FakeAudio;
    let n = 0;
    (URL as any).createObjectURL = vi.fn(() => `blob:${++n}`);
    (URL as any).revokeObjectURL = vi.fn();
    delete globalTestEventListeners["tts-state"];
  });

  it("plays the script with the neural voice and prepares the next section", async () => {
    neuralBackend();
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    expect(invoke).toHaveBeenCalledWith("neural_voice_render", {
      text: "Sürüm planlandı.",
      lang: "tr",
      foreign: ["deadline"],
      voice: "af_heart",
      job: expect.any(Number),
    });
    expect(invoke).not.toHaveBeenCalledWith("tts_speak", expect.anything());
    expect(FakeAudio.last!.play).toHaveBeenCalled();
    expect(FakeAudio.last!.src).toBe("blob:1");
    expect(
      screen.getByText(/Doğal Türkçe ses \(cihazda\)/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(renders).toEqual(["Sürüm planlandı.", "Sercan notları yazacak."]),
    );
  });

  it("shows writing and rendering as one progress bar", async () => {
    let finishScript: (v: unknown) => void = () => {};
    let finishAudio: (v: unknown) => void = () => {};
    let job = 0;
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === "tts_availability")
        return Promise.resolve({ supported: true, voice: "Yelda" });
      if (cmd === "neural_voice_available") return Promise.resolve(true);
      if (cmd === "generate_briefing")
        return new Promise((resolve) => (finishScript = resolve));
      if (cmd === "neural_voice_render") {
        if (job) return new Promise(() => {}); // the prefetched next section
        job = args.job;
        return new Promise((resolve) => (finishAudio = resolve));
      }
      return Promise.resolve("idle");
    });
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    await waitFor(() =>
      expect(globalTestEventListeners["briefing-progress"]?.length).toBe(1),
    );
    const emit = (event: string, payload: unknown) =>
      act(() => {
        globalTestEventListeners[event].forEach((cb) => cb({ payload }));
      });
    const bar = () => screen.getByRole("progressbar");

    emit("briefing-progress", { percent: 50 });
    expect(bar()).toHaveAttribute("aria-valuenow", "38");
    expect(screen.getByText(/· Metin yazılıyor/)).toBeInTheDocument();

    await act(async () => finishScript(SCRIPT));
    await waitFor(() => expect(job).toBeGreaterThan(0));
    expect(bar()).toHaveAttribute("aria-valuenow", "75");
    expect(screen.getByText(/· Ses oluşturuluyor/)).toBeInTheDocument();

    // Another render's progress does not move the bar.
    emit("neural-voice-progress", { job: job + 99, fraction: 0.9 });
    expect(bar()).toHaveAttribute("aria-valuenow", "75");
    emit("neural-voice-progress", { job, fraction: 0.5 });
    expect(bar()).toHaveAttribute("aria-valuenow", "88");
    expect(screen.getByRole("button", { name: /Dinle/ })).toBeDisabled();

    await act(async () => finishAudio(new ArrayBuffer(8)));
    expect(screen.getByText(/Okunuyor…/)).toBeInTheDocument();
    expect(FakeAudio.last!.play).toHaveBeenCalled();
  });

  it("moves on when a section ends and stops after the last", async () => {
    neuralBackend();
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    await act(async () => FakeAudio.last!.fire("ended"));
    expect(FakeAudio.last!.src).toBe("blob:2");
    expect(
      screen.getByRole("button", { name: /2\.\s*Görevler/ }),
    ).toHaveAttribute("aria-current", "step");
    await act(async () => FakeAudio.last!.fire("ended"));
    expect(screen.getByText(/Rapor özetini/)).toBeInTheDocument();
  });

  it("changes speed at once, pauses and resumes the audio", async () => {
    neuralBackend();
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    await click(screen.getByRole("button", { name: "Hız: 1x" }));
    expect(FakeAudio.last!.playbackRate).toBe(1.25);
    expect(renders.filter((r) => r === "Sürüm planlandı.")).toHaveLength(1);

    await click(screen.getByRole("button", { name: /Duraklat/ }));
    expect(FakeAudio.last!.pause).toHaveBeenCalled();
    expect(screen.getByText("Duraklatıldı")).toBeInTheDocument();
    await click(screen.getByRole("button", { name: /Devam et/ }));
    expect(FakeAudio.last!.play).toHaveBeenCalledTimes(2);

    await click(screen.getByRole("button", { name: "Durdur" }));
    expect(invoke).not.toHaveBeenCalledWith("tts_stop");
  });

  it("shows where the audio is", async () => {
    neuralBackend();
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    const a = FakeAudio.last!;
    a.duration = 10;
    a.currentTime = 5;
    act(() => a.fire("timeupdate"));
    expect(
      screen.getByRole("progressbar", { name: "Bültenin okunan kısmı" }),
    ).toHaveAttribute("aria-valuenow", "21");
  });

  it("falls back to the system voice when the neural voice fails", async () => {
    neuralBackend(() => Promise.reject("model missing"));
    renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    expect(invoke).toHaveBeenCalledWith(
      "tts_speak",
      expect.objectContaining({ text: "Sürüm planlandı." }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Doğal ses başlatılamadı, sistem sesine geçildi: model missing",
    );
  });

  it("frees the rendered audio when it goes away", async () => {
    neuralBackend();
    const { unmount } = renderPlayer();
    await click(await screen.findByRole("button", { name: /Dinle/ }));
    unmount();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
  });

  it("shows on a system without voices when the neural voice is there", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "tts_availability")
        return Promise.resolve({ supported: false, voice: null });
      if (cmd === "neural_voice_available") return Promise.resolve(true);
      return Promise.resolve("idle");
    });
    renderPlayer();
    expect(await screen.findByRole("button", { name: /Dinle/ })).toBeEnabled();
  });
});
