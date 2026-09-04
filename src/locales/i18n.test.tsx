import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { I18nProvider, useI18n } from "./i18nContext";
import { tr } from "./tr";
import { en } from "./en";
import { de } from "./de";
import { fr } from "./fr";
import { es } from "./es";

const TestComponent = () => {
  const { t, language, setLanguage } = useI18n();
  return (
    <div>
      <span data-testid="current-lang">{language}</span>
      <span data-testid="app-name">{t("common.appName")}</span>
      <span data-testid="nav-settings">{t("nav.settings")}</span>
      <button onClick={() => setLanguage("en")}>Set EN</button>
      <button onClick={() => setLanguage("de")}>Set DE</button>
      <button onClick={() => setLanguage("fr")}>Set FR</button>
      <button onClick={() => setLanguage("es")}>Set ES</button>
      <button onClick={() => setLanguage("tr")}>Set TR</button>
    </div>
  );
};

describe("i18n System & Dictionaries", () => {
  it("has consistent keys across all languages", () => {
    const checkKeys = (baseObj: any, compareObj: any, path = "") => {
      for (const key of Object.keys(baseObj)) {
        const currentPath = path ? `${path}.${key}` : key;
        expect(
          compareObj,
          `Missing object for path: ${currentPath}`,
        ).toBeDefined();
        expect(key in compareObj, `Missing key: ${currentPath}`).toBe(true);
        if (typeof baseObj[key] === "object" && baseObj[key] !== null) {
          checkKeys(baseObj[key], compareObj[key], currentPath);
        }
      }
    };

    checkKeys(tr, en);
    checkKeys(tr, de);
    checkKeys(tr, fr);
    checkKeys(tr, es);
  });

  it("provides default Turkish language and allows switching languages", () => {
    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>,
    );

    expect(screen.getByTestId("app-name")).toHaveTextContent(tr.common.appName);
    expect(screen.getByTestId("nav-settings")).toHaveTextContent(
      tr.nav.settings,
    );

    // Switch to English
    act(() => {
      screen.getByText("Set EN").click();
    });
    expect(screen.getByTestId("current-lang")).toHaveTextContent("en");
    expect(screen.getByTestId("nav-settings")).toHaveTextContent(
      en.nav.settings,
    );

    // Switch to German
    act(() => {
      screen.getByText("Set DE").click();
    });
    expect(screen.getByTestId("current-lang")).toHaveTextContent("de");
    expect(screen.getByTestId("nav-settings")).toHaveTextContent(
      de.nav.settings,
    );

    // Switch to French
    act(() => {
      screen.getByText("Set FR").click();
    });
    expect(screen.getByTestId("current-lang")).toHaveTextContent("fr");
    expect(screen.getByTestId("nav-settings")).toHaveTextContent(
      fr.nav.settings,
    );

    // Switch to Spanish
    act(() => {
      screen.getByText("Set ES").click();
    });
    expect(screen.getByTestId("current-lang")).toHaveTextContent("es");
    expect(screen.getByTestId("nav-settings")).toHaveTextContent(
      es.nav.settings,
    );

    // Switch back to Turkish
    act(() => {
      screen.getByText("Set TR").click();
    });
    expect(screen.getByTestId("current-lang")).toHaveTextContent("tr");
    expect(screen.getByTestId("nav-settings")).toHaveTextContent(
      tr.nav.settings,
    );
  });

  it("handles nested translation keys with fallback when key does not exist", () => {
    const FallbackComponent = () => {
      const { t } = useI18n();
      return (
        <div data-testid="missing-key">
          {t("non.existent.nested.key" as any)}
        </div>
      );
    };

    render(
      <I18nProvider>
        <FallbackComponent />
      </I18nProvider>,
    );

    expect(screen.getByTestId("missing-key")).toHaveTextContent(
      "non.existent.nested.key",
    );
  });
});
