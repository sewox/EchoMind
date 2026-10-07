import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { I18nProvider } from "../locales/i18nContext";
import { VoicePacksSection } from "./VoicePacksSection";
import { englishVoice, setEnglishVoice } from "../hooks/useVoicePacks";
import { globalTestEventListeners } from "../test/setup";

const PACKS = [
  {
    key: "ema-tr",
    lang: "tr",
    name: "EMA Lightning (Türkçe)",
    size_bytes: 34_763_910,
    installed: false,
    downloadable: false,
  },
  {
    key: "kokoro-en",
    lang: "en",
    name: "Kokoro (English)",
    size_bytes: 93_178_041,
    installed: false,
    downloadable: true,
  },
];

const backend = (
  packs = PACKS,
  onDownload: () => Promise<unknown> = () => new Promise(() => {}),
) =>
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd === "get_voice_packs") return Promise.resolve(packs);
    if (cmd === "download_voice_pack") return onDownload();
    return Promise.resolve();
  });

const renderSection = () =>
  render(
    <I18nProvider>
      <VoicePacksSection />
    </I18nProvider>,
  );

const progress = (payload: object) =>
  act(() => {
    (globalTestEventListeners["voice-pack-download-progress"] || []).forEach(
      (cb) => cb({ payload }),
    );
  });

describe("VoicePacksSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    delete globalTestEventListeners["voice-pack-download-progress"];
  });

  it("lists the Turkish and English voices with their state", async () => {
    backend();
    renderSection();
    expect(await screen.findByText("Türkçe ses")).toBeInTheDocument();
    expect(screen.getByText("Yakında indirilebilir")).toBeInTheDocument();
    expect(screen.getByText("İndir (93 MB)")).toBeInTheDocument();
    expect(screen.getByText(/Kokoro \(English\) · 93 MB/)).toBeInTheDocument();
  });

  it("downloads with progress and refreshes when done", async () => {
    backend();
    renderSection();
    const button = await screen.findByText("İndir (93 MB)");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(invoke).toHaveBeenCalledWith("download_voice_pack", {
      key: "kokoro-en",
    });
    await waitFor(() =>
      expect(
        globalTestEventListeners["voice-pack-download-progress"]?.length,
      ).toBe(1),
    );
    progress({ key: "kokoro-en", percentage: 41.6, status: "downloading" });
    expect(screen.getByText("İndiriliyor… %42")).toBeInTheDocument();
    backend([PACKS[0], { ...PACKS[1], installed: true }]);
    progress({ key: "kokoro-en", percentage: 100, status: "completed" });
    expect(await screen.findByText("Kurulu")).toBeInTheDocument();
  });

  it("shows a failed download", async () => {
    backend(PACKS, () => Promise.reject("SHA-256 uyuşmuyor"));
    renderSection();
    const button = await screen.findByText("İndir (93 MB)");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "İndirilemedi: SHA-256 uyuşmuyor",
    );
  });

  it("chooses the English voice and removes a pack", async () => {
    backend([PACKS[0], { ...PACKS[1], installed: true }]);
    renderSection();
    const emma = await screen.findByRole("radio", { name: /Emma/ });
    expect(screen.getByRole("radio", { name: /Heart/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(emma);
    expect(emma).toHaveAttribute("aria-checked", "true");
    expect(englishVoice()).toBe("bf_emma");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Ses paketini sil"));
    });
    expect(invoke).toHaveBeenCalledWith("delete_voice_pack", {
      key: "kokoro-en",
    });
  });

  it("renders nothing without a backend", async () => {
    (invoke as any).mockRejectedValue(new Error("no backend"));
    const { container } = renderSection();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });
});

describe("englishVoice", () => {
  it("defaults to Heart and ignores unknown values", () => {
    localStorage.clear();
    expect(englishVoice()).toBe("af_heart");
    localStorage.setItem("echomind_english_voice", "zz");
    expect(englishVoice()).toBe("af_heart");
    setEnglishVoice("bf_emma");
    expect(englishVoice()).toBe("bf_emma");
  });
});
