import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { RetranscribeModal } from "./RetranscribeModal";
import { I18nProvider } from "../locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";
import { MeetingRecord } from "../App";

describe("RetranscribeModal Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const mockMeeting: MeetingRecord = {
    id: "mtg-001",
    title: "Q3 Planlama",
    date_formatted: "01.09.2026",
    duration_seconds: 120,
    duration_formatted: "02:00",
    audio_file_path: "/path/to/audio.flac",
    segments: [],
    summary: "",
    key_decisions: [],
  };

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    meeting: mockMeeting,
    onRetranscribeSuccess: vi.fn(),
  };

  it("renders retranscribe options, selects local models, and triggers local re-transcription", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve([]);
      if (cmd === "get_stored_api_keys")
        return Promise.resolve({ groq: "", gemini: "", openai: "" });
      if (cmd === "get_ollama_config")
        return Promise.resolve({
          endpoint: "http://127.0.0.1:11434",
          model: "llama3.2",
        });
      if (cmd === "retranscribe_meeting")
        return Promise.resolve({ ...mockMeeting, summary: "Yeni Özet" });
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <RetranscribeModal {...defaultProps} />
      </I18nProvider>,
    );

    expect(
      screen.getByText(/Konuşmaları Yeniden Yazıya Dök/i),
    ).toBeInTheDocument();

    // Select medium model
    const mediumBtn = screen.getByText(/Gelişmiş Mod \(Whisper Medium\)/i);
    fireEvent.click(mediumBtn);

    // Select large model
    const largeBtn = screen.getByText(/Zirve Netlik \(Whisper Large-v3\)/i);
    fireEvent.click(largeBtn);

    // Change language and summary provider
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "en" } });
    fireEvent.change(selects[1], { target: { value: "heuristic" } });

    const submitBtn = screen.getByRole("button", {
      name: /Yeniden Yazıya Dök/i,
    });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "retranscribe_meeting",
      expect.objectContaining({
        meetingId: "mtg-001",
        modelVersion: "large-v3-turbo",
        language: "en",
        summaryProvider: "heuristic",
      }),
    );
    expect(defaultProps.onRetranscribeSuccess).toHaveBeenCalled();
  });

  it("allows selecting OpenAI and Gemini cloud providers and triggers cloud re-transcription with stored API keys", async () => {
    localStorage.setItem("echomind_gemini_key", "AIzaSy_stored_key");
    localStorage.setItem("echomind_openai_key", "sk-proj_stored_key");

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve([]);
      if (cmd === "get_stored_api_keys")
        return Promise.resolve({
          groq: "",
          gemini: "AIzaSy_stored_key",
          openai: "sk-proj_stored_key",
        });
      if (cmd === "get_ollama_config")
        return Promise.resolve({
          endpoint: "http://127.0.0.1:11434",
          model: "llama3.2",
        });
      if (cmd === "retranscribe_meeting")
        return Promise.resolve({
          ...mockMeeting,
          summary: "Yeni Gemini Bulut Özeti",
        });
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <RetranscribeModal {...defaultProps} />
      </I18nProvider>,
    );

    const cloudBtn = screen.getByText(/Yüksek Hızlı Bulut Zekası/i);
    await act(async () => {
      fireEvent.click(cloudBtn);
    });

    // Select Gemini
    const geminiOptions = screen.getAllByText(/Google Gemini/i);
    fireEvent.click(geminiOptions[0]);

    // Select Gemini as summary provider too
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "gemini" } });

    const submitBtn = screen.getByRole("button", {
      name: /Yeniden Yazıya Dök/i,
    });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "retranscribe_meeting",
      expect.objectContaining({
        meetingId: "mtg-001",
        cloudProvider: "gemini",
        apiKey: "AIzaSy_stored_key",
        summaryProvider: "gemini",
        summaryApiKey: "AIzaSy_stored_key",
      }),
    );
    expect(defaultProps.onRetranscribeSuccess).toHaveBeenCalled();
  });

  it("shows error when cloud API key is missing", async () => {
    render(
      <I18nProvider>
        <RetranscribeModal {...defaultProps} />
      </I18nProvider>,
    );

    const cloudBtn = screen.getByText(/Yüksek Hızlı Bulut Zekası/i);
    await act(async () => {
      fireEvent.click(cloudBtn);
    });

    const submitBtn = screen.getByRole("button", {
      name: /Yeniden Yazıya Dök/i,
    });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByText(/API Anahtarı girmelisiniz/i)).toBeInTheDocument();
  });

  it("handles Groq and OpenAI cloud providers with API keys and retranscribe error", async () => {
    localStorage.setItem("echomind_groq_key", "gsk_groq_retranscribe_key");
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_available_models") return Promise.resolve([]);
      if (cmd === "get_stored_api_keys")
        return Promise.resolve({
          groq: "gsk_groq_retranscribe_key",
          gemini: "",
          openai: "",
        });
      if (cmd === "retranscribe_meeting")
        return Promise.reject("Sunucu bağlantı hatası");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <RetranscribeModal {...defaultProps} />
      </I18nProvider>,
    );

    const cloudBtn = screen.getByText(/Yüksek Hızlı Bulut Zekası/i);
    await act(async () => {
      fireEvent.click(cloudBtn);
    });

    // Select Groq
    const groqOption = screen.getByText(/Groq Zekası/i);
    fireEvent.click(groqOption);

    const submitBtn = screen.getByRole("button", {
      name: /Yeniden Yazıya Dök/i,
    });
    await act(async () => {
      fireEvent.click(submitBtn);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(
      await screen.findByText(/Sunucu bağlantı hatası/i),
    ).toBeInTheDocument();

    // Click close button
    const closeBtn = screen.getByRole("button", { name: /Vazgeç/i });
    fireEvent.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <I18nProvider>
        <RetranscribeModal {...defaultProps} isOpen={false} />
      </I18nProvider>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("handles apple_speech, sensevoice, and ollama summary engine selections", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "retranscribe_meeting") {
        return Promise.resolve({
          ...mockMeeting,
          transcription: "Apple Speech retranscribed",
        });
      }
      return Promise.resolve();
    });

    localStorage.setItem("echomind_ollama_endpoint", "http://localhost:11434");
    localStorage.setItem("echomind_ollama_model", "llama3.2");

    render(
      <I18nProvider>
        <RetranscribeModal {...defaultProps} />
      </I18nProvider>,
    );

    // Select sensevoice or apple_speech if available
    const selects = screen.getAllByRole("combobox");
    if (selects.length > 0) {
      fireEvent.change(selects[0], { target: { value: "apple_speech" } });
    }

    const submitBtn = screen.getByRole("button", {
      name: /Yeniden Yazıya Dök/i,
    });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "retranscribe_meeting",
      expect.objectContaining({
        summaryProvider: "ollama",
        customEndpoint: "http://localhost:11434",
        customModel: "llama3.2",
      }),
    );
  });
});
