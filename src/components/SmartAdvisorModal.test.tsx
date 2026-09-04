import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SmartAdvisorModal, PickedFileInfo } from "./SmartAdvisorModal";
import { I18nProvider } from "../locales/i18nContext";

describe("SmartAdvisorModal Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const mockFileInfo: PickedFileInfo = {
    path: "/path/to/long_audio.mp3",
    file_name: "long_audio.mp3",
    file_size_mb: 45,
    is_large_file: true,
  };

  const defaultProps = {
    isOpen: true,
    fileInfo: mockFileInfo,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    onOpenSettings: vi.fn(),
  };

  it("renders smart advisor recommendation and allows choosing local processing", () => {
    render(
      <I18nProvider>
        <SmartAdvisorModal {...defaultProps} />
      </I18nProvider>,
    );

    expect(screen.getByText(/Akıllı İşlem Tavsiyesi/i)).toBeInTheDocument();

    const localCard = screen
      .getByText("🔒 Cihazımda Çözümle")
      .closest("button");
    if (localCard) {
      fireEvent.click(localCard);
      expect(defaultProps.onConfirm).toHaveBeenCalledWith(
        "local",
        undefined,
        undefined,
        "auto",
      );
    }
  });

  it("allows cloud selection and inline key input for Groq, Gemini, and OpenAI", async () => {
    render(
      <I18nProvider>
        <SmartAdvisorModal {...defaultProps} />
      </I18nProvider>,
    );

    const cloudCard = screen
      .getByText("⚡ Yıldırım Hızı (Bulut)")
      .closest("button");
    if (cloudCard) {
      await act(async () => {
        fireEvent.click(cloudCard);
      });
    }

    // Input form should appear
    expect(
      screen.getByText(/Bulut Yapay Zeka Anahtarı Girin/i),
    ).toBeInTheDocument();

    // 1. Switch to Gemini
    const geminiBtn = screen.getByRole("button", { name: /Google Gemini/i });
    fireEvent.click(geminiBtn);
    const geminiInput = screen.getByPlaceholderText("AIzaSy...");
    fireEvent.change(geminiInput, { target: { value: "AIzaSy_test_key" } });

    // 2. Switch to OpenAI
    const openaiBtn = screen.getByRole("button", { name: /OpenAI/i });
    fireEvent.click(openaiBtn);
    const openaiInput = screen.getByPlaceholderText("sk-proj-...");
    fireEvent.change(openaiInput, { target: { value: "sk-proj_test_key" } });

    // 3. Switch back to Groq
    const groqBtn = screen.getByRole("button", { name: /Groq/i });
    fireEvent.click(groqBtn);
    const groqInput = screen.getByPlaceholderText("gsk_...");
    fireEvent.change(groqInput, { target: { value: "gsk_test_api_key" } });

    // Click Start
    const startBtn = screen.getByRole("button", { name: /^Başlat$/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(defaultProps.onConfirm).toHaveBeenCalledWith(
      "cloud_groq",
      "gsk_test_api_key",
      expect.any(String),
      "auto",
    );
  });

  it("allows direct start when an API key already exists in localStorage", async () => {
    localStorage.setItem("echomind_groq_key", "gsk_stored_key");

    render(
      <I18nProvider>
        <SmartAdvisorModal {...defaultProps} />
      </I18nProvider>,
    );

    const cloudCard = screen
      .getByText("⚡ Yıldırım Hızı (Bulut)")
      .closest("button");
    if (cloudCard) {
      await act(async () => {
        fireEvent.click(cloudCard);
      });
    }

    expect(defaultProps.onConfirm).toHaveBeenCalledWith(
      "cloud_groq",
      "gsk_stored_key",
      expect.any(String),
      "auto",
    );
  });

  it("allows opening settings from inside inline form", async () => {
    render(
      <I18nProvider>
        <SmartAdvisorModal {...defaultProps} />
      </I18nProvider>,
    );

    const cloudCard = screen
      .getByText("⚡ Yıldırım Hızı (Bulut)")
      .closest("button");
    if (cloudCard) {
      await act(async () => {
        fireEvent.click(cloudCard);
      });
    }

    const settingsLink = screen.getByText(/Ayarlardan Yönet/i);
    fireEvent.click(settingsLink);
    expect(defaultProps.onClose).toHaveBeenCalled();
    expect(defaultProps.onOpenSettings).toHaveBeenCalled();
  });

  it("allows changing spoken language and toggling remember choice", () => {
    render(
      <I18nProvider>
        <SmartAdvisorModal {...defaultProps} />
      </I18nProvider>,
    );

    const langSelect = screen.getByRole("combobox");
    fireEvent.change(langSelect, { target: { value: "en" } });

    const rememberCheck = screen.getByRole("checkbox");
    fireEvent.click(rememberCheck);

    const localCard = screen
      .getByText("🔒 Cihazımda Çözümle")
      .closest("button");
    if (localCard) {
      fireEvent.click(localCard);
      expect(defaultProps.onConfirm).toHaveBeenCalledWith(
        "local",
        undefined,
        undefined,
        "en",
      );
    }
  });

  it("handles inline key input with remember choice checked", async () => {
    render(
      <I18nProvider>
        <SmartAdvisorModal {...defaultProps} />
      </I18nProvider>,
    );

    const cloudCard = screen
      .getByText("⚡ Yıldırım Hızı (Bulut)")
      .closest("button");
    if (cloudCard) {
      await act(async () => {
        fireEvent.click(cloudCard);
      });
    }

    const rememberCheck = screen.getByRole("checkbox");
    fireEvent.click(rememberCheck);

    const groqInput = screen.getByPlaceholderText("gsk_...");
    fireEvent.change(groqInput, { target: { value: "gsk_remember_key" } });

    const startBtn = screen.getByRole("button", { name: /^Başlat$/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(localStorage.getItem("echomind_groq_key")).toBe("gsk_remember_key");
    expect(localStorage.getItem("echomind_active_engine")).toBe("cloud_groq");
  });

  it("handles Gemini and OpenAI inline key saving with remember choice", async () => {
    render(
      <I18nProvider>
        <SmartAdvisorModal {...defaultProps} />
      </I18nProvider>,
    );

    const cloudCard = screen
      .getByText("⚡ Yıldırım Hızı (Bulut)")
      .closest("button");
    if (cloudCard) {
      await act(async () => {
        fireEvent.click(cloudCard);
      });
    }

    // Switch to Gemini
    const geminiBtn = screen.getByRole("button", { name: /Google Gemini/i });
    fireEvent.click(geminiBtn);

    const geminiInput = screen.getByPlaceholderText("AIzaSy...");
    fireEvent.change(geminiInput, {
      target: { value: "AIzaSy_remember_gemini" },
    });

    const startBtn = screen.getByRole("button", { name: /^Başlat$/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(localStorage.getItem("echomind_gemini_key")).toBe(
      "AIzaSy_remember_gemini",
    );
    expect(defaultProps.onConfirm).toHaveBeenCalledWith(
      "cloud_gemini",
      "AIzaSy_remember_gemini",
      expect.any(String),
      "auto",
    );
  });

  it("handles open settings link in SmartAdvisorModal", async () => {
    render(
      <I18nProvider>
        <SmartAdvisorModal {...defaultProps} />
      </I18nProvider>,
    );

    const cloudCard = screen
      .getByText("⚡ Yıldırım Hızı (Bulut)")
      .closest("button");
    if (cloudCard) {
      await act(async () => {
        fireEvent.click(cloudCard);
      });
    }

    const settingsLink = screen.getByRole("button", {
      name: /Ayarlardan Yönet/i,
    });
    fireEvent.click(settingsLink);

    expect(defaultProps.onClose).toHaveBeenCalled();
    expect(defaultProps.onOpenSettings).toHaveBeenCalled();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <I18nProvider>
        <SmartAdvisorModal {...defaultProps} isOpen={false} />
      </I18nProvider>,
    );

    expect(container.firstChild).toBeNull();
  });
});
