import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CustomContextMenu } from "./CustomContextMenu";
import { I18nProvider } from "../locales/i18nContext";

describe("CustomContextMenu Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    onOpenAssistant: vi.fn(),
    onOpenSettings: vi.fn(),
  };

  it("opens on contextmenu event, handles position clamping, and triggers actions", async () => {
    document.execCommand = vi.fn();
    window.getSelection = vi.fn().mockReturnValue({
      toString: () => "Örnek seçili metin",
    });

    // Mock window dimensions for edge clamping test
    Object.defineProperty(window, "innerWidth", {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 400,
      configurable: true,
    });

    render(
      <I18nProvider>
        <CustomContextMenu {...defaultProps} />
      </I18nProvider>,
    );

    // Right click near bottom right edge (450, 350)
    await act(async () => {
      fireEvent.contextMenu(window, { clientX: 450, clientY: 350 });
    });

    expect(screen.getByText("EchoMind AI")).toBeInTheDocument();

    // 1. Click Copy
    const copyBtn = screen.getByRole("button", { name: /Kopyala/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "Örnek seçili metin",
    );

    // Right click again to test Select All
    await act(async () => {
      fireEvent.contextMenu(window, { clientX: 100, clientY: 100 });
    });

    const selectAllBtn = screen.getByRole("button", { name: /Tümünü Seç/i });
    await act(async () => {
      fireEvent.click(selectAllBtn);
    });
    expect(document.execCommand).toHaveBeenCalledWith("selectAll", false);

    // Right click again to test Assistant trigger
    await act(async () => {
      fireEvent.contextMenu(window, { clientX: 100, clientY: 100 });
    });

    const assistantBtn = screen.getByRole("button", {
      name: /Toplantı Asistanı/i,
    });
    await act(async () => {
      fireEvent.click(assistantBtn);
    });
    expect(defaultProps.onOpenAssistant).toHaveBeenCalled();

    // Right click again to test Settings trigger
    await act(async () => {
      fireEvent.contextMenu(window, { clientX: 100, clientY: 100 });
    });

    const settingsBtn = screen.getByRole("button", {
      name: /Ayarlar & Tercihler/i,
    });
    await act(async () => {
      fireEvent.click(settingsBtn);
    });
    expect(defaultProps.onOpenSettings).toHaveBeenCalled();
  });

  it("closes on Escape key and outside click", async () => {
    render(
      <I18nProvider>
        <CustomContextMenu {...defaultProps} />
      </I18nProvider>,
    );

    // Open menu
    await act(async () => {
      fireEvent.contextMenu(window, { clientX: 100, clientY: 100 });
    });
    expect(screen.getByText("EchoMind AI")).toBeInTheDocument();

    // Press Escape
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByText("EchoMind AI")).toBeNull();

    // Open menu again and click outside
    await act(async () => {
      fireEvent.contextMenu(window, { clientX: 100, clientY: 100 });
    });
    expect(screen.getByText("EchoMind AI")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(document.body);
    });
    expect(screen.queryByText("EchoMind AI")).toBeNull();
  });
});
