import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FirstRunModelSetupBanner } from "./FirstRunModelSetupBanner";

describe("FirstRunModelSetupBanner", () => {
  it("renders nothing when there is no progress", () => {
    const { container } = render(
      <FirstRunModelSetupBanner progress={null} onDismiss={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows downloading state with percentage and MB", () => {
    render(
      <FirstRunModelSetupBanner
        progress={{
          model_key: "small",
          percentage: 37.5,
          downloaded_bytes: 100 * 1024 * 1024,
          total_bytes: 487 * 1024 * 1024,
          status: "downloading",
        }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/small/)).toBeInTheDocument();
    expect(screen.getByText("38%")).toBeInTheDocument();
    expect(screen.getByText(/100 \/ 487 MB/)).toBeInTheDocument();
  });

  it("shows a completed state and calls onDismiss when closed", () => {
    const onDismiss = vi.fn();
    render(
      <FirstRunModelSetupBanner
        progress={{
          model_key: "small",
          percentage: 100,
          downloaded_bytes: 500,
          total_bytes: 500,
          status: "completed",
        }}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText("Yerel model hazır")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("first-run-model-setup-dismiss"));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("auto-dismisses a few seconds after completion", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <FirstRunModelSetupBanner
        progress={{
          model_key: "small",
          percentage: 100,
          downloaded_bytes: 500,
          total_bytes: 500,
          status: "completed",
        }}
        onDismiss={onDismiss}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onDismiss).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("shows an error state with a manual-download hint", () => {
    render(
      <FirstRunModelSetupBanner
        progress={{
          model_key: "small",
          percentage: 0,
          downloaded_bytes: 0,
          total_bytes: 0,
          status: "error",
        }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Model indirilemedi")).toBeInTheDocument();
    expect(screen.getByText(/Model Merkezi/)).toBeInTheDocument();
  });

  it("shows the raw error message for diagnosis when present", () => {
    render(
      <FirstRunModelSetupBanner
        progress={{
          model_key: "",
          percentage: 0,
          downloaded_bytes: 0,
          total_bytes: 0,
          status: "error",
          error: "hardware detect failed",
        }}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("first-run-model-setup-error-detail"),
    ).toHaveTextContent("hardware detect failed");
  });

  it("shows a generic placeholder before the model key is known", () => {
    render(
      <FirstRunModelSetupBanner
        progress={{
          model_key: "",
          percentage: 0,
          downloaded_bytes: 0,
          total_bytes: 0,
          status: "downloading",
        }}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Yerel konuşma tanıma modeli hazırlanıyor…"),
    ).toBeInTheDocument();
  });
});
