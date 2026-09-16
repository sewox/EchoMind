import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UpdateModal, UpdateCheckResult } from "./UpdateModal";
import { I18nProvider } from "../locales/i18nContext";
import { invoke } from "@tauri-apps/api/core";

let progressCallback: ((event: any) => void) | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, cb: (event: any) => void) => {
    if (eventName === "update-download-progress") {
      progressCallback = cb;
    }
    return Promise.resolve(() => {
      progressCallback = null;
    });
  }),
}));

const mockUpdateInfo: UpdateCheckResult = {
  is_update_available: true,
  current_version: "0.2.0",
  latest_version: "0.3.0",
  release_name: "EchoMind v0.3.0 - Major AI Upgrade",
  release_notes: "- Added Cross-Meeting Memory RAG\n- Enhanced Voice Isolation",
  published_at: "2026-09-15T12:00:00Z",
  html_url: "https://github.com/sewox/EchoMind/releases/tag/v0.3.0",
  assets: [
    {
      name: "EchoMind-0.3.0.dmg",
      size: 154000000,
      download_url:
        "https://github.com/sewox/EchoMind/releases/download/v0.3.0/EchoMind.dmg",
      content_type: "application/octet-stream",
    },
  ],
};

describe("UpdateModal Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    progressCallback = null;
  });

  const renderComponent = (props: {
    isOpen: boolean;
    updateInfo: UpdateCheckResult | null;
    onClose: () => void;
  }) => {
    return render(
      <I18nProvider>
        <UpdateModal {...props} />
      </I18nProvider>,
    );
  };

  it("renders nothing when isOpen is false or updateInfo is null", () => {
    const { rerender } = renderComponent({
      isOpen: false,
      updateInfo: mockUpdateInfo,
      onClose: vi.fn(),
    });

    expect(
      screen.queryByTestId("update-modal-backdrop"),
    ).not.toBeInTheDocument();

    rerender(
      <I18nProvider>
        <UpdateModal isOpen={true} updateInfo={null} onClose={vi.fn()} />
      </I18nProvider>,
    );

    expect(
      screen.queryByTestId("update-modal-backdrop"),
    ).not.toBeInTheDocument();
  });

  it("renders version information and release notes correctly", () => {
    renderComponent({
      isOpen: true,
      updateInfo: mockUpdateInfo,
      onClose: vi.fn(),
    });

    expect(screen.getByTestId("update-modal-backdrop")).toBeInTheDocument();
    expect(screen.getByText("v0.2.0")).toBeInTheDocument();
    expect(screen.getByText("v0.3.0")).toBeInTheDocument();
    expect(
      screen.getByText("EchoMind v0.3.0 - Major AI Upgrade"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/- Added Cross-Meeting Memory RAG/),
    ).toBeInTheDocument();
  });

  it("handles fallback when release_notes is empty", () => {
    const emptyNotesInfo: UpdateCheckResult = {
      ...mockUpdateInfo,
      release_notes: "",
    };

    renderComponent({
      isOpen: true,
      updateInfo: emptyNotesInfo,
      onClose: vi.fn(),
    });

    expect(
      screen.getByText(/Performans iyileştirmeleri ve hata düzeltmeleri/i),
    ).toBeInTheDocument();
  });

  it("triggers invoke download_and_install_update when Update Now is clicked", async () => {
    const onClose = vi.fn();
    (invoke as any).mockResolvedValue("/tmp/echomind_update.dmg");

    renderComponent({
      isOpen: true,
      updateInfo: mockUpdateInfo,
      onClose,
    });

    const updateBtn = screen.getByTestId("update-now-btn");
    fireEvent.click(updateBtn);

    expect(invoke).toHaveBeenCalledWith("download_and_install_update", {
      downloadUrl: null,
      filename: null,
    });
  });

  it("displays live download progress bar when update-download-progress events arrive", async () => {
    (invoke as any).mockImplementation(() => new Promise(() => {})); // pending

    renderComponent({
      isOpen: true,
      updateInfo: mockUpdateInfo,
      onClose: vi.fn(),
    });

    const updateBtn = screen.getByTestId("update-now-btn");
    fireEvent.click(updateBtn);

    expect(screen.getByTestId("update-progress-container")).toBeInTheDocument();

    act(() => {
      if (progressCallback) {
        progressCallback({
          payload: {
            percentage: 45.5,
            downloaded_bytes: 45500000,
            total_bytes: 100000000,
            status: "downloading",
          },
        });
      }
    });

    expect(screen.getByText("45.5%")).toBeInTheDocument();
    expect(screen.getByText(/43.4 MB \/ 95.4 MB/)).toBeInTheDocument();

    // Progress completed event
    act(() => {
      if (progressCallback) {
        progressCallback({
          payload: {
            percentage: 100.0,
            downloaded_bytes: 100000000,
            total_bytes: 100000000,
            status: "completed",
          },
        });
      }
    });

    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("handles download error and presents manual GitHub fallback link", async () => {
    (invoke as any).mockRejectedValue("Network error while downloading");

    renderComponent({
      isOpen: true,
      updateInfo: mockUpdateInfo,
      onClose: vi.fn(),
    });

    const updateBtn = screen.getByTestId("update-now-btn");
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(screen.getByTestId("update-error-banner")).toBeInTheDocument();
      expect(
        screen.getByText(/Network error while downloading/),
      ).toBeInTheDocument();
    });

    const fallbackBtn = screen.getByText(/Doğrudan GitHub'dan İndir/i);
    fireEvent.click(fallbackBtn);

    expect(invoke).toHaveBeenCalledWith("open_release_url", {
      url: "https://github.com/sewox/EchoMind/releases/tag/v0.3.0",
    });
  });

  it("saves dontShowAgain choice to localStorage when checked and Update Now is clicked", async () => {
    (invoke as any).mockResolvedValue(undefined);

    renderComponent({
      isOpen: true,
      updateInfo: mockUpdateInfo,
      onClose: vi.fn(),
    });

    const checkbox = screen.getByTestId("dont-show-update-checkbox");
    fireEvent.click(checkbox);

    const updateBtn = screen.getByTestId("update-now-btn");
    fireEvent.click(updateBtn);

    expect(localStorage.getItem("echomind_skip_update_version")).toBe("0.3.0");
  });

  it("saves dontShowAgain choice to localStorage when Remind Later is clicked", () => {
    const onClose = vi.fn();

    renderComponent({
      isOpen: true,
      updateInfo: mockUpdateInfo,
      onClose,
    });

    const checkbox = screen.getByTestId("dont-show-update-checkbox");
    fireEvent.click(checkbox);

    const remindLaterBtn = screen.getByTestId("update-remind-later-btn");
    fireEvent.click(remindLaterBtn);

    expect(localStorage.getItem("echomind_skip_update_version")).toBe("0.3.0");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes modal when X close button is clicked", () => {
    const onClose = vi.fn();

    renderComponent({
      isOpen: true,
      updateInfo: mockUpdateInfo,
      onClose,
    });

    const closeBtn = screen.getByTestId("update-modal-close-btn");
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it("handles empty published_at date string without errors", () => {
    const noDateInfo: UpdateCheckResult = {
      ...mockUpdateInfo,
      published_at: "",
    };

    renderComponent({
      isOpen: true,
      updateInfo: noDateInfo,
      onClose: vi.fn(),
    });

    expect(screen.getByTestId("update-modal-backdrop")).toBeInTheDocument();
  });
});
