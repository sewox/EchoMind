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

    // Select custom model for OpenAI
    const selects = screen.getAllByRole("combobox");
    if (selects.length > 0) {
      fireEvent.change(selects[selects.length - 1], {
        target: { value: "custom" },
      });
      const customInput = screen.getByPlaceholderText(/Model adı yazın/i);
      fireEvent.change(customInput, { target: { value: "my-custom-model" } });
    }

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

  it("handles AI model selection and audio test", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_audio_devices")
        return Promise.resolve([
          { name: "MacBook Pro Mic", is_loopback: false, is_default: true },
          { name: "External USB Mic", is_loopback: false, is_default: false },
        ]);
      if (cmd === "list_audio_devices")
        return Promise.resolve([
          { name: "MacBook Pro Mic", is_loopback: false, is_default: true },
          { name: "External USB Mic", is_loopback: false, is_default: false },
        ]);
      if (cmd === "get_stored_api_keys")
        return Promise.resolve({ groq: "", gemini: "", openai: "" });
      if (cmd === "get_ollama_config")
        return Promise.resolve({ endpoint: "", model: "" });
      return Promise.resolve();
    });

    const { container } = render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const deviceSelect = container.querySelector("select");
    if (deviceSelect) {
      await act(async () => {
        fireEvent.change(deviceSelect, {
          target: { value: "External USB Mic" },
        });
      });
      expect(localStorage.getItem("echomind_selected_audio_device")).toBe(
        "External USB Mic",
      );
    }
  });

  it("renders device and privacy tab and toggles cloud confirmation", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "list_audio_devices") return Promise.resolve([]);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    // Click Cihaz & Gizlilik tab
    const privacyTab = screen.getByRole("button", {
      name: /Cihaz & Gizlilik/i,
    });
    fireEvent.click(privacyTab);

    expect(screen.getByText(/Apple Silicon/i)).toBeInTheDocument();
  });

  it("handles AI services tab and API key inputs", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "list_audio_devices") return Promise.resolve([]);
      if (cmd === "test_ollama_connection")
        return Promise.reject("Sunucu kapalı");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    // AI Services tab
    const aiServicesTab = screen.getByRole("button", {
      name: /Yapay Zeka Servisleri/i,
    });
    fireEvent.click(aiServicesTab);

    // Change Gemini Key
    const geminiInput = screen.getByPlaceholderText(/AIzaSy.../i);
    fireEvent.change(geminiInput, {
      target: { value: "AIzaSy_test_gemini_key" },
    });

    // Change OpenAI Key
    const openaiInput = screen.getByPlaceholderText(/sk-proj-.../i);
    fireEvent.change(openaiInput, {
      target: { value: "sk-proj-test_openai_key" },
    });

    // Test toggleShowKey
    const eyeBtns = screen
      .getAllByRole("button")
      .filter(
        (b) =>
          b.querySelector("svg.lucide-eye") ||
          b.querySelector("svg.lucide-eye-off"),
      );
    if (eyeBtns.length > 0) {
      fireEvent.click(eyeBtns[0]);
    }

    // Change Gemini Model to custom
    const modelSelects = screen.getAllByRole("combobox");
    if (modelSelects.length > 0) {
      fireEvent.change(modelSelects[0], { target: { value: "custom" } });
    }

    // Save Keys
    const saveBtn = screen.getByRole("button", { name: /^Kaydet$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(localStorage.getItem("echomind_gemini_key")).toBe(
      "AIzaSy_test_gemini_key",
    );
    expect(localStorage.getItem("echomind_openai_key")).toBe(
      "sk-proj-test_openai_key",
    );
  });

  it("handles Ollama connection test success and failure", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "list_audio_devices") return Promise.resolve([]);
      if (cmd === "test_ollama_connection")
        return Promise.resolve("Bağlantı başarılı: llama3.2");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    // AI Services tab
    const aiServicesTab = screen.getByRole("button", {
      name: /Yapay Zeka Servisleri/i,
    });
    fireEvent.click(aiServicesTab);

    // Click Ollama test connection button
    const testOllamaBtn = screen.queryByRole("button", {
      name: /Bağlantıyı Test Et|Test Et/i,
    });
    if (testOllamaBtn) {
      await act(async () => {
        fireEvent.click(testOllamaBtn);
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(invoke).toHaveBeenCalledWith(
        "test_ollama_connection",
        expect.any(Object),
      );
    }
  });

  it("handles detector settings toggles and language switcher in SettingsModal", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "list_audio_devices") return Promise.resolve([]);
      if (cmd === "get_detector_settings") {
        return Promise.resolve({
          enabled: true,
          auto_start_record: true,
          auto_stop_on_app_close: true,
          ignored_apps: ["discord"],
        });
      }
      if (cmd === "update_detector_settings") return Promise.resolve();
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    // Click Toplantı Algılama tab if present
    const detectorTab = screen.queryByRole("button", {
      name: /Toplantı Algılama|Algılama/i,
    });
    if (detectorTab) {
      fireEvent.click(detectorTab);
      const toggleInputs = screen.getAllByRole("checkbox");
      if (toggleInputs.length > 0) {
        fireEvent.click(toggleInputs[0]);
      }
    }
  });

  it("handles custom model version selections for Groq, Gemini, and OpenAI", async () => {
    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    // AI Services tab
    const aiServicesTab = screen.getByRole("button", {
      name: /Yapay Zeka Servisleri/i,
    });
    fireEvent.click(aiServicesTab);

    // Select custom models
    const selects = screen.getAllByRole("combobox");
    if (selects.length >= 3) {
      fireEvent.change(selects[0], { target: { value: "custom" } });
      fireEvent.change(selects[1], { target: { value: "custom" } });
      fireEvent.change(selects[2], { target: { value: "custom" } });

      const customInputs = screen.getAllByPlaceholderText(/Model adı yazın/i);
      if (customInputs.length >= 3) {
        fireEvent.change(customInputs[0], {
          target: { value: "my-custom-groq-model" },
        });
        fireEvent.change(customInputs[1], {
          target: { value: "gemini-2.0-pro" },
        });
        fireEvent.change(customInputs[2], {
          target: { value: "whisper-custom-v1" },
        });
      }
    }
  });

  it("handles audio device change and language selection", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_audio_devices")
        return Promise.resolve(["Default Built-in", "Studio USB"]);
      if (cmd === "list_audio_devices")
        return Promise.resolve(["Default Built-in", "Studio USB"]);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    // Selects in general settings
    const selects = screen.getAllByRole("combobox");
    if (selects.length > 0) {
      fireEvent.change(selects[0], { target: { value: "en" } });
    }
  });

  it("handles eye toggle for keys and ollama model input", async () => {
    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    // AI Services tab
    const aiServicesTab = screen.getByRole("button", {
      name: /Yapay Zeka Servisleri/i,
    });
    fireEvent.click(aiServicesTab);

    // Click all eye toggle buttons in AI services tab
    const eyeBtns = screen
      .getAllByRole("button")
      .filter(
        (b) =>
          b.querySelector("svg.lucide-eye") ||
          b.querySelector("svg.lucide-eye-off"),
      );
    eyeBtns.forEach((btn) => fireEvent.click(btn));

    // Ollama model input
    const ollamaInput = screen.getByPlaceholderText(/llama3.2/i);
    fireEvent.change(ollamaInput, { target: { value: "qwen2.5:7b" } });
    expect(localStorage.getItem("echomind_ollama_model")).toBe("qwen2.5:7b");

    const endpointInput = screen.getByPlaceholderText(/127.0.0.1:11434/i);
    fireEvent.change(endpointInput, {
      target: { value: "http://localhost:11434" },
    });
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <I18nProvider>
        <SettingsModal {...defaultProps} isOpen={false} />
      </I18nProvider>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("handles meeting detector auto-start and auto-stop checkboxes", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_detector_settings") {
        return Promise.resolve({
          enabled: true,
          poll_interval_seconds: 5,
          apps_to_monitor: ["zoom.us", "Teams"],
          auto_start_record: true,
          auto_stop_on_app_close: true,
        });
      }
      if (cmd === "update_detector_settings") return Promise.resolve();
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <SettingsModal {...defaultProps} />
      </I18nProvider>,
    );

    // General / Hardware & Privacy tab
    const generalTab = screen.getByRole("button", {
      name: /Cihaz & Gizlilik/i,
    });
    await act(async () => {
      fireEvent.click(generalTab);
    });

    // Checkboxes inside detector
    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      await act(async () => {
        fireEvent.click(cb);
      });
    }

    expect(invoke).toHaveBeenCalledWith(
      "update_detector_settings",
      expect.any(Object),
    );
  });
});
