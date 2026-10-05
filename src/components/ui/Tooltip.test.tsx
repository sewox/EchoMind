import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  afterEach(() => vi.useRealTimers());

  it("shows the name and purpose after a short hover", () => {
    vi.useFakeTimers();
    render(
      <Tooltip title="Analitik" description="Kim ne kadar konuştu">
        <button>A</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "A" });
    fireEvent.mouseEnter(button.parentElement!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Analitik");
    expect(tip).toHaveTextContent("Kim ne kadar konuştu");
    expect(button).toHaveAttribute("aria-describedby", tip.id);
    fireEvent.mouseLeave(button.parentElement!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on keyboard focus, closes on Escape and blur, and keeps the trigger's handlers", () => {
    vi.useFakeTimers();
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(
      <Tooltip title="Dışa Aktar" align="end">
        <button onFocus={onFocus} onBlur={onBlur}>
          E
        </button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "E" });
    fireEvent.focus(button);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Dışa Aktar");
    expect(onFocus).toHaveBeenCalled();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(button);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    fireEvent.keyDown(button, { key: "Tab" });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(button);
    expect(onBlur).toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("works with triggers that have no focus handlers and aligns to the start edge", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <Tooltip title="Kopyala" align="start">
        <button>C</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "C" });
    fireEvent.focus(button);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole("tooltip").className).toContain("left-0");
    fireEvent.blur(button);
    fireEvent.mouseEnter(button.parentElement!);
    unmount();
  });
});
