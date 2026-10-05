import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Cpu, Mic, Settings } from "lucide-react";
import { ModalShell, stripLeadingEmoji } from "./ModalShell";

describe("ModalShell", () => {
  it("renders the header, body and footer", () => {
    render(
      <ModalShell
        onClose={vi.fn()}
        icon={Settings}
        title="Ayarlar"
        subtitle="Tercihler"
        badge={<span>Yeni</span>}
        footer={<button>Tamam</button>}
        testId="shell"
      >
        <p>İçerik</p>
      </ModalShell>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("data-testid", "shell");
    expect(screen.getByText("Ayarlar")).toBeInTheDocument();
    expect(screen.getByText("Tercihler")).toBeInTheDocument();
    expect(screen.getByText("Yeni")).toBeInTheDocument();
    expect(screen.getByText("İçerik")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tamam" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("closes from the close button and the backdrop, not from the window", () => {
    const onClose = vi.fn();
    render(
      <ModalShell onClose={onClose} icon={Settings} title="T" testId="shell">
        <p>İçerik</p>
      </ModalShell>,
    );
    fireEvent.click(screen.getByText("İçerik"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("shell-close-btn"));
    fireEvent.click(screen.getByTestId("shell-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("stays open while closing is disabled or the backdrop is inert", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ModalShell
        onClose={onClose}
        icon={Settings}
        title="T"
        testId="shell"
        closeDisabled
      >
        <p />
      </ModalShell>,
    );
    expect(screen.getByTestId("shell-close-btn")).toBeDisabled();
    fireEvent.click(screen.getByTestId("shell-backdrop"));
    rerender(
      <ModalShell
        onClose={onClose}
        icon={Settings}
        title="T"
        testId="shell"
        closeOnBackdrop={false}
      >
        <p />
      </ModalShell>,
    );
    fireEvent.click(screen.getByTestId("shell-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows tabs in one row without emoji or trailing ellipsis", () => {
    const onTabChange = vi.fn();
    render(
      <ModalShell
        onClose={vi.fn()}
        icon={Settings}
        title="T"
        tone="danger"
        size="xl"
        height="fixed"
        scrollBody={false}
        tabs={[
          { id: "audio", label: "🎙️ Ses", icon: Mic },
          {
            id: "system",
            label: "Ara...",
            icon: Cpu,
            badge: <span>kilit</span>,
          },
        ]}
        activeTab="audio"
        onTabChange={onTabChange}
      >
        <p />
      </ModalShell>,
    );
    const tabs = screen.getAllByRole("tab");
    expect(screen.getByRole("tablist")).toHaveClass("grid-cols-2");
    expect(tabs[0]).toHaveTextContent(/^Ses$/);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveTextContent(/^Arakilit$/);
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    fireEvent.click(tabs[1]);
    expect(onTabChange).toHaveBeenCalledWith("system");
  });

  it("falls back to equal columns for many tabs", () => {
    const tabs = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      label: `Sekme ${i}`,
      icon: Mic,
    }));
    render(
      <ModalShell onClose={vi.fn()} icon={Settings} title="T" tabs={tabs}>
        <p />
      </ModalShell>,
    );
    expect(screen.getByRole("tablist")).toHaveClass("grid-flow-col");
    fireEvent.click(screen.getAllByRole("tab")[2]);
  });
});

describe("stripLeadingEmoji", () => {
  it("removes leading emoji and keeps plain labels", () => {
    expect(stripLeadingEmoji("📧 Takip E-Postası")).toBe("Takip E-Postası");
    expect(stripLeadingEmoji("⚡️ Hızlı")).toBe("Hızlı");
    expect(stripLeadingEmoji("Arayüz Dili")).toBe("Arayüz Dili");
  });
});
