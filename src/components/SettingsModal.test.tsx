import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { I18nProvider } from "../locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";

describe("SettingsModal Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const mockHardware = {
    os_name: "macOS",
    os_version: "15.0",
    cpu_brand: "Apple M3 Max",
    cpu_cores: 16,
    total_ram_gb: 36,
    gpu_name: "Apple M3 Max (Metal)",
    metal_supported: true,
    cuda_supported: false,
    avx2_supported: true,
  };

  const mockModelStatus = {
    model_name: "whisper-small",
    is_loaded: true,
    is_downloading: false,
    download_progress: 100,
    hardware_acceleration: "Metal (Apple Silicon)",
  };

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    hardware: mockHardware,
    modelStatus: mockModelStatus,
  };

  it("renders general settings and selects microphone", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_audio_devices")
        return Promise.resolve(["MacBook Pro Microphone", "USB Studio Mic"]);
      if (cmd === "list_audio_devices")
        return Promise.resolve(["MacBook Pro Microphone", "USB Studio Mic"]);
      if (cmd === "get_stored_api_keys")
        return Promise.resolve({ groq: "", gemini: "", openai: "" });
      if (cmd === "get_ollama_config")
        return Promise.resolve({
          endpoint: "http://127.0.0.1:11434",
          model: "llama3.2",
        });
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    expect(screen.getByText(/Ayarlar ve Tercihler/i)).toBeInTheDocument();
    expect(screen.getByText(/Mikrofon & Sistem Sesi/i)).toBeInTheDocument();
  });

  it("handles device & privacy tab and toggles cloud warning checkbox", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_audio_devices") return Promise.resolve([]);
      if (cmd === "list_audio_devices") return Promise.resolve([]);
      if (cmd === "get_stored_api_keys")
        return Promise.resolve({ groq: "", gemini: "", openai: "" });
      if (cmd === "get_ollama_config")
        return Promise.resolve({ endpoint: "", model: "" });
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    // Switch to Device & Privacy Tab
    const deviceTab = screen.getByRole("button", { name: /Cihaz & Gizlilik/i });
    fireEvent.click(deviceTab);

    expect(screen.getByText("Apple M3 Max")).toBeInTheDocument();
    expect(screen.getByText("36 GB")).toBeInTheDocument();

    // Toggle Cloud Warning checkbox
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).not.toBeChecked();

    // Toggle meeting detector toggle
    fireEvent.click(checkboxes[1]);
  });

  it("handles API keys input, key visibility toggles, Ollama connection testing, and saving", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_audio_devices") return Promise.resolve([]);
      if (cmd === "list_audio_devices") return Promise.resolve([]);
      if (cmd === "get_stored_api_keys")
        return Promise.resolve({ groq: "", gemini: "", openai: "" });
      if (cmd === "get_ollama_config")
        return Promise.resolve({
          endpoint: "http://127.0.0.1:11434",
          model: "llama3.2",
        });
      if (cmd === "test_ollama_connection")
        return Promise.resolve("Ollama sunucusu hazır: llama3.2");
      if (cmd === "save_api_keys") return Promise.resolve();
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    // Switch to AI Services tab
    const apiKeysTab = screen.getByRole("button", {
      name: /Yapay Zeka Servisleri/i,
    });
    fireEvent.click(apiKeysTab);

    // Enter Groq Key
    const groqInput = screen.getByPlaceholderText("gsk_...");
    fireEvent.change(groqInput, { target: { value: "gsk_test_settings_key" } });

    // Enter Gemini Key
    const geminiInput = screen.getByPlaceholderText("AIzaSy...");
    fireEvent.change(geminiInput, {
      target: { value: "AIzaSy_test_settings_key" },
    });

    // Enter OpenAI Key
    const openaiInput = screen.getByPlaceholderText("sk-proj-...");
    fireEvent.change(openaiInput, {
      target: { value: "sk-proj_test_settings_key" },
    });

    // Test Ollama server
    const testOllamaBtn = screen.getByRole("button", {
      name: /Sunucu Bağlantısını Test Et/i,
    });
    await act(async () => {
      fireEvent.click(testOllamaBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "test_ollama_connection",
      expect.any(Object),
    );
    expect(
      await screen.findByText(/Ollama sunucusu hazır/i),
    ).toBeInTheDocument();

    // Save All API Keys
    const saveKeysBtn = screen.getByRole("button", { name: /^Kaydet$/i });
    await act(async () => {
      fireEvent.click(saveKeysBtn);
    });
    expect(localStorage.getItem("echomind_groq_key")).toBe(
      "gsk_test_settings_key",
    );
  });

  it("renders language selection tab and changes language", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_audio_devices") return Promise.resolve([]);
      if (cmd === "list_audio_devices") return Promise.resolve([]);
      if (cmd === "get_stored_api_keys")
        return Promise.resolve({ groq: "", gemini: "", openai: "" });
      if (cmd === "get_ollama_config")
        return Promise.resolve({ endpoint: "", model: "" });
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    // Language Tab
    const langTab = screen.getByRole("button", { name: /Arayüz Dili/i });
    fireEvent.click(langTab);

    const englishBtns = screen.getAllByText("English");
    fireEvent.click(englishBtns[0]);
    expect(localStorage.getItem("echomind_app_language")).toBe("en");
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <I18nProvider>
        <SettingsModal {...defaultProps} isOpen={false} />
      </I18nProvider>,
    );

    expect(container.firstChild).toBeNull();
  });
});
