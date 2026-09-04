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

  it("allows selecting Apple Speech and SenseVoice offline engines", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve(mockModels);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <ModelHubModal {...defaultProps} />
      </I18nProvider>,
    );

    // Select Apple Speech
    const appleSpeechBtn = screen.getByRole("button", {
      name: /macOS Yerel Ses Tanıma Seç/i,
    });
    fireEvent.click(appleSpeechBtn);
    expect(localStorage.getItem("echomind_active_engine")).toBe("apple_speech");
    expect(defaultProps.onModelChanged).toHaveBeenCalled();

    // Select SenseVoice
    const senseVoiceBtn = screen.getByRole("button", {
      name: /SenseVoice Seç/i,
    });
    fireEvent.click(senseVoiceBtn);
    expect(localStorage.getItem("echomind_active_engine")).toBe("sensevoice");
  });

  it("handles inline API key input and activation for cloud models", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve(mockModels);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <ModelHubModal {...defaultProps} />
      </I18nProvider>,
    );

    // Switch to Cloud Tab
    const cloudTab = screen.getByRole("button", {
      name: /Yüksek Hızlı Bulut Zekası/i,
    });
    fireEvent.click(cloudTab);

    // Click Groq Cloud Activate when no key exists
    const groqActivateBtn = screen.getAllByRole("button", {
      name: /Bunu Seç/i,
    })[0];
    fireEvent.click(groqActivateBtn);

    expect(
      screen.getByText(/Lütfen GROQ API anahtarınızı girip onaylayın/i),
    ).toBeInTheDocument();

    // Fill inline key input
    const inlineInput = screen.getByPlaceholderText(
      /Groq API Anahtarını Yapıştırın/i,
    );
    fireEvent.change(inlineInput, { target: { value: "gsk_inline_test_key" } });

    // Click save and activate
    const saveInlineBtn = screen.getByRole("button", { name: /Kaydet & Seç/i });
    fireEvent.click(saveInlineBtn);

    expect(localStorage.getItem("echomind_groq_key")).toBe(
      "gsk_inline_test_key",
    );
    expect(localStorage.getItem("echomind_active_engine")).toBe("cloud_groq");
  });

  it("handles Apple Speech and SenseVoice engine activation", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve(mockModels);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <ModelHubModal {...defaultProps} />
      </I18nProvider>,
    );

    // Click Apple Speech activate button
    const appleBtn = await screen.findByRole("button", {
      name: /macOS Yerel Ses Tanıma Seç/i,
    });
    await act(async () => {
      fireEvent.click(appleBtn);
    });
    expect(localStorage.getItem("echomind_active_engine")).toBe("apple_speech");

    // Click SenseVoice activate button if present
    const senseVoiceBtn = screen.queryByRole("button", {
      name: /SenseVoice Small Seç/i,
    });
    if (senseVoiceBtn) {
      await act(async () => {
        fireEvent.click(senseVoiceBtn);
      });
      expect(localStorage.getItem("echomind_active_engine")).toBe("sensevoice");
    }
  });

  it("handles model download error gracefully", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve(mockModels);
      if (cmd === "download_whisper_model")
        return Promise.reject("Disk alanı yetersiz");
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

  it("handles Gemini and OpenAI cloud engine activation with inline keys", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve(mockModels);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <ModelHubModal {...defaultProps} />
      </I18nProvider>,
    );

    // Switch to Cloud Tab
    const cloudTab = screen.getByRole("button", {
      name: /Yüksek Hızlı Bulut Zekası/i,
    });
    fireEvent.click(cloudTab);

    // Click Gemini activate button (index 1 in Bunu Seç)
    const selectButtons = await screen.findAllByRole("button", {
      name: /Bunu Seç/i,
    });
    if (selectButtons.length > 1) {
      fireEvent.click(selectButtons[1]);

      const inlineInput = screen.getByPlaceholderText(
        /Gemini API Anahtarını Yapıştırın/i,
      );
      fireEvent.change(inlineInput, {
        target: { value: "AIzaSy_inline_gemini_key" },
      });

      const saveInlineBtn = screen.getByRole("button", {
        name: /Kaydet & Seç/i,
      });
      fireEvent.click(saveInlineBtn);

      expect(localStorage.getItem("echomind_gemini_key")).toBe(
        "AIzaSy_inline_gemini_key",
      );
      expect(localStorage.getItem("echomind_active_engine")).toBe(
        "cloud_gemini",
      );
    }

    // Click OpenAI activate button (index 2 in Bunu Seç)
    const updatedSelectButtons = await screen.findAllByRole("button", {
      name: /Bunu Seç/i,
    });
    if (updatedSelectButtons.length > 2) {
      fireEvent.click(updatedSelectButtons[2]);

      const openaiInput = screen.getByPlaceholderText(
        /OpenAI API Anahtarını Yapıştırın/i,
      );
      fireEvent.change(openaiInput, {
        target: { value: "sk-proj-inline_openai_key" },
      });

      const saveOpenaiBtn = screen.getByRole("button", {
        name: /Kaydet & Seç/i,
      });
      fireEvent.click(saveOpenaiBtn);

      expect(localStorage.getItem("echomind_openai_key")).toBe(
        "sk-proj-inline_openai_key",
      );
      expect(localStorage.getItem("echomind_active_engine")).toBe(
        "cloud_openai",
      );
    }
  });

  it("handles model switch error and onClose button click", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve(mockModels);
      if (cmd === "switch_transcription_model")
        return Promise.reject("Model yüklenemedi");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <ModelHubModal {...defaultProps} />
      </I18nProvider>,
    );

    const baseSwitchBtn = await screen.findByRole("button", {
      name: /Bunu Kullan/i,
    });
    await act(async () => {
      fireEvent.click(baseSwitchBtn);
    });

    expect(
      await screen.findByText(/Hata: Model yüklenemedi/i),
    ).toBeInTheDocument();

    // Click close button
    const closeBtns = screen
      .getAllByRole("button")
      .filter((b) => b.querySelector("svg.lucide-x"));
    if (closeBtns.length > 0) {
      fireEvent.click(closeBtns[0]);
      expect(defaultProps.onClose).toHaveBeenCalled();
    }
  });

  it("handles existing API keys and custom model version selects for Gemini and OpenAI in ModelHubModal", async () => {
    localStorage.setItem("echomind_gemini_key", "AIza_stored_hub_key");
    localStorage.setItem("echomind_openai_key", "sk_stored_hub_key");
    localStorage.setItem("echomind_groq_key", "gsk_stored_hub_key");

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve(mockModels);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <ModelHubModal {...defaultProps} />
      </I18nProvider>,
    );

    // Switch to Cloud Tab
    const cloudTab = screen.getByRole("button", {
      name: /Yüksek Hızlı Bulut Zekası/i,
    });
    fireEvent.click(cloudTab);

    // With existing key, clicking Bunu Seç immediately activates
    const selectButtons = await screen.findAllByRole("button", {
      name: /Bunu Seç/i,
    });
    if (selectButtons.length >= 3) {
      fireEvent.click(selectButtons[0]);
      expect(localStorage.getItem("echomind_active_engine")).toBe("cloud_groq");

      fireEvent.click(selectButtons[1]);
      expect(localStorage.getItem("echomind_active_engine")).toBe(
        "cloud_gemini",
      );

      fireEvent.click(selectButtons[2]);
      expect(localStorage.getItem("echomind_active_engine")).toBe(
        "cloud_openai",
      );
    }

    // Select custom models in dropdowns
    const selects = screen.getAllByRole("combobox");
    if (selects.length >= 3) {
      fireEvent.change(selects[1], { target: { value: "custom" } });
      const customGeminiInput = screen.getByPlaceholderText(
        /Örn: gemini-2.0-flash/i,
      );
      fireEvent.change(customGeminiInput, {
        target: { value: "gemini-2.0-pro-exp" },
      });

      fireEvent.change(selects[2], { target: { value: "custom" } });
      const customOpenaiInput = screen.getByPlaceholderText(/Örn: whisper-1/i);
      fireEvent.change(customOpenaiInput, {
        target: { value: "gpt-4o-audio-preview" },
      });
    }
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
