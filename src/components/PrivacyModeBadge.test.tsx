import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrivacyModeBadge } from "./PrivacyModeBadge";
import { I18nProvider } from "../locales/i18nContext";

describe("PrivacyModeBadge Component", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  const renderBadge = (compact = false) => {
    return render(
      <I18nProvider>
        <PrivacyModeBadge compact={compact} />
      </I18nProvider>,
    );
  };

  it("renders with default balanced mode and toggles dropdown on click", () => {
    renderBadge();
    const btn = screen.getByTestId("privacy-mode-badge-button");
    expect(btn).toBeInTheDocument();
    expect(screen.getByText(/Dengeli Mod/i)).toBeInTheDocument();

    expect(
      screen.queryByTestId("privacy-mode-dropdown"),
    ).not.toBeInTheDocument();

    // Click to open dropdown
    fireEvent.click(btn);
    expect(screen.getByTestId("privacy-mode-dropdown")).toBeInTheDocument();
    expect(screen.getByText(/Sıfır Bulut/i)).toBeInTheDocument();
  });

  it("switches to paranoid mode on selection", () => {
    renderBadge();
    const btn = screen.getByTestId("privacy-mode-badge-button");
    fireEvent.click(btn);

    const paranoidOption = screen.getByTestId("privacy-option-paranoid");
    fireEvent.click(paranoidOption);

    expect(localStorage.getItem("echomind_privacy_mode")).toBe("paranoid");
    expect(screen.getByText(/Paranoid Mod/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId("privacy-mode-dropdown"),
    ).not.toBeInTheDocument();
  });

  it("switches to max intelligence mode on selection", () => {
    renderBadge();
    const btn = screen.getByTestId("privacy-mode-badge-button");
    fireEvent.click(btn);

    const maxOption = screen.getByTestId("privacy-option-max-intelligence");
    fireEvent.click(maxOption);

    expect(localStorage.getItem("echomind_privacy_mode")).toBe(
      "max_intelligence",
    );
    expect(screen.getByText(/Maksimum Zeka/i)).toBeInTheDocument();
  });

  it("switches to balanced mode on selection", () => {
    localStorage.setItem("echomind_privacy_mode", "paranoid");
    renderBadge();
    const btn = screen.getByTestId("privacy-mode-badge-button");
    fireEvent.click(btn);

    const balancedOption = screen.getByTestId("privacy-option-balanced");
    fireEvent.click(balancedOption);

    expect(localStorage.getItem("echomind_privacy_mode")).toBe("balanced");
    expect(screen.getByText(/Dengeli Mod/i)).toBeInTheDocument();
  });

  it("closes dropdown on outside click", () => {
    renderBadge();
    const btn = screen.getByTestId("privacy-mode-badge-button");
    fireEvent.click(btn);
    expect(screen.getByTestId("privacy-mode-dropdown")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(
      screen.queryByTestId("privacy-mode-dropdown"),
    ).not.toBeInTheDocument();
  });

  it("keeps the dropdown open when mousing down inside it", () => {
    renderBadge();
    const btn = screen.getByTestId("privacy-mode-badge-button");
    fireEvent.click(btn);
    const dropdown = screen.getByTestId("privacy-mode-dropdown");

    fireEvent.mouseDown(dropdown);
    expect(screen.getByTestId("privacy-mode-dropdown")).toBeInTheDocument();
  });

  it("renders in compact mode properly", () => {
    renderBadge(true);
    const btn = screen.getByTestId("privacy-mode-badge-button");
    expect(btn.className).toContain("text-[10px]");
  });

  it("renders when initialized in paranoid mode", () => {
    localStorage.setItem("echomind_privacy_mode", "paranoid");
    renderBadge();
    expect(screen.getByText(/Paranoid Mod/i)).toBeInTheDocument();
  });

  it("renders when initialized in max intelligence mode", () => {
    localStorage.setItem("echomind_privacy_mode", "max_intelligence");
    renderBadge();
    expect(screen.getByText(/Maksimum Zeka/i)).toBeInTheDocument();
  });

  it("marks the max intelligence option as selected when that mode is already active", () => {
    localStorage.setItem("echomind_privacy_mode", "max_intelligence");
    renderBadge();
    const btn = screen.getByTestId("privacy-mode-badge-button");
    fireEvent.click(btn);

    const maxOption = screen.getByTestId("privacy-option-max-intelligence");
    expect(maxOption.className).toContain("bg-cyan-950/70");
    // Selected option renders both the Zap icon and the trailing Check icon.
    expect(maxOption.querySelectorAll("svg").length).toBe(2);
  });
});
