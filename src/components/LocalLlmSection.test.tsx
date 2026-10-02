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
import { LocalLlmHint, LocalLlmSection } from "./LocalLlmSection";
import { formatGb } from "../hooks/useLocalLlmModels";
import { globalTestEventListeners } from "../test/setup";

const MODELS = [
  {
    key: "qwen3.5-4b",
    name: "Qwen 3.5 4B",
    size_bytes: 2_707_513_696,
    installed: false,
    recommended: true,
    active: false,
  },
  {
    key: "qwen3.5-2b",
    name: "Qwen 3.5 2B",
    size_bytes: 1_270_808_032,
    installed: false,
    recommended: false,
    active: false,
  },
];

const mockBackend = (
  models = MODELS,
  onDownload: () => Promise<unknown> = () => new Promise(() => {}),
) =>
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd === "get_llm_models") return Promise.resolve(models);
    if (cmd === "download_llm_model") return onDownload();
    return Promise.resolve();
  });

const progress = (payload: object) =>
  act(() => {
    (globalTestEventListeners["llm-model-download-progress"] || []).forEach(
      (cb) => cb({ payload }),
    );
  });

const renderWithI18n = (ui: React.ReactElement) =>
  render(<I18nProvider>{ui}</I18nProvider>);

describe("LocalLlmSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete globalTestEventListeners["llm-model-download-progress"];
  });

  it("lists models with size and the recommended badge", async () => {
    mockBackend();
    renderWithI18n(<LocalLlmSection />);
    expect(await screen.findByText("Qwen 3.5 4B")).toBeInTheDocument();
    expect(screen.getByText("2.7 GB")).toBeInTheDocument();
    expect(screen.getByText("Önerilen")).toBeInTheDocument();
    expect(screen.getByText("İndir (2.7 GB)")).toBeInTheDocument();
  });

  it("downloads and shows progress from backend events", async () => {
    mockBackend();
    renderWithI18n(<LocalLlmSection />);
    const target = await screen.findByText("İndir (2.7 GB)");
    await act(async () => {
      fireEvent.click(target);
    });
    expect(invoke).toHaveBeenCalledWith("download_llm_model", {
      key: "qwen3.5-4b",
    });
    progress({
      model_key: "qwen3.5-4b",
      percentage: 41.6,
      status: "downloading",
    });
    expect(screen.getByText("İndiriliyor… %42")).toBeInTheDocument();
  });

  it("refreshes the list when a download completes", async () => {
    mockBackend();
    renderWithI18n(<LocalLlmSection />);
    await screen.findByText("Qwen 3.5 4B");
    await waitFor(() =>
      expect(
        globalTestEventListeners["llm-model-download-progress"]?.length,
      ).toBe(1),
    );
    mockBackend([{ ...MODELS[0], installed: true, active: true }, MODELS[1]]);
    progress({ model_key: "qwen3.5-4b", percentage: 100, status: "completed" });
    expect(await screen.findByText("İndirildi")).toBeInTheDocument();
    expect(screen.getByText("Kullanımda")).toBeInTheDocument();
  });

  it("shows a failed download", async () => {
    mockBackend(MODELS, () => Promise.reject("SHA-256 uyuşmuyor"));
    renderWithI18n(<LocalLlmSection />);
    const target = await screen.findByText("İndir (2.7 GB)");
    await act(async () => {
      fireEvent.click(target);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "İndirilemedi: SHA-256 uyuşmuyor",
    );
  });

  it("removes an installed model", async () => {
    mockBackend([{ ...MODELS[0], installed: true, active: true }, MODELS[1]]);
    renderWithI18n(<LocalLlmSection />);
    const target = await screen.findByLabelText("Modeli sil");
    await act(async () => {
      fireEvent.click(target);
    });
    expect(invoke).toHaveBeenCalledWith("delete_llm_model", {
      key: "qwen3.5-4b",
    });
  });

  it("renders nothing when the backend lists no models", async () => {
    (invoke as any).mockRejectedValue(new Error("no backend"));
    const { container } = renderWithI18n(<LocalLlmSection />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LocalLlmHint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invites the download while no report model is installed", async () => {
    mockBackend();
    const open = vi.fn();
    renderWithI18n(<LocalLlmHint onOpenModelHub={open} />);
    expect(await screen.findByTestId("local-llm-hint")).toHaveTextContent(
      "2.7 GB",
    );
    fireEvent.click(screen.getByText("Modeli indir"));
    expect(open).toHaveBeenCalled();
  });

  it("stays hidden once a model is installed", async () => {
    mockBackend([MODELS[0], { ...MODELS[1], installed: true }]);
    renderWithI18n(<LocalLlmHint />);
    await act(async () => {});
    expect(screen.queryByTestId("local-llm-hint")).not.toBeInTheDocument();
  });
});

describe("formatGb", () => {
  it("formats decimal gigabytes", () => {
    expect(formatGb(2_707_513_696)).toBe("2.7");
    expect(formatGb(2_000_000_000)).toBe("2");
  });
});
