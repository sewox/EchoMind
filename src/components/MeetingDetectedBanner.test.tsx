import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MeetingDetectedBanner } from "./MeetingDetectedBanner";
import { I18nProvider } from "../locales/i18nContext";
import { MeetingAppInfo } from "../hooks/useMeetingDetector";

describe("MeetingDetectedBanner Component", () => {
  const mockApp: MeetingAppInfo = {
    app_id: "teams",
    display_name: "Microsoft Teams",
    process_name: "teams.exe",
    is_running: true,
    recommended_title: "Microsoft Teams Toplantısı - 02 Eylül 2026",
  };

  const defaultProps = {
    appInfo: mockApp,
    onStart: vi.fn(),
    onAlwaysAutoStart: vi.fn(),
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    // Mock Web Audio API
    window.AudioContext = vi.fn().mockImplementation(() => ({
      currentTime: 0,
      destination: {},
      createOscillator: () => ({
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createGain: () => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      }),
    })) as unknown as typeof AudioContext;
  });

  it("renders detected app details and handles start button click", () => {
    render(
      <I18nProvider>
        <MeetingDetectedBanner {...defaultProps} />
      </I18nProvider>,
    );

    expect(screen.getByText("Microsoft Teams")).toBeInTheDocument();
    expect(screen.getByText("Aktif Toplantı")).toBeInTheDocument();

    const startBtn = screen.getByRole("button", { name: /Dinlemeyi Başlat/i });
    fireEvent.click(startBtn);
    expect(defaultProps.onStart).toHaveBeenCalledWith(mockApp);
  });

  it("handles always auto-start button click", () => {
    render(
      <I18nProvider>
        <MeetingDetectedBanner {...defaultProps} />
      </I18nProvider>,
    );

    const autoStartBtn = screen.getByRole("button", {
      name: /Her Zaman Otomatik Başlat/i,
    });
    fireEvent.click(autoStartBtn);
    expect(defaultProps.onAlwaysAutoStart).toHaveBeenCalledWith(mockApp);
  });

  it("handles dismiss button click", () => {
    render(
      <I18nProvider>
        <MeetingDetectedBanner {...defaultProps} />
      </I18nProvider>,
    );

    const dismissBtn = screen.getByTitle(/Yoksay/i);
    fireEvent.click(dismissBtn);
    expect(defaultProps.onDismiss).toHaveBeenCalledWith(mockApp.app_id);
  });

  it("renders various meeting app icons correctly", () => {
    const apps = ["zoom", "meet", "webex", "discord", "slack", "other"];
    for (const app_id of apps) {
      const { unmount } = render(
        <I18nProvider>
          <MeetingDetectedBanner
            {...defaultProps}
            appInfo={{ ...mockApp, app_id, display_name: `${app_id} App` }}
          />
        </I18nProvider>,
      );
      expect(screen.getByText(`${app_id} App`)).toBeInTheDocument();
      unmount();
    }
  });

  it("handles webkitAudioContext fallback and missing AudioContext gracefully", () => {
    // Test webkitAudioContext
    delete (window as any).AudioContext;
    (window as any).webkitAudioContext = vi.fn().mockImplementation(() => ({
      currentTime: 0,
      destination: {},
      createOscillator: () => ({
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createGain: () => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      }),
    }));

    const { unmount } = render(
      <I18nProvider>
        <MeetingDetectedBanner {...defaultProps} />
      </I18nProvider>,
    );
    unmount();

    // Test completely missing AudioContext
    delete (window as any).webkitAudioContext;
    render(
      <I18nProvider>
        <MeetingDetectedBanner {...defaultProps} />
      </I18nProvider>,
    );
  });
});
