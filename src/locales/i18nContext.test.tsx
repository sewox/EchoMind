import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { I18nProvider, useI18n } from "./i18nContext";

const TestConsumer: React.FC = () => {
  const { language, setLanguage, t, languages, currentLanguageOption } =
    useI18n();

  return (
    <div>
      <span data-testid="current-lang">{language}</span>
      <span data-testid="current-option">{currentLanguageOption.name}</span>
      <span data-testid="translated-title">{t("common.appName")}</span>
      <span data-testid="translated-param">
        {t("cloudWarning.providerSelected", { provider: "Groq" })}
      </span>
      <span data-testid="translated-fallback">
        {t("nonexistent.nested.key")}
      </span>
      <span data-testid="translated-nonstring">{t("common")}</span>
      <button onClick={() => setLanguage("en")}>Set EN</button>
      <button onClick={() => setLanguage("de")}>Set DE</button>
      <button onClick={() => setLanguage("fr")}>Set FR</button>
      <button onClick={() => setLanguage("es")}>Set ES</button>
      <button onClick={() => setLanguage("tr")}>Set TR</button>
      <span data-testid="lang-count">{languages.length}</span>
    </div>
  );
};

describe("I18nContext", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("throws error when used outside provider", () => {
    const FailingComponent = () => {
      useI18n();
      return null;
    };

    expect(() => render(<FailingComponent />)).toThrow(
      "useI18n must be used within an I18nProvider",
    );
  });

  it("provides default language and switches between all supported languages", async () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );

    expect(screen.getByTestId("current-lang").textContent).toBe("tr");
    expect(screen.getByTestId("current-option").textContent).toBe("Türkçe");
    expect(screen.getByTestId("translated-title").textContent).toBe("EchoMind");

    // Test parameter replacement
    expect(screen.getByTestId("translated-param").textContent).toContain(
      "Groq",
    );

    // Test fallback to path
    expect(screen.getByTestId("translated-fallback").textContent).toBe(
      "nonexistent.nested.key",
    );

    // Switch to EN
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set EN" }));
    });
    expect(screen.getByTestId("current-lang").textContent).toBe("en");
    expect(localStorage.getItem("echomind_app_language")).toBe("en");

    // Switch to DE, FR, ES, TR
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set DE" }));
    });
    expect(screen.getByTestId("current-lang").textContent).toBe("de");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set FR" }));
    });
    expect(screen.getByTestId("current-lang").textContent).toBe("fr");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set ES" }));
    });
    expect(screen.getByTestId("current-lang").textContent).toBe("es");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set TR" }));
    });
    expect(screen.getByTestId("current-lang").textContent).toBe("tr");
  });

  it("initializes language from localStorage", () => {
    localStorage.setItem("echomind_app_language", "en");
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId("current-lang").textContent).toBe("en");
  });

  it("handles localStorage errors gracefully", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("Storage blocked");
      });
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage blocked");
      });

    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );

    expect(screen.getByTestId("current-lang").textContent).toBe("tr");

    fireEvent.click(screen.getByRole("button", { name: "Set EN" }));
    expect(screen.getByTestId("current-lang").textContent).toBe("en");

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });
});
