import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App, { MeetingRecord } from "./App";
import { I18nProvider } from "./locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";

const mockPastMeetings: MeetingRecord[] = [
  {
    id: "mtg-app-1",
    title: "Haftalık İcra Kurulu Toplantısı",
    date_formatted: "01.09.2026",
    duration_seconds: 180,
    duration_formatted: "03:00",
    audio_file_path: "/path/to/meeting.flac",
    segments: [
      {
        id: 1,
        speaker_id: "spk1",
        speaker_name: "Ahmet",
        start_time_ms: 0,
        end_time_ms: 5000,
        timestamp_formatted: "00:00 -> 00:05",
        text: "Depo yatırımı için onay alındı.",
        language: "tr",
        confidence: 0.98,
      },
    ],
    summary: "İcra kurulu toplantısı özeti.",
    key_decisions: ["Depo yatırımı onaylandı."],
    engine_used: "⚡ Groq Whisper",
  },
  {
    id: "mtg-app-2",
    title: "Yazılım Mimari Değerlendirme",
    date_formatted: "02.09.2026",
    duration_seconds: 240,
    duration_formatted: "04:00",
    audio_file_path: "/path/to/arch.flac",
    segments: [],
    summary: "Mikroservis geçişi planlandı.",
    key_decisions: ["Mikroservis geçişi onaylandı."],
    engine_used: "🔒 Cihazda (Whisper Small)",
  },
];

describe("App Top-Level Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const setupDefaultInvoke = () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "get_hardware_info")
        return Promise.resolve({
          os_name: "macOS",
          os_version: "15.0",
          cpu_brand: "Apple M3 Max",
          cpu_cores: 16,
          total_ram_gb: 36,
          gpu_name: "Apple M3 Max (Metal)",
          metal_supported: true,
          cuda_supported: false,
          avx2_supported: true,
        });
      if (cmd === "get_model_status")
        return Promise.resolve({
          model_name: "whisper-small",
          is_loaded: true,
          is_downloading: false,
          download_progress: 100,
          hardware_acceleration: "Metal (Apple Silicon)",
        });
      if (cmd === "get_audio_status")
        return Promise.resolve({ is_recording: false, mic_level: 0 });
      if (cmd === "get_current_transcript") return Promise.resolve([]);
      if (cmd === "get_audio_devices") return Promise.resolve([]);
      if (cmd === "list_audio_devices") return Promise.resolve([]);
      if (cmd === "get_stored_api_keys")
        return Promise.resolve({ groq: "", gemini: "", openai: "" });
      if (cmd === "get_ollama_config")
        return Promise.resolve({
          endpoint: "http://127.0.0.1:11434",
          model: "llama3.2",
        });
      if (cmd === "start_meeting_detector") return Promise.resolve();
      if (cmd === "start_audio_capture") return Promise.resolve();
      if (cmd === "stop_audio_capture") return Promise.resolve();
      if (cmd === "save_current_meeting")
        return Promise.resolve(mockPastMeetings[0]);
      if (cmd === "get_meeting_by_id")
        return Promise.resolve(mockPastMeetings[0]);
      if (cmd === "delete_meeting_by_id") return Promise.resolve();
      if (cmd === "update_meeting_title")
        return Promise.resolve({
          ...mockPastMeetings[0],
          title: "Yeni İcra Başlığı",
        });
      if (cmd === "pick_audio_file_dialog")
        return Promise.resolve({
          path: "/tmp/test_meeting.mp3",
          file_name: "test_meeting.mp3",
          file_size_mb: 50,
          is_large_file: true,
        });
      if (cmd === "process_audio_file_path")
        return Promise.resolve(mockPastMeetings[0]);
      if (cmd === "ask_global_assistant")
        return Promise.resolve({
          answer: "Cevap",
          cited_meeting_ids: [],
          provider_used: "AI",
        });
      return Promise.resolve();
    });
  };

  it("renders top navigation, sidebar with meetings, and toggles recording", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    expect(screen.getByText(/Toplantı Geçmişi/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/Haftalık İcra Kurulu Toplantısı/i),
    ).toBeInTheDocument();

    // Toggle recording start
    const recordBtn = screen.getByRole("button", { name: /Dinlemeyi Başlat/i });
    await act(async () => {
      fireEvent.click(recordBtn);
    });
    expect(invoke).toHaveBeenCalledWith(
      "start_audio_capture",
      expect.any(Object),
    );

    // Toggle recording stop
    const stopBtn = screen.getByRole("button", { name: /Toplantıyı Bitir/i });
    await act(async () => {
      fireEvent.click(stopBtn);
    });
    expect(invoke).toHaveBeenCalledWith("stop_audio_capture");

    // Open settings modal
    const settingsBtn = screen.getByTitle(/Ayarlar/i);
    await act(async () => {
      fireEvent.click(settingsBtn);
    });
    expect(screen.getByText(/Ayarlar ve Tercihler/i)).toBeInTheDocument();
  });

  it("handles sidebar search and clearing query", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    expect(
      await screen.findByText(/Haftalık İcra Kurulu Toplantısı/i),
    ).toBeInTheDocument();

    // Search query
    const searchInput = screen.getByPlaceholderText(
      /Geçmiş toplantılarda ara/i,
    );
    fireEvent.change(searchInput, { target: { value: "Yazılım" } });

    expect(
      screen.getByText(/Yazılım Mimari Değerlendirme/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Haftalık İcra Kurulu Toplantısı/i)).toBeNull();

    // Clear search
    fireEvent.change(searchInput, { target: { value: "" } });
    expect(
      screen.getByText(/Haftalık İcra Kurulu Toplantısı/i),
    ).toBeInTheDocument();
  });

  it("handles language switching from header select box", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const langSelect = screen.getByTitle("Dil Seçimi");
    await act(async () => {
      fireEvent.change(langSelect, { target: { value: "en" } });
    });

    expect(localStorage.getItem("echomind_app_language")).toBe("en");
  });

  it("handles audio file import dialog and smart advisor flow", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const importBtn = screen.getByTitle(/Ses Dosyası Yükle/i);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    // Smart advisor modal should open for large file
    expect(
      await screen.findByText(/Akıllı İşlem Tavsiyesi/i),
    ).toBeInTheDocument();

    // Choose local option
    const localBtn = screen.getByText("🔒 Cihazımda Çözümle").closest("button");
    if (localBtn) {
      await act(async () => {
        fireEvent.click(localBtn);
      });
    }

    expect(invoke).toHaveBeenCalledWith(
      "process_audio_file_path",
      expect.objectContaining({
        filePath: "/tmp/test_meeting.mp3",
      }),
    );
  });

  it("handles cloud privacy confirmation workflow during file import", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve([]);
      if (cmd === "get_hardware_info") return Promise.resolve(null);
      if (cmd === "get_audio_status") return Promise.resolve(null);
      if (cmd === "get_current_transcript") return Promise.resolve([]);
      if (cmd === "pick_audio_file_dialog")
        return Promise.resolve({
          path: "/tmp/cloud_test.mp3",
          file_name: "cloud_test.mp3",
          file_size_mb: 80,
          is_large_file: true,
        });
      if (cmd === "process_audio_file_path")
        return Promise.resolve(mockPastMeetings[0]);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const importBtn = screen.getByTitle(/Ses Dosyası Yükle/i);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    // Smart advisor modal -> Enter inline Groq key
    const cloudBtn = screen
      .getByText("⚡ Yıldırım Hızı (Bulut)")
      .closest("button");
    if (cloudBtn) {
      await act(async () => {
        fireEvent.click(cloudBtn);
      });
    }

    const keyInput = screen.getByPlaceholderText("gsk_...");
    fireEvent.change(keyInput, { target: { value: "gsk_test_key_app" } });

    const startBtn = screen.getByRole("button", { name: /^Başlat$/i });
    await act(async () => {
      fireEvent.click(startBtn);
    });

    // Privacy confirmation modal should appear
    expect(
      await screen.findByText(/İnternet Üzerinden İşlem Uyarısı/i),
    ).toBeInTheDocument();

    const proceedCloudBtn = screen.getByRole("button", {
      name: /Bulut ile Hızlıca Çözümle/i,
    });
    await act(async () => {
      fireEvent.click(proceedCloudBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "process_audio_file_path",
      expect.objectContaining({
        cloudProvider: "groq",
        apiKey: "gsk_test_key_app",
      }),
    );
  });

  it("opens Model Hub modal from footer and header, and global assistant via shortcuts", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Open Model Hub from footer
    const footerModelBtn = screen.getByTitle(/Yapay Zeka Modunu Değiştir/i);
    await act(async () => {
      fireEvent.click(footerModelBtn);
    });
    expect(screen.getByText(/Model Yönetim Merkezi/i)).toBeInTheDocument();

    // Trigger Ctrl+K for Global Assistant
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(
      screen.getAllByText(/EchoMind Akıllı Asistan/i).length,
    ).toBeGreaterThan(0);
  });

  it("handles past meeting selection, title editing, return to live, and deletion", async () => {
    setupDefaultInvoke();
    window.confirm = vi.fn().mockReturnValue(true);

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Select meeting
    const meetingCard = await screen.findByText(
      /Haftalık İcra Kurulu Toplantısı/i,
    );
    await act(async () => {
      fireEvent.click(meetingCard);
    });

    // Return to live stream
    const returnToLiveBtn = await screen.findByRole("button", {
      name: /Canlı Akışa Dön/i,
    });
    await act(async () => {
      fireEvent.click(returnToLiveBtn);
    });

    // Edit meeting title
    const editTitleBtn = screen.getAllByTitle(/İsmi Düzenle/i)[0];
    await act(async () => {
      fireEvent.click(editTitleBtn);
    });

    const titleInput = screen.getByDisplayValue(
      /Haftalık İcra Kurulu Toplantısı/i,
    );
    fireEvent.change(titleInput, { target: { value: "Yeni İcra Başlığı" } });

    const saveTitleBtn = screen.getByTitle("Kaydet");
    await act(async () => {
      fireEvent.click(saveTitleBtn);
    });
    expect(invoke).toHaveBeenCalledWith("update_meeting_title", {
      meetingId: "mtg-app-1",
      newTitle: "Yeni İcra Başlığı",
    });

    // Prompt Delete meeting modal
    const deleteBtn = screen.getAllByTitle(/Toplantıyı Sil/i)[0];
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    // Confirm Delete in Modal
    const confirmDeleteBtn = screen.getByRole("button", { name: /^Sil$/i });
    await act(async () => {
      fireEvent.click(confirmDeleteBtn);
    });

    expect(invoke).toHaveBeenCalledWith("delete_meeting_by_id", {
      id: "mtg-app-1",
      meetingId: "mtg-app-1",
    });
  });
});
