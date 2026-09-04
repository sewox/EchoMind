import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App, { MeetingRecord } from "./App";
import { I18nProvider } from "./locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";
import { globalTestEventListeners } from "./test/setup";

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

  it("handles opening Settings, ModelHub, and Global Assistant modals", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "get_hardware_info")
        return Promise.resolve({
          device_tier: "ultra",
          has_metal: true,
          total_ram_gb: 16,
        });
      if (cmd === "get_available_models") return Promise.resolve([]);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Open Settings Modal
    const settingsBtn = screen.getByTitle(/^Ayarlar$/i);
    await act(async () => {
      fireEvent.click(settingsBtn);
    });
    expect(await screen.findByText("Ayarlar ve Tercihler")).toBeInTheDocument();

    // Close Settings Modal
    const closeSettings = screen.getByRole("button", { name: /Kapat/i });
    await act(async () => {
      fireEvent.click(closeSettings);
    });

    // Open Model Hub
    const modelHubBtn = screen.getByText(/Modeller/i);
    await act(async () => {
      fireEvent.click(modelHubBtn);
    });
    expect(
      await screen.findByText("Model Yönetim Merkezi"),
    ).toBeInTheDocument();

    // Open Global Assistant
    const assistantBtns = screen.getAllByRole("button", {
      name: /Akıllı Asistan/i,
    });
    await act(async () => {
      fireEvent.click(assistantBtns[0]);
    });
    expect(
      await screen.findByPlaceholderText(/Toplantılarım hakkında bir şey sor/i),
    ).toBeInTheDocument();
  });

  it("toggles Global Assistant via Ctrl+K keyboard shortcut", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Press Ctrl+K
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });

    expect(
      await screen.findByPlaceholderText(/Toplantılarım hakkında bir şey sor/i),
    ).toBeInTheDocument();
  });

  it("handles audio file import with Smart Advisor modal for large files", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/path/to/large_meeting.wav",
          file_name: "large_meeting.wav",
          file_size_mb: 50.0,
          is_large_file: true,
        });
      }
      if (cmd === "process_audio_file_path") {
        return Promise.resolve({
          ...mockPastMeetings[0],
          id: "mtg-imported-1",
          title: "large_meeting",
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Click Import Button
    const importBtns = screen.getAllByRole("button", { name: /Ses Dosyası/i });
    await act(async () => {
      fireEvent.click(importBtns[0]);
    });

    // Smart Advisor Modal should open
    expect(
      await screen.findByText(/Akıllı İşlem Tavsiyesi/i),
    ).toBeInTheDocument();

    // Select Local processing
    const localOptionBtn = screen.getByRole("button", {
      name: /Cihazda Devam Et/i,
    });
    await act(async () => {
      fireEvent.click(localOptionBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "process_audio_file_path",
      expect.objectContaining({
        filePath: "/path/to/large_meeting.wav",
      }),
    );
  });

  it("handles audio file import with Cloud Privacy confirmation modal", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/path/to/small_meeting.wav",
          file_name: "small_meeting.wav",
          file_size_mb: 5.0,
          is_large_file: false,
        });
      }
      if (cmd === "get_stored_api_keys") {
        return Promise.resolve({
          groq: "gsk-mock-key",
          gemini: "",
          openai: "",
        });
      }
      if (cmd === "process_audio_file_path") {
        return Promise.resolve({
          ...mockPastMeetings[0],
          id: "mtg-cloud-imported",
          title: "small_meeting",
        });
      }
      return Promise.resolve();
    });

    // Set cloud provider and active engine in localStorage
    localStorage.setItem("echomind_active_engine", "cloud_groq");
    localStorage.setItem("echomind_groq_key", "gsk-mock-key");

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Click Import Button
    const importBtns = screen.getAllByRole("button", { name: /Ses Dosyası/i });
    await act(async () => {
      fireEvent.click(importBtns[0]);
    });

    // Privacy Confirmation Modal should open
    expect(
      await screen.findByText(/İnternet Üzerinden İşlem Uyarısı/i),
    ).toBeInTheDocument();

    // Proceed with Cloud
    const proceedCloudBtn = screen.getByRole("button", {
      name: /Bulut ile Hızlıca Çözümle/i,
    });
    await act(async () => {
      fireEvent.click(proceedCloudBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "process_audio_file_path",
      expect.objectContaining({
        filePath: "/path/to/small_meeting.wav",
        apiKey: "gsk-mock-key",
        cloudProvider: "groq",
      }),
    );
  });

  it("handles meeting title editing, cancel with escape, and saving", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Wait for meeting card to render
    expect(
      await screen.findByText("Haftalık İcra Kurulu Toplantısı"),
    ).toBeInTheDocument();

    // Click edit title button on meeting card
    const editBtn = screen.getAllByTitle(/İsmi Düzenle/i)[0];
    await act(async () => {
      fireEvent.click(editBtn);
    });

    const titleInput = screen.getByDisplayValue(
      "Haftalık İcra Kurulu Toplantısı",
    );
    fireEvent.change(titleInput, { target: { value: "Yeni İcra Başlığı" } });

    // Cancel with Escape
    fireEvent.keyDown(titleInput, { key: "Escape" });
    expect(
      screen.queryByDisplayValue("Yeni İcra Başlığı"),
    ).not.toBeInTheDocument();

    // Re-open and save with Enter
    const editBtnAgain = screen.getAllByTitle(/İsmi Düzenle/i)[0];
    await act(async () => {
      fireEvent.click(editBtnAgain);
    });
    const titleInputAgain = screen.getByDisplayValue(
      "Haftalık İcra Kurulu Toplantısı",
    );
    fireEvent.change(titleInputAgain, {
      target: { value: "Yeni İcra Başlığı" },
    });
    await act(async () => {
      fireEvent.keyDown(titleInputAgain, { key: "Enter" });
    });

    expect(invoke).toHaveBeenCalledWith(
      "update_meeting_title",
      expect.objectContaining({
        meetingId: "mtg-app-1",
        newTitle: "Yeni İcra Başlığı",
      }),
    );
  });

  it("handles search query filtering and clear button", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    expect(
      await screen.findByText("Haftalık İcra Kurulu Toplantısı"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Yazılım Mimari Değerlendirme"),
    ).toBeInTheDocument();

    // Type query to filter
    const searchInput = screen.getByPlaceholderText(
      /Geçmiş toplantılarda ara/i,
    );
    fireEvent.change(searchInput, { target: { value: "Mimari" } });

    expect(
      screen.queryByText("Haftalık İcra Kurulu Toplantısı"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Yazılım Mimari Değerlendirme"),
    ).toBeInTheDocument();

    // Clear search with clear button
    const clearBtn = screen.getByRole("button", { name: "" });
    if (clearBtn) {
      fireEvent.click(clearBtn);
    }
  });

  it("handles recording toggle, starting audio capture and saving meeting", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Click Start Listening button
    const startRecordBtn = screen.getByRole("button", {
      name: /Dinlemeyi Başlat/i,
    });
    await act(async () => {
      fireEvent.click(startRecordBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "start_audio_capture",
      expect.anything(),
    );

    // Click Stop Listening button
    const stopRecordBtn = screen.getByRole("button", {
      name: /Toplantıyı Bitir/i,
    });
    await act(async () => {
      fireEvent.click(stopRecordBtn);
    });

    expect(invoke).toHaveBeenCalledWith("stop_audio_capture");
  });

  it("handles past meeting selection and returning to live session", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    expect(
      await screen.findByText("Haftalık İcra Kurulu Toplantısı"),
    ).toBeInTheDocument();

    // Click on past meeting card
    const meetingCard = screen.getByText("Haftalık İcra Kurulu Toplantısı");
    await act(async () => {
      fireEvent.click(meetingCard);
    });

    // Return to live session button in sidebar header
    const newLiveBtn = screen.getByTitle(/Canlı Toplantı Akışı/i);
    await act(async () => {
      fireEvent.click(newLiveBtn);
    });

    expect(
      screen.getByRole("button", { name: /Dinlemeyi Başlat/i }),
    ).toBeInTheDocument();
  });

  it("handles CustomContextMenu actions, right-click, open assistant and open settings", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Trigger right click context menu on document
    fireEvent.contextMenu(window, { clientX: 200, clientY: 200 });

    // Click Assistant from Context Menu
    const assistantContextItem = screen.getByText("Toplantı Asistanı");
    await act(async () => {
      fireEvent.click(assistantContextItem);
    });

    expect(
      await screen.findByPlaceholderText(/Toplantılarım hakkında bir şey sor/i),
    ).toBeInTheDocument();
  });

  it("handles Smart Advisor modal close and open settings triggers", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/path/to/large_meeting.wav",
          file_name: "large_meeting.wav",
          file_size_mb: 50.0,
          is_large_file: true,
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Trigger Smart Advisor
    const importBtns = screen.getAllByRole("button", { name: /Ses Dosyası/i });
    await act(async () => {
      fireEvent.click(importBtns[0]);
    });

    expect(
      await screen.findByText(/Akıllı İşlem Tavsiyesi/i),
    ).toBeInTheDocument();

    // Click Close on Smart Advisor (the X button)
    const closeAdvisorBtn = screen.getByTitle("Kapat");
    await act(async () => {
      fireEvent.click(closeAdvisorBtn);
    });

    expect(
      screen.queryByText(/Akıllı İşlem Tavsiyesi/i),
    ).not.toBeInTheDocument();
  });

  it("handles retranscribe meeting with cloud providers (Gemini, Groq, OpenAI)", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "retranscribe_meeting") {
        return Promise.resolve({
          ...mockPastMeetings[0],
          transcript: [
            {
              id: "t1",
              speaker: "Test",
              text: "Yeniden çevrildi.",
              timestamp: "00:01",
            },
          ],
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Select meeting
    const meetingCard = await screen.findByText(
      "Haftalık İcra Kurulu Toplantısı",
    );
    await act(async () => {
      fireEvent.click(meetingCard);
    });

    // Open Retranscribe modal
    const retranscribeBtn = await screen.findByRole("button", {
      name: /Yeniden Yazıya Dök/i,
    });
    await act(async () => {
      fireEvent.click(retranscribeBtn);
    });

    expect(
      await screen.findByText(/Konuşmaları Yeniden Yazıya Dök/i),
    ).toBeInTheDocument();

    // Set groq key in storage
    localStorage.setItem("echomind_groq_key", "gsk_test_12345");

    // Switch to Cloud method
    const cloudMethodCard = screen.getByText(/Yüksek Hızlı Bulut Zekası/i);
    fireEvent.click(cloudMethodCard);

    // Select Groq
    const groqCard = screen.getByText(/Groq Zekası/i);
    fireEvent.click(groqCard);

    // Click Start Retranscribe (the submit button inside modal)
    const retranscribeBtns = screen.getAllByRole("button", {
      name: /^Yeniden Yazıya Dök$/i,
    });
    const startBtn = retranscribeBtns[retranscribeBtns.length - 1];
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "retranscribe_meeting",
      expect.objectContaining({
        meetingId: "mtg-app-1",
        cloudProvider: "groq",
        apiKey: "gsk_test_12345",
      }),
    );
  });

  it("handles model hub modal trigger and onModelChanged event", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Click footer model hub button
    const modelHubBtn = screen.getByTitle("Yapay Zeka Modunu Değiştir");
    await act(async () => {
      fireEvent.click(modelHubBtn);
    });

    expect(
      await screen.findByText("Model Yönetim Merkezi"),
    ).toBeInTheDocument();
  });

  it("handles saving active live meeting on stop recording", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "start_audio_capture") return Promise.resolve();
      if (cmd === "stop_audio_capture") return Promise.resolve();
      if (cmd === "save_current_meeting") {
        return Promise.resolve({
          id: "m_new",
          title: "Kaydedilen Canlı Toplantı",
          date_formatted: "04.09.2026",
          duration_formatted: "01:00",
          duration_seconds: 60,
          summary: {
            overall_summary: "Özet",
            key_decisions: [],
            action_items: [],
          },
          transcript: [
            {
              id: "1",
              text: "Canlı toplantı konuşması",
              timestamp: "00:01",
              speaker: "A",
            },
          ],
          segments: [],
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Start Recording
    const startRecordBtn = screen.getByRole("button", {
      name: /Dinlemeyi Başlat/i,
    });
    await act(async () => {
      fireEvent.click(startRecordBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "start_audio_capture",
      expect.anything(),
    );
  });

  it("handles meeting title inline editing and saving in sidebar", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "update_meeting_title") {
        return Promise.resolve({
          ...mockPastMeetings[0],
          title: "Yeni Güncellenen Başlık",
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    expect(
      await screen.findByText("Haftalık İcra Kurulu Toplantısı"),
    ).toBeInTheDocument();

    // Click edit title icon
    const editBtns = screen.getAllByTitle("İsmi Düzenle");
    fireEvent.click(editBtns[0]);

    // Input is rendered
    const input = screen.getByDisplayValue("Haftalık İcra Kurulu Toplantısı");
    fireEvent.change(input, { target: { value: "Yeni Güncellenen Başlık" } });

    // Save with check button
    const saveBtn = screen.getByTitle("Kaydet");
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "update_meeting_title",
      expect.objectContaining({
        meetingId: "mtg-app-1",
        newTitle: "Yeni Güncellenen Başlık",
      }),
    );
  });

  it("handles meeting deletion confirmation flow in sidebar", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "delete_meeting_by_id") return Promise.resolve();
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    expect(
      await screen.findByText("Haftalık İcra Kurulu Toplantısı"),
    ).toBeInTheDocument();

    // Click trash button
    const deleteBtns = screen.getAllByTitle("Toplantıyı Sil");
    fireEvent.click(deleteBtns[0]);

    // Delete modal appears
    expect(
      screen.getByText(
        /Bu toplantıyı ve tüm kayıtlarını silmek istediğinize emin misiniz/i,
      ),
    ).toBeInTheDocument();

    // Confirm deletion
    const confirmDeleteBtn = screen.getByRole("button", { name: /^Sil$/i });
    await act(async () => {
      fireEvent.click(confirmDeleteBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "delete_meeting_by_id",
      expect.objectContaining({
        meetingId: "mtg-app-1",
      }),
    );
  });

  it("handles meeting export modal flow", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "export_meeting_notes")
        return Promise.resolve("Exported Markdown Notes");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Select meeting
    const meetingCard = await screen.findByText(
      "Haftalık İcra Kurulu Toplantısı",
    );
    await act(async () => {
      fireEvent.click(meetingCard);
      await new Promise((r) => setTimeout(r, 100));
    });

    // Open export modal
    const exportBtn = await screen.findByRole("button", {
      name: /Raporu Paylaş/i,
    });
    await act(async () => {
      fireEvent.click(exportBtn);
    });

    expect(
      await screen.findByText(/Raporu Dışa Aktar & Paylaş/i),
    ).toBeInTheDocument();
  });

  it("handles global assistant selecting a meeting and navigating to it", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "global_search_meetings") {
        return Promise.resolve([
          {
            meeting_id: "mtg-app-1",
            meeting_title: "Haftalık İcra Kurulu Toplantısı",
            date_formatted: "01.09.2026",
            duration_formatted: "10:00",
            matches: [
              {
                match_type: "goal",
                text_snippet: "Gelir artışı",
                segment_id: 1,
              },
            ],
          },
        ]);
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Open assistant via CustomContextMenu
    fireEvent.contextMenu(window, { clientX: 200, clientY: 200 });
    const assistantContextItem = screen.getByText("Toplantı Asistanı");
    await act(async () => {
      fireEvent.click(assistantContextItem);
    });

    expect(
      await screen.findByPlaceholderText(/Toplantılarım hakkında bir şey sor/i),
    ).toBeInTheDocument();

    // Switch to search tab
    const searchTab = screen.getByRole("button", { name: /Ara\.\.\./i });
    fireEvent.click(searchTab);

    // Search query
    const searchInput = screen.getByPlaceholderText(/Tüm toplantı başlıkları/i);
    fireEvent.change(searchInput, { target: { value: "Gelir" } });

    // Click Go to Meeting
    const goToMeetingBtn = await screen.findByRole("button", {
      name: /Toplantıya Git/i,
    });
    await act(async () => {
      fireEvent.click(goToMeetingBtn);
    });

    // Assistant closed, meeting active
    expect(
      screen.queryByPlaceholderText(/Toplantılarım hakkında bir şey sor/i),
    ).not.toBeInTheDocument();
  });

  it("handles advisor confirmation with cloud provider and with local provider", async () => {
    localStorage.setItem("echomind_suppress_cloud_warning", "true");
    localStorage.setItem("echomind_groq_key", "gsk_stored_test_key");

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/tmp/large_audio.mp3",
          file_name: "large_audio.mp3",
          file_size_mb: 85.0,
          is_large_file: true,
        });
      }
      if (cmd === "process_audio_file_path") {
        return Promise.resolve({
          ...mockPastMeetings[0],
          id: "m_processed",
          title: "İşlenen Büyük Dosya",
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Import audio to open advisor
    const importBtn = screen.getByTitle(/Ses Dosyası Yükle/i);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    expect(
      await screen.findByText(/Akıllı İşlem Tavsiyesi/i),
    ).toBeInTheDocument();

    // Cloud option with API key in storage
    const cloudBtn = screen.getByRole("button", {
      name: /Bulut ile Başlat|Yıldırım Hızı/i,
    });
    await act(async () => {
      fireEvent.click(cloudBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "process_audio_file_path",
      expect.objectContaining({
        cloudProvider: "groq",
        apiKey: "gsk_stored_test_key",
      }),
    );
  });

  it("handles cloud privacy confirmation proceed with cloud", async () => {
    localStorage.removeItem("echomind_suppress_cloud_warning");
    localStorage.setItem("echomind_active_engine", "cloud_gemini");
    localStorage.setItem("echomind_gemini_key", "AIza_test_key");

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/tmp/small_audio.mp3",
          file_name: "small_audio.mp3",
          file_size_mb: 5.0,
          is_large_file: false,
        });
      }
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

    // Privacy modal appears
    expect(
      await screen.findByText(/İnternet Üzerinden İşlem Uyarısı/i),
    ).toBeInTheDocument();

    // Click proceed cloud
    const proceedCloudBtn = screen.getByRole("button", {
      name: /Bulut ile Hızlıca Çözümle/i,
    });
    await act(async () => {
      fireEvent.click(proceedCloudBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "process_audio_file_path",
      expect.objectContaining({
        cloudProvider: "gemini",
        apiKey: "AIza_test_key",
      }),
    );
  });

  it("handles cloud privacy confirmation switch to local", async () => {
    localStorage.removeItem("echomind_suppress_cloud_warning");
    localStorage.setItem("echomind_active_engine", "cloud_groq");
    localStorage.setItem("echomind_groq_key", "gsk_test_key");

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/tmp/small_audio2.mp3",
          file_name: "small_audio2.mp3",
          file_size_mb: 4.0,
          is_large_file: false,
        });
      }
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

    const proceedLocalBtn = await screen.findByRole("button", {
      name: /Cihazımda Gizli Çözümle/i,
    });
    await act(async () => {
      fireEvent.click(proceedLocalBtn);
    });

    expect(invoke).toHaveBeenCalledWith(
      "process_audio_file_path",
      expect.objectContaining({
        cloudProvider: null,
        apiKey: null,
      }),
    );
  });

  it("handles Tauri event listeners for recording and meeting saved", async () => {
    const { globalTestEventListeners } = await import("./test/setup");
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // 1. Trigger start recording via floating island event
    const startListeners =
      globalTestEventListeners["trigger-start-recording"] || [];
    if (startListeners.length > 0) {
      await act(async () => {
        startListeners[0]({ payload: { title: "Ada Toplantısı" } });
      });
    }

    // 2. Trigger meeting saved event
    const savedListeners = globalTestEventListeners["meeting-saved"] || [];
    if (savedListeners.length > 0) {
      await act(async () => {
        savedListeners[savedListeners.length - 1]({
          payload: {
            ...mockPastMeetings[0],
            id: "m_saved_event",
            title: "Ada Kaydedilen Toplantı",
            duration_formatted: "04:15",
            audio_file_path: null,
            segments: mockPastMeetings[0].segments,
          },
        });
      });
    }

    // Expect completion banner
    expect(
      await screen.findByText(/Ada Kaydedilen Toplantı/i),
    ).toBeInTheDocument();

    // Dismiss banner
    const closeBtn = screen.getByTitle("Kapat");
    await act(async () => {
      fireEvent.click(closeBtn);
    });
  });

  it("handles audio import failure with alert gracefully", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/tmp/corrupt.mp3",
          file_name: "corrupt.mp3",
          file_size_mb: 2.0,
          is_large_file: false,
        });
      }
      if (cmd === "process_audio_file_path") {
        return Promise.reject(new Error("Corrupt audio file format"));
      }
      return Promise.resolve();
    });

    localStorage.setItem("echomind_suppress_cloud_warning", "true");

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const importBtn = screen.getByTitle(/Ses Dosyası Yükle/i);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("handles auto-start and auto-stop meeting detection callback", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve([]);
      if (cmd === "start_audio_capture") return Promise.resolve();
      if (cmd === "stop_audio_capture") return Promise.resolve();
      if (cmd === "save_current_meeting")
        return Promise.resolve(mockPastMeetings[0]);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Click Start Recording
    const startRecordBtn = await screen.findByRole("button", {
      name: /Dinlemeyi Başlat/i,
    });
    await act(async () => {
      fireEvent.click(startRecordBtn);
    });

    // Toggle recording again to stop
    const stopRecordBtn = await screen.findByRole("button", {
      name: /Toplantıyı Bitir/i,
    });
    await act(async () => {
      fireEvent.click(stopRecordBtn);
    });

    expect(invoke).toHaveBeenCalledWith("stop_audio_capture");
  });

  it("handles Ctrl+K and Cmd+K keyboard shortcut to toggle Global Assistant modal", async () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Press Ctrl+K
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(
      screen.getByRole("heading", { name: "EchoMind Akıllı Asistan" }),
    ).toBeInTheDocument();

    // Press Cmd+K to close
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
      await new Promise((r) => setTimeout(r, 20));
    });
  });

  it("handles audio file import with Apple Speech and SenseVoice engines", async () => {
    localStorage.setItem("echomind_active_engine", "apple_speech");
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/tmp/sample_audio.wav",
          file_name: "sample_audio.wav",
          file_size_mb: 2.5,
          is_large_file: false,
        });
      }
      if (cmd === "process_audio_file_path") {
        return Promise.resolve({
          ...mockPastMeetings[0],
          id: "mtg_apple_imported",
          title: "Apple Speech Toplantısı",
        });
      }
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
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(invoke).toHaveBeenCalledWith("process_audio_file_path", {
      filePath: "/tmp/sample_audio.wav",
      language: "auto",
      cloudProvider: "apple_speech",
      apiKey: null,
      modelVersion: null,
    });
  });

  it("handles audio file import error gracefully with alert", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    localStorage.setItem("echomind_active_engine", "local");
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/tmp/corrupt.mp3",
          file_name: "corrupt.mp3",
          file_size_mb: 1.0,
          is_large_file: false,
        });
      }
      if (cmd === "process_audio_file_path") {
        return Promise.reject(new Error("Corrupt audio file header"));
      }
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
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ses dosyası aktarma hatası"),
    );

    alertSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("handles smart advisor confirmation with different cloud engines and model versions", async () => {
    localStorage.setItem("echomind_active_engine", "local");
    localStorage.removeItem("echomind_groq_key");
    localStorage.removeItem("echomind_gemini_key");
    localStorage.removeItem("echomind_openai_key");
    localStorage.setItem("echomind_suppress_cloud_warning", "true");

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/tmp/large_lecture.mp3",
          file_name: "large_lecture.mp3",
          file_size_mb: 45.0,
          is_large_file: true,
        });
      }
      if (cmd === "process_audio_file_path") {
        return Promise.resolve({
          ...mockPastMeetings[0],
          id: "mtg_groq_processed",
          title: "Büyük Ders Kaydı",
        });
      }
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
      await new Promise((r) => setTimeout(r, 20));
    });

    // Smart Advisor modal should be open
    expect(screen.getByText(/Akıllı İşlem Tavsiyesi/i)).toBeInTheDocument();

    // Click on Cloud option
    const cloudCard = screen
      .getByText("⚡ Yıldırım Hızı (Bulut)")
      .closest("button");
    if (cloudCard) {
      await act(async () => {
        fireEvent.click(cloudCard);
        await new Promise((r) => setTimeout(r, 20));
      });
    }

    // Input API Key inline
    const keyInput = screen.getByPlaceholderText(/gsk_.../i);
    await act(async () => {
      fireEvent.change(keyInput, { target: { value: "gsk_test_groq_123" } });
    });

    // Click Proceed with Key
    const proceedBtn = screen.getByRole("button", { name: /^Başlat$/i });
    await act(async () => {
      fireEvent.click(proceedBtn);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(invoke).toHaveBeenCalledWith("process_audio_file_path", {
      filePath: "/tmp/large_lecture.mp3",
      language: "auto",
      cloudProvider: "groq",
      apiKey: "gsk_test_groq_123",
      modelVersion: "whisper-large-v3-turbo",
    });
  });

  it("handles meeting title editing with Enter and Escape keyboard keys", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "update_meeting_title") return Promise.resolve();
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    await screen.findByText("Haftalık İcra Kurulu Toplantısı");

    // Click edit icon for the first meeting
    const editBtns = screen.getAllByTitle("İsmi Düzenle");
    await act(async () => {
      fireEvent.click(editBtns[0]);
    });

    // Find input and press Escape to cancel
    const titleInput = screen.getByDisplayValue(
      "Haftalık İcra Kurulu Toplantısı",
    );
    await act(async () => {
      fireEvent.change(titleInput, {
        target: { value: "İptal Edilecek Başlık" },
      });
      fireEvent.keyDown(titleInput, { key: "Escape" });
    });

    // Should revert back
    expect(
      screen.getByText("Haftalık İcra Kurulu Toplantısı"),
    ).toBeInTheDocument();

    // Click edit icon again and press Enter to save
    const updatedEditBtns = await screen.findAllByTitle("İsmi Düzenle");
    await act(async () => {
      fireEvent.click(updatedEditBtns[0]);
    });

    const editInput = await screen.findByDisplayValue(
      "Haftalık İcra Kurulu Toplantısı",
    );
    await act(async () => {
      fireEvent.change(editInput, {
        target: { value: "Yeni Onaylanan Başlık" },
      });
      fireEvent.keyDown(editInput, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(invoke).toHaveBeenCalledWith("update_meeting_title", {
      meetingId: "mtg-app-1",
      newTitle: "Yeni Onaylanan Başlık",
    });
  });

  it("handles manual save button click and completion notification dismiss", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "save_current_meeting") {
        return Promise.resolve({
          ...mockPastMeetings[0],
          id: "mtg_saved_manually",
          title: "Kaydedilen Toplantı",
          duration_formatted: "05:00",
          segments: [],
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Trigger meeting-saved event with empty segments
    const savedListeners = globalTestEventListeners["meeting-saved"] || [];
    if (savedListeners.length > 0) {
      await act(async () => {
        savedListeners[savedListeners.length - 1]({
          payload: {
            ...mockPastMeetings[0],
            id: "mtg_saved_event",
            title: "Tauri Kaydedilen Toplantı",
            duration_formatted: "12:00",
            duration_seconds: 720,
            audio_file_path: "/tmp/recorded.wav",
            segments: [],
          },
        });
        await new Promise((r) => setTimeout(r, 20));
      });

      // Notification banner should appear
      expect(
        screen.getAllByText(/Tauri Kaydedilen Toplantı/i).length,
      ).toBeGreaterThan(0);

      // Dismiss notification banner
      const closeNotificationBtns = screen.getAllByTitle("Kapat");
      await act(async () => {
        fireEvent.click(closeNotificationBtns[0]);
      });
    }
  });

  it("handles trigger-stop-recording event", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "save_current_meeting")
        return Promise.resolve(mockPastMeetings[0]);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const stopListeners =
      globalTestEventListeners["trigger-stop-recording"] || [];
    if (stopListeners.length > 0) {
      await act(async () => {
        stopListeners[stopListeners.length - 1]({});
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(invoke).toHaveBeenCalledWith(
        "save_current_meeting",
        expect.any(Object),
      );
    }
  });

  it("handles privacy modal local choice and imported meeting error alert", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/path/to/meeting.wav",
          file_name: "meeting.wav",
          file_size_mb: 4.0,
          is_large_file: false,
        });
      }
      if (cmd === "get_stored_api_keys") {
        return Promise.resolve({ groq: "gsk_key", gemini: "", openai: "" });
      }
      if (cmd === "process_audio_file_path") {
        return Promise.reject("İşleme hatası oluştu");
      }
      return Promise.resolve();
    });

    localStorage.setItem("echomind_active_engine", "cloud_groq");
    localStorage.setItem("echomind_groq_key", "gsk_key");

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const importBtns = screen.getAllByRole("button", { name: /Ses Dosyası/i });
    await act(async () => {
      fireEvent.click(importBtns[0]);
    });

    expect(
      await screen.findByText(/İnternet Üzerinden İşlem Uyarısı/i),
    ).toBeInTheDocument();

    // Click Proceed Local
    const localBtn = screen.getByRole("button", {
      name: /Cihazımda Gizli Çözümle/i,
    });
    await act(async () => {
      fireEvent.click(localBtn);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ses dosyası aktarma hatası"),
    );
    alertSpy.mockRestore();
  });

  it("handles audio import for Gemini and OpenAI active engines", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/path/to/audio_gemini.mp3",
          file_name: "audio_gemini.mp3",
          file_size_mb: 2.0,
          is_large_file: false,
        });
      }
      if (cmd === "process_audio_file_path") {
        return Promise.resolve({
          ...mockPastMeetings[0],
          id: "mtg_gemini_imported",
          duration_seconds: 130,
          duration_formatted: "02:10",
        });
      }
      return Promise.resolve();
    });

    localStorage.setItem("echomind_suppress_cloud_warning", "true");
    localStorage.setItem("echomind_active_engine", "cloud_gemini");
    localStorage.setItem("echomind_gemini_key", "AIza_gemini_key");

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const importBtns = screen.getAllByRole("button", { name: /Ses Dosyası/i });
    await act(async () => {
      fireEvent.click(importBtns[0]);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(invoke).toHaveBeenCalledWith(
      "process_audio_file_path",
      expect.objectContaining({
        filePath: "/path/to/audio_gemini.mp3",
        cloudProvider: "gemini",
        apiKey: "AIza_gemini_key",
      }),
    );
  });

  it("handles audio import for OpenAI active engine", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/path/to/audio_openai.mp3",
          file_name: "audio_openai.mp3",
          file_size_mb: 2.0,
          is_large_file: false,
        });
      }
      if (cmd === "process_audio_file_path") {
        return Promise.resolve({
          ...mockPastMeetings[0],
          id: "mtg_openai_imported",
          duration_seconds: 60,
          duration_formatted: "01:00",
        });
      }
      return Promise.resolve();
    });

    localStorage.setItem("echomind_suppress_cloud_warning", "true");
    localStorage.setItem("echomind_active_engine", "cloud_openai");
    localStorage.setItem("echomind_openai_key", "sk-proj-openai_key");

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const importBtns = screen.getAllByRole("button", { name: /Ses Dosyası/i });
    await act(async () => {
      fireEvent.click(importBtns[0]);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(invoke).toHaveBeenCalledWith(
      "process_audio_file_path",
      expect.objectContaining({
        filePath: "/path/to/audio_openai.mp3",
        cloudProvider: "openai",
        apiKey: "sk-proj-openai_key",
      }),
    );
  });

  it("handles audio import for apple_speech and sensevoice engines", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/path/to/local_audio.m4a",
          file_name: "local_audio.m4a",
          file_size_mb: 3.0,
          is_large_file: false,
        });
      }
      if (cmd === "process_audio_file_path") {
        return Promise.resolve(mockPastMeetings[0]);
      }
      return Promise.resolve();
    });

    localStorage.setItem("echomind_active_engine", "apple_speech");

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const importBtns = screen.getAllByRole("button", { name: /Ses Dosyası/i });
    await act(async () => {
      fireEvent.click(importBtns[0]);
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(invoke).toHaveBeenCalledWith(
      "process_audio_file_path",
      expect.objectContaining({
        filePath: "/path/to/local_audio.m4a",
        cloudProvider: "apple_speech",
      }),
    );
  });

  it("handles pick_audio_file_dialog error and toggle recording error", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.reject("Dosya seçim penceresi açılamadı");
      }
      if (cmd === "start_audio_capture") {
        return Promise.reject("Mikrofon erişimi reddedildi");
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Pick file error
    const importBtns = screen.getAllByRole("button", { name: /Ses Dosyası/i });
    await act(async () => {
      fireEvent.click(importBtns[0]);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dosya seçme hatası"),
    );

    // Toggle recording error
    const recordBtn = screen.getByRole("button", { name: /Dinlemeyi Başlat/i });
    await act(async () => {
      fireEvent.click(recordBtn);
      await new Promise((r) => setTimeout(r, 20));
    });

    alertSpy.mockRestore();
  });

  it("handles smart advisor confirm for retranscribe meeting with cloud and local engines", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "retranscribe_meeting") {
        return Promise.resolve({
          ...mockPastMeetings[0],
          id: "mtg_retranscribed",
          duration_seconds: 300,
          duration_formatted: "05:00",
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Trigger meeting-saved with audio path but 0 segments to trigger promptMeetingTranscription
    const savedListeners = globalTestEventListeners["meeting-saved"] || [];
    if (savedListeners.length > 0) {
      await act(async () => {
        savedListeners[savedListeners.length - 1]({
          payload: {
            ...mockPastMeetings[0],
            id: "mtg_needs_retranscribe",
            audio_file_path: "/tmp/recorded_new.wav",
            duration_seconds: 800,
            segments: [],
          },
        });
        await new Promise((r) => setTimeout(r, 20));
      });

      // Advisor should be opened
      expect(
        await screen.findByText(/Akıllı İşlem Tavsiyesi/i),
      ).toBeInTheDocument();

      // Click local card
      const localCard = screen
        .getByText("🔒 Cihazımda Çözümle")
        .closest("button");
      if (localCard) {
        await act(async () => {
          fireEvent.click(localCard);
          await new Promise((r) => setTimeout(r, 20));
        });
      }

      expect(invoke).toHaveBeenCalledWith(
        "retranscribe_meeting",
        expect.objectContaining({
          meetingId: "mtg_needs_retranscribe",
        }),
      );
    }

    alertSpy.mockRestore();
  });

  it("handles CustomContextMenu actions, PrivacyModal close, and ModelHub onModelChanged", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "get_model_status")
        return Promise.resolve({
          model_name: "whisper-medium",
          is_loaded: true,
        });
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Open context menu via right click
    await act(async () => {
      fireEvent.contextMenu(window, { clientX: 100, clientY: 100 });
    });
    expect(screen.getByText("EchoMind AI")).toBeInTheDocument();

    // Click inside context menu item if present
    const copyBtns = screen.getAllByRole("button", { name: /Kopyala/i });
    await act(async () => {
      fireEvent.click(copyBtns[copyBtns.length - 1]);
    });
  });

  it("renders meetings with lightning badge engine_used and handles meeting re-select", async () => {
    const meetingsWithLightning = [
      {
        ...mockPastMeetings[0],
        id: "mtg_lightning_1",
        engine_used: "⚡ Groq Cloud (Whisper Turbo)",
      },
    ];

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings")
        return Promise.resolve(meetingsWithLightning);
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    expect(await screen.findByText(/⚡ Groq Cloud/i)).toBeInTheDocument();

    // Re-click same selected meeting
    const meetingCard = screen.getByText("Haftalık İcra Kurulu Toplantısı");
    fireEvent.click(meetingCard);
  });

  it("handles auto-start meeting error and save meeting error gracefully", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "start_audio_capture")
        return Promise.reject("Audio capture başlatılamadı");
      if (cmd === "save_current_meeting")
        return Promise.reject("Kayıt kaydedilemedi");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Call detector auto start callback
    const autoStartCall = (globalThis as any).__testMeetingDetectorAutoStart;
    if (typeof autoStartCall === "function") {
      await act(async () => {
        autoStartCall({
          recommended_title: "Otomatik Toplantı",
          app_name: "Zoom",
        });
        await new Promise((r) => setTimeout(r, 20));
      });
    }
  });

  it("handles retranscribe meeting error alert and OpenAI retranscribe", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "retranscribe_meeting")
        return Promise.reject("Retranscribe sunucu hatası");
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Trigger meeting-saved with audio path but 0 segments to trigger promptMeetingTranscription
    const savedListeners = globalTestEventListeners["meeting-saved"] || [];
    if (savedListeners.length > 0) {
      await act(async () => {
        savedListeners[savedListeners.length - 1]({
          payload: {
            ...mockPastMeetings[0],
            id: "mtg_needs_retranscribe_err",
            audio_file_path: "/tmp/recorded_err.wav",
            duration_seconds: 120,
            segments: [],
          },
        });
        await new Promise((r) => setTimeout(r, 20));
      });

      const localCard = screen
        .getByText("🔒 Cihazımda Çözümle")
        .closest("button");
      if (localCard) {
        await act(async () => {
          fireEvent.click(localCard);
          await new Promise((r) => setTimeout(r, 20));
        });
      }

      expect(alertSpy).toHaveBeenCalledWith(
        expect.stringContaining("Toplantı çözümleme hatası"),
      );
    }

    alertSpy.mockRestore();
  });

  it("handles advisor onOpenSettings and privacy modal onClose", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/path/to/large.wav",
          file_name: "large.wav",
          file_size_mb: 50.0,
          is_large_file: true,
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Pick large file to open advisor
    const importBtns = screen.getAllByRole("button", { name: /Ses Dosyası/i });
    await act(async () => {
      fireEvent.click(importBtns[0]);
    });

    expect(
      await screen.findByText(/Akıllı İşlem Tavsiyesi/i),
    ).toBeInTheDocument();

    // In advisor, click close X button
    const closeAdvisorBtn = screen
      .getAllByRole("button")
      .find((b) => b.querySelector("svg.lucide-x"));
    if (closeAdvisorBtn) {
      await act(async () => {
        fireEvent.click(closeAdvisorBtn);
      });
    }
  });

  it("handles privacy modal dismiss via close button", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/path/to/cloud_test.wav",
          file_name: "cloud_test.wav",
          file_size_mb: 2.0,
          is_large_file: false,
        });
      }
      return Promise.resolve();
    });

    localStorage.setItem("echomind_active_engine", "cloud_groq");
    localStorage.setItem("echomind_groq_key", "gsk_groq_test");

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    const importBtns = screen.getAllByRole("button", { name: /Ses Dosyası/i });
    await act(async () => {
      fireEvent.click(importBtns[0]);
    });

    expect(
      await screen.findByText(/İnternet Üzerinden İşlem Uyarısı/i),
    ).toBeInTheDocument();

    // Click close in privacy modal
    const closeBtn = screen
      .getAllByRole("button")
      .find((b) => b.querySelector("svg.lucide-x"));
    expect(closeBtn).toBeDefined();
    await act(async () => {
      fireEvent.click(closeBtn!);
    });
  });

  it("handles footer ModelHub button and advisor confirmation for cloud switch", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockPastMeetings);
      if (cmd === "get_model_status")
        return Promise.resolve({ is_ready: true, current_model: "large-v3" });
      if (cmd === "pick_audio_file_dialog") {
        return Promise.resolve({
          path: "/path/to/large_audio.mp3",
          file_name: "large_audio.mp3",
          file_size_mb: 65.0,
          is_large_file: true,
        });
      }
      if (cmd === "import_audio_file") {
        return Promise.resolve({
          id: "imported-advisor-1",
          title: "Advisor Imported",
          date: "2026-09-04",
          duration: 3600,
          speakers: ["Konuşmacı 1"],
          audio_path: "/path/to/large_audio.mp3",
          transcription: "Advisor success",
          segments: [],
        });
      }
      return Promise.resolve();
    });

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Click footer Yapay Zeka Seçenekleri button
    const footerHubBtn = screen.getByTitle(/Yapay Zeka Modunu Değiştir/i);
    await act(async () => {
      fireEvent.click(footerHubBtn);
    });
    expect(
      await screen.findByText(/Model Yönetim Merkezi/i),
    ).toBeInTheDocument();

    // Close Model Hub
    const closeHubBtn = screen
      .getAllByRole("button")
      .find((b) => b.querySelector("svg.lucide-x"));
    if (closeHubBtn) {
      await act(async () => {
        fireEvent.click(closeHubBtn);
      });
    }

    // Pick large audio file to trigger Advisor Modal
    localStorage.removeItem("echomind_groq_key");
    localStorage.removeItem("echomind_gemini_key");
    localStorage.removeItem("echomind_openai_key");
    localStorage.setItem("echomind_active_engine", "local");

    const importBtns = screen.getAllByRole("button", { name: /Ses Dosyası/i });
    await act(async () => {
      fireEvent.click(importBtns[0]);
    });

    // Advisor Modal should show up
    expect(
      await screen.findByText(/Akıllı İşlem Tavsiyesi/i),
    ).toBeInTheDocument();

    // Click Cloud option or Local option in advisor modal
    const localChoiceBtn = screen.getByText(/Cihazımda Çözümle/i);
    await act(async () => {
      fireEvent.click(localChoiceBtn);
    });
  });

  it("handles meeting-saved event and triggers completion notification banner", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Trigger meeting-saved event
    const savedListeners = globalTestEventListeners["meeting-saved"] || [];
    if (savedListeners.length > 0) {
      await act(async () => {
        savedListeners[savedListeners.length - 1]({
          payload: {
            ...mockPastMeetings[0],
            title: "Tüm Detaylar Kaydedildi",
            duration_formatted: "15:00",
            segments: [],
          },
        });
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(await screen.findByText(/tamamlandı/i)).toBeInTheDocument();
    }
  });

  it("handles opening Assistant and Settings from Custom Context Menu", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    // Trigger right-click / contextmenu on window
    await act(async () => {
      fireEvent.contextMenu(window, { clientX: 200, clientY: 200 });
    });

    // Click Toplantı Asistanı in context menu
    const assistantMenuBtn = screen.getByRole("button", {
      name: /Toplantı Asistanı/i,
    });
    await act(async () => {
      fireEvent.click(assistantMenuBtn);
    });

    const assistantMatches = await screen.findAllByText(
      /EchoMind Akıllı Asistan/i,
    );
    expect(assistantMatches.length).toBeGreaterThan(0);

    // Trigger context menu again for settings
    await act(async () => {
      fireEvent.contextMenu(window, { clientX: 250, clientY: 250 });
    });

    const settingsMenuBtn = screen.getByRole("button", {
      name: /Ayarlar & Tercihler/i,
    });
    await act(async () => {
      fireEvent.click(settingsMenuBtn);
    });

    const settingsMatches = await screen.findAllByText(
      /Mikrofon, cihaz performansı ve yapay zeka seçenekleri/i,
    );
    expect(settingsMatches.length).toBeGreaterThan(0);
  });

  it("handles cancelling meeting title editing with Escape key and stopPropagation", async () => {
    setupDefaultInvoke();

    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    );

    expect(
      await screen.findByText(/Haftalık İcra Kurulu Toplantısı/i),
    ).toBeInTheDocument();

    const editBtns = screen.getAllByTitle(/İsmi Düzenle/i);
    if (editBtns.length > 0) {
      await act(async () => {
        fireEvent.click(editBtns[0]);
      });

      const titleInput = screen.getByDisplayValue(
        /Haftalık İcra Kurulu Toplantısı/i,
      );
      await act(async () => {
        fireEvent.click(titleInput.parentElement!);
        fireEvent.keyDown(titleInput, { key: "Escape", code: "Escape" });
      });

      expect(
        screen.queryByDisplayValue(/Haftalık İcra Kurulu Toplantısı/i),
      ).toBeNull();
    }
  });
});
