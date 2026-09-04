import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EchoMindLogo } from "./EchoMindLogo";
import { CloudPrivacyConfirmModal } from "./CloudPrivacyConfirmModal";
import { I18nProvider } from "../locales/i18nContext";

describe("EchoMindLogo Component", () => {
  it("renders logo with responsive image and brand title", () => {
    const { container } = render(<EchoMindLogo showTagline={true} />);
    expect(container.querySelector("img")).toBeInTheDocument();
    expect(screen.getByText("EchoMind")).toBeInTheDocument();
    expect(screen.getByText("Serene Offline Assistant")).toBeInTheDocument();
  });
});

describe("CloudPrivacyConfirmModal Component", () => {
  const defaultProps = {
    isOpen: true,
    providerName: "Google Gemini 2.0 Flash",
    onConfirmCloud: vi.fn(),
    onSwitchToLocal: vi.fn(),
    onClose: vi.fn(),
  };

  it("renders modal details and handles confirm and local switch", () => {
    render(
      <I18nProvider>
        <CloudPrivacyConfirmModal {...defaultProps} />
      </I18nProvider>,
    );

    expect(
      screen.getByText(/İnternet Üzerinden İşlem Uyarısı/i),
    ).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", {
      name: /Bulut ile Hızlıca Çözümle/i,
    });
    fireEvent.click(confirmBtn);
    expect(defaultProps.onConfirmCloud).toHaveBeenCalled();

    const localBtn = screen.getByRole("button", {
      name: /Cihazımda Gizli Çözümle/i,
    });
    fireEvent.click(localBtn);
    expect(defaultProps.onSwitchToLocal).toHaveBeenCalled();
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
