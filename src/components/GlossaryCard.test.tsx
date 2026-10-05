import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { I18nProvider } from "../locales/i18nContext";
import { GlossaryCard } from "./GlossaryCard";

const renderCard = () =>
  render(
    <I18nProvider>
      <GlossaryCard />
    </I18nProvider>,
  );

describe("GlossaryCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the saved terms and counts them", async () => {
    (invoke as any).mockImplementation((cmd: string) =>
      cmd === "get_glossary"
        ? Promise.resolve("SonicWall\nKVKK")
        : Promise.resolve(),
    );
    renderCard();
    expect(await screen.findByDisplayValue(/SonicWall/)).toBeInTheDocument();
    expect(screen.getByText("2 terim")).toBeInTheDocument();
  });

  it("saves the list and shows the normalized result", async () => {
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === "get_glossary") return Promise.resolve("");
      if (cmd === "set_glossary")
        return Promise.resolve(args.terms.trim().split("\n")[0]);
      return Promise.resolve();
    });
    renderCard();
    const box = screen.getByLabelText("Özel Terimler");
    fireEvent.change(box, { target: { value: " Acme \nacme" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    });
    expect(invoke).toHaveBeenCalledWith("set_glossary", {
      terms: " Acme \nacme",
    });
    expect(screen.getByText("Kaydedildi")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Acme")).toBeInTheDocument();
  });

  it("reports a failed save", async () => {
    (invoke as any).mockImplementation((cmd: string) =>
      cmd === "set_glossary"
        ? Promise.reject("disk full")
        : Promise.resolve(""),
    );
    renderCard();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Kaydedilemedi");
  });
});
