import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { I18nProvider } from "../locales/i18nContext";
import { CloudRecordingSection } from "./CloudRecordingSection";

type State = {
  enabled: boolean;
  provider: string | null;
  has_key: boolean;
  allowed: boolean;
};

const OFF: State = {
  enabled: false,
  provider: "groq",
  has_key: true,
  allowed: true,
};

const backend = (initial: State) => {
  let state = { ...initial };
  (invoke as any).mockImplementation((cmd: string, args?: any) => {
    if (cmd === "get_cloud_recording") return Promise.resolve(state);
    if (cmd === "set_cloud_recording") {
      state = { ...state, enabled: args.enabled };
      return Promise.resolve(state);
    }
    return Promise.resolve();
  });
};

const renderSection = async (engine = "cloud_groq") => {
  const view = render(
    <I18nProvider>
      <CloudRecordingSection activeEngine={engine} />
    </I18nProvider>,
  );
  await act(async () => {});
  return view;
};

describe("CloudRecordingSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is off by default and says recordings stay on this computer", async () => {
    backend(OFF);
    await renderSection();
    const sw = screen.getByRole("switch", { name: "Kayıtlarda bulutu kullan" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("Şu an: kayıtlar bu bilgisayarda yazıya dökülüyor."),
    ).toBeInTheDocument();
  });

  it("turns cloud recording on with the chosen provider", async () => {
    backend(OFF);
    await renderSection();
    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });
    expect(invoke).toHaveBeenCalledWith("set_cloud_recording", {
      enabled: true,
    });
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText("Şu an: kayıtlar Groq ile yazıya dökülüyor."),
    ).toBeInTheDocument();
  });

  it("says what is missing when it is on but cannot be used", async () => {
    backend({ ...OFF, enabled: true, has_key: false });
    const { unmount } = await renderSection();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Groq için API anahtarını kaydedin",
    );
    unmount();

    backend({ ...OFF, enabled: true, provider: null });
    await renderSection("local");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Aşağıdan bir bulut motoru seçin",
    );
  });

  it("cannot be turned on in Paranoid Mode", async () => {
    backend({ ...OFF, allowed: false });
    await renderSection();
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Paranoid Mod açıkken bulut kullanılamaz",
    );
  });

  it("reads the state again when the engine changes", async () => {
    backend(OFF);
    const { rerender } = await renderSection("cloud_groq");
    rerender(
      <I18nProvider>
        <CloudRecordingSection activeEngine="cloud_openai" />
      </I18nProvider>,
    );
    await act(async () => {});
    expect(
      (invoke as any).mock.calls.filter(
        ([cmd]: [string]) => cmd === "get_cloud_recording",
      ).length,
    ).toBe(2);
  });
});
