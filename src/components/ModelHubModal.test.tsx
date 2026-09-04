import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ModelHubModal } from "./ModelHubModal";
import { I18nProvider } from "../locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";

describe("ModelHubModal Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const mockModels = [
    {
      key: "whisper-tiny",
      name: "Whisper Tiny (Hızlı)",
      size_mb: 75,
      ram_required_mb: 500,
      speed_score: 95,
      accuracy_score: 80,
      is_downloaded: true,
      is_active: true,
    },
    {
      key: "whisper-small",
      name: "Whisper Small (Dengeli)",
      size_mb: 466,
      ram_required_mb: 1500,
      speed_score: 75,
      accuracy_score: 92,
      is_downloaded: false,
      is_active: false,
    },
    {
      key: "whisper-base",
      name: "Whisper Base (Hafif)",
      size_mb: 142,
      ram_required_mb: 800,
      speed_score: 90,
      accuracy_score: 85,
      is_downloaded: true,
      is_active: false,
    },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onModelChanged: vi.fn(),
  };

  it("renders local models and handles activation and download", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve(mockModels);
      if (cmd === "switch_transcription_model") return Promise.resolve();
      if (cmd === "download_whisper_model")
        return Promise.resolve("Model başarıyla indirildi");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <ModelHubModal {...defaultProps} />
      </I18nProvider>,
    );

    expect(screen.getByText(/Model Yönetim Merkezi/i)).toBeInTheDocument();
    expect(await screen.findByText("Whisper Tiny (Hızlı)")).toBeInTheDocument();

    // 1. Switch model to Base
    const switchBtn = await screen.findByRole("button", {
      name: /Bunu Kullan/i,
    });
    await act(async () => {
      fireEvent.click(switchBtn);
    });
    expect(invoke).toHaveBeenCalledWith("switch_transcription_model", {
      modelKey: "whisper-base",
    });
    expect(defaultProps.onModelChanged).toHaveBeenCalled();

    // 2. Trigger download for Small model
    const downloadBtn = await screen.findByRole("button", {
      name: /İndir \(466 MB\)/i,
    });
    await act(async () => {
      fireEvent.click(downloadBtn);
    });
    expect(invoke).toHaveBeenCalledWith("download_whisper_model", {
      modelKey: "whisper-small",
    });
  });

  it("allows activating Groq, Gemini, and OpenAI cloud engines with API keys and custom models", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve(mockModels);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <ModelHubModal {...defaultProps} />
      </I18nProvider>,
    );

    // Switch to Cloud Engines Tab
    const cloudTab = screen.getByRole("button", {
      name: /⚡ Yüksek Hızlı Bulut Zekası/i,
    });
    await act(async () => {
      fireEvent.click(cloudTab);
    });

    expect(
      await screen.findByText(/Yıldırım Hızı \(Groq Cloud Whisper\)/i),
    ).toBeInTheDocument();

    // 1. Select Groq -> Enter key
    const selectButtons = screen.getAllByRole("button", { name: /Bunu Seç/i });
    await act(async () => {
      fireEvent.click(selectButtons[0]);
    });

    const groqKeyInput = await screen.findByPlaceholderText(
      /Groq API Anahtarını Yapıştırın/i,
    );
    fireEvent.change(groqKeyInput, { target: { value: "gsk_test_model_hub" } });

    const saveGroqKeyBtn = screen.getByRole("button", {
      name: /Kaydet & Seç/i,
    });
    await act(async () => {
      fireEvent.click(saveGroqKeyBtn);
    });

    expect(localStorage.getItem("echomind_groq_key")).toBe(
      "gsk_test_model_hub",
    );
    expect(localStorage.getItem("echomind_active_engine")).toBe("cloud_groq");

    // 2. Select Gemini -> Enter key
    const selectButtons2 = screen.getAllByRole("button", { name: /Bunu Seç/i });
    if (selectButtons2.length > 0) {
      await act(async () => {
        fireEvent.click(selectButtons2[0]);
      });

      const geminiKeyInput = await screen.findByPlaceholderText(
        /Google Gemini API Anahtarını Yapıştırın/i,
      );
      fireEvent.change(geminiKeyInput, {
        target: { value: "AIzaSy_test_model_hub" },
      });

      const saveGeminiKeyBtn = screen.getByRole("button", {
        name: /Kaydet & Seç/i,
      });
      await act(async () => {
        fireEvent.click(saveGeminiKeyBtn);
      });

      expect(localStorage.getItem("echomind_gemini_key")).toBe(
        "AIzaSy_test_model_hub",
      );
      expect(localStorage.getItem("echomind_active_engine")).toBe(
        "cloud_gemini",
      );
    }

    // 3. Select OpenAI -> Enter key
    const remainingButtons = screen.getAllByRole("button", {
      name: /Bunu Seç/i,
    });
    const openaiBtn = remainingButtons[remainingButtons.length - 1];
    await act(async () => {
      fireEvent.click(openaiBtn);
    });

    const openaiKeyInput = await screen.findByPlaceholderText(
      /OpenAI API Anahtarını Yapıştırın/i,
    );
    fireEvent.change(openaiKeyInput, {
      target: { value: "sk-proj_test_model_hub" },
    });

    const saveOpenaiKeyBtn = screen.getByRole("button", {
      name: /Kaydet & Seç/i,
    });
    await act(async () => {
      fireEvent.click(saveOpenaiKeyBtn);
    });

    expect(localStorage.getItem("echomind_openai_key")).toBe(
      "sk-proj_test_model_hub",
    );
    expect(localStorage.getItem("echomind_active_engine")).toBe("cloud_openai");

    // Test model version select dropdowns
    const selects = screen.getAllByRole("combobox");
    if (selects.length > 0) {
      fireEvent.change(selects[0], { target: { value: "custom" } });
      const customGroqInput = screen.getByPlaceholderText(
        /Örn: whisper-large-v3-turbo/i,
      );
      fireEvent.change(customGroqInput, {
        target: { value: "custom-whisper" },
      });
    }
  });

  it("handles error states during download gracefully", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve(mockModels);
      if (cmd === "download_whisper_model") return Promise.reject("Disk dolu");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <ModelHubModal {...defaultProps} />
      </I18nProvider>,
    );

    const downloadBtn = await screen.findByRole("button", {
      name: /İndir \(466 MB\)/i,
    });
    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    expect(await screen.findByText(/İndirme başarısız/i)).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <I18nProvider>
        <ModelHubModal {...defaultProps} isOpen={false} />
      </I18nProvider>,
    );

    expect(container.firstChild).toBeNull();
  });
});
