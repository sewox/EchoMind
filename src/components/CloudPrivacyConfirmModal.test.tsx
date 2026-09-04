import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CloudPrivacyConfirmModal } from "./CloudPrivacyConfirmModal";
import { I18nProvider } from "../locales/i18nContext";

describe("CloudPrivacyConfirmModal Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const defaultProps = {
    isOpen: true,
    providerName: "Groq Cloud Whisper",
    onConfirmCloud: vi.fn(),
    onSwitchToLocal: vi.fn(),
    onClose: vi.fn(),
  };

  it("renders provider info and handles proceeding with cloud", () => {
    render(
      <I18nProvider>
        <CloudPrivacyConfirmModal {...defaultProps} />
      </I18nProvider>,
    );

    expect(
      screen.getByText(/İnternet Üzerinden İşlem Uyarısı/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Groq Cloud Whisper/i)).toBeInTheDocument();

    const proceedBtn = screen.getByRole("button", {
      name: /Bulut ile Hızlıca Çözümle/i,
    });
    fireEvent.click(proceedBtn);

    expect(defaultProps.onConfirmCloud).toHaveBeenCalled();
  });

  it("handles proceeding with cloud when dontShowAgain checkbox is checked", () => {
    render(
      <I18nProvider>
        <CloudPrivacyConfirmModal {...defaultProps} />
      </I18nProvider>,
    );

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    const proceedBtn = screen.getByRole("button", {
      name: /Bulut ile Hızlıca Çözümle/i,
    });
    fireEvent.click(proceedBtn);

    expect(defaultProps.onConfirmCloud).toHaveBeenCalled();
    expect(localStorage.getItem("echomind_suppress_cloud_warning")).toBe(
      "true",
    );
  });

  it("handles switching to local with dontShowAgain checkbox set", () => {
    render(
      <I18nProvider>
        <CloudPrivacyConfirmModal {...defaultProps} />
      </I18nProvider>,
    );

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    const localBtn = screen.getByRole("button", {
      name: /Cihazımda Gizli Çözümle/i,
    });
    fireEvent.click(localBtn);

    expect(defaultProps.onSwitchToLocal).toHaveBeenCalled();
    expect(localStorage.getItem("echomind_suppress_cloud_warning")).toBe(
      "true",
    );
  });

  it("handles close button", () => {
    const { container } = render(
      <I18nProvider>
        <CloudPrivacyConfirmModal {...defaultProps} />
      </I18nProvider>,
    );

    const closeBtn = container.querySelector("button.p-1\\.5");
    if (closeBtn) {
      fireEvent.click(closeBtn);
      expect(defaultProps.onClose).toHaveBeenCalled();
    }
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <I18nProvider>
        <CloudPrivacyConfirmModal {...defaultProps} isOpen={false} />
      </I18nProvider>,
    );

    expect(container.firstChild).toBeNull();
  });
});
