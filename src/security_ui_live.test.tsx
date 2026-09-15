import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsModal } from "./components/SettingsModal";
import TranscriptViewer from "./components/TranscriptViewer";
import { I18nProvider } from "./locales/i18nContext";
import { redactSensitiveData } from "./services/dlpService";
import { MeetingRecord } from "./App";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: any) => {
    if (cmd === "get_secure_credential") {
      return "gsk_mock_secret_vault_token_123456";
    }
    if (cmd === "save_secure_credential") {
      return undefined;
    }
    if (cmd === "redact_sensitive_text") {
      return redactSensitiveData(args.text);
    }
    return undefined;
  }),
}));

describe("Live UI Security & Adversarial Injection Suite", () => {
  it("1. Credential Vault: Password masking & no plaintext secrets exposed in DOM attributes", async () => {
    const onClose = vi.fn();
    const mockHardware = {
      cpu_name: "Apple M3 Pro",
      cpu_cores: 12,
      total_ram_gb: 18,
      gpu_name: "Apple Metal GPU",
      neural_engine: true,
      performance_tier: "Ultra",
      recommended_model: "large-v3-turbo",
      is_battery_power: false,
    };

    const mockModelStatus = {
      loaded_model: "large-v3-turbo",
      active_provider: "Local",
      device_used: "Metal",
      memory_usage_mb: 512,
      is_streaming: false,
    };

    render(
      <I18nProvider>
        <SettingsModal
          isOpen={true}
          onClose={onClose}
          hardware={mockHardware as any}
          modelStatus={mockModelStatus as any}
        />
      </I18nProvider>,
    );

    // Click on API Keys tab
    const apiTabBtn = screen.getByRole("button", {
      name: /Yapay Zeka Servisleri/i,
    });
    fireEvent.click(apiTabBtn);

    // API Key inputs should be of type "password"
    const passwordInputs = screen.getAllByPlaceholderText(/gsk_|sk-|AIzaSy/i);
    expect(passwordInputs.length).toBeGreaterThan(0);

    passwordInputs.forEach((input) => {
      expect(input.getAttribute("type")).toBe("password");
      expect(input.getAttribute("autocomplete")).toBe("off");
    });
  });

  it("2. Stored XSS in TranscriptViewer: script tags and malicious attributes rendered safely as text", () => {
    const maliciousMeeting: MeetingRecord = {
      id: "sec_test_001",
      title: '<script>alert("XSS-Title")</script>',
      date_formatted: "14.09.2026",
      duration_seconds: 120,
      duration_formatted: "02:00",
      summary: '<img src=x onerror="alert(1)"> Yönetici Özeti',
      key_decisions: ["<svg onload=alert(1)> Karar 1"],
      meeting_goal: '<iframe src="javascript:alert(1)"> Hedef',
      key_highlights: ["<body onload=alert(1)> Çıkarım 1"],
      action_items: [
        {
          task: '<a href="javascript:alert(1)">Zararlı Aksiyon</a>',
          assignee: "Hacker",
          source_citations: [1],
          is_completed: false,
        },
      ],
      detailed_topics: [],
      participants: ["<script>alert(1)</script>"],
      segments: [
        {
          id: 1,
          speaker_id: "spk_0",
          speaker_name: '<script>alert("Hacker")</script>',
          text: "<img src=x onerror=alert(document.cookie)> Konuşma metni ve kredi kartı: 4532 0151 1283 0366",
          timestamp_formatted: "00:00 - 00:05",
          start_time_ms: 0,
          end_time_ms: 5000,
          language: "tr",
          confidence: 0.99,
        },
      ],
    };

    const { container } = render(
      <I18nProvider>
        <TranscriptViewer
          isRecording={false}
          isSpeaking={false}
          selectedLanguage="tr"
          onLanguageChange={vi.fn()}
          selectedPastMeeting={maliciousMeeting as any}
        />
      </I18nProvider>,
    );

    // 1. Verify that NO executable <script>, <img>, <iframe> with onerror were created as active DOM nodes
    const scripts = container.querySelectorAll("script");
    expect(scripts.length).toBe(0);

    const maliciousImgs = container.querySelectorAll("img[onerror]");
    expect(maliciousImgs.length).toBe(0);

    const iframes = container.querySelectorAll("iframe");
    expect(iframes.length).toBe(0);

    // 2. Verify text is safely escaped and displayed as plain text content, not executable DOM
    expect(container.textContent).toContain('<script>alert("Hacker")</script>');
    expect(container.textContent).toContain(
      "<img src=x onerror=alert(document.cookie)>",
    );
  });

  it("3. DLP Live Redaction in User Input & Feed", () => {
    const rawUserInput =
      "Toplantı notu: CEO kartı 4532 0151 1283 0366 ve TCKN 10000000146, API: sk-proj-1234567890abcdef1234567890abcdef";
    const sanitized = redactSensitiveData(rawUserInput);

    expect(sanitized).not.toContain("4532 0151 1283 0366");
    expect(sanitized).not.toContain("10000000146");
    expect(sanitized).not.toContain("sk-proj-1234567890abcdef1234567890abcdef");
    expect(sanitized).toContain("[REDACTED: CREDIT_CARD]");
    expect(sanitized).toContain("[REDACTED: TCKN]");
    expect(sanitized).toContain("[REDACTED: API_KEY]");
  });
});
