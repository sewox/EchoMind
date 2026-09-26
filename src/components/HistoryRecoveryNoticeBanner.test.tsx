import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HistoryRecoveryNoticeBanner } from "./HistoryRecoveryNoticeBanner";
import { I18nProvider } from "../locales/i18nContext";

describe("HistoryRecoveryNoticeBanner", () => {
  beforeEach(() => {
    localStorage.setItem("echomind_app_language", "tr");
  });

  it("renders nothing when not visible", () => {
    const { container } = render(
      <I18nProvider>
        <HistoryRecoveryNoticeBanner visible={false} onDismiss={vi.fn()} />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the Turkish recovery message and dismisses once", () => {
    const onDismiss = vi.fn();
    render(
      <I18nProvider>
        <HistoryRecoveryNoticeBanner visible={true} onDismiss={onDismiss} />
      </I18nProvider>,
    );

    expect(
      screen.getByTestId("history-recovery-notice-banner"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Önceki şifreli geçmiş bu sürümde açılamadı; yedekler saklandı. Yeni kayıtlar artık Keychain ile korunuyor.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("history-recovery-notice-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows the English equivalent when language is en", async () => {
    localStorage.setItem("echomind_app_language", "en");
    render(
      <I18nProvider>
        <HistoryRecoveryNoticeBanner visible={true} onDismiss={vi.fn()} />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Previous encrypted history could not be opened in this version; backups were kept. New recordings are now protected with Keychain.",
        ),
      ).toBeInTheDocument();
    });
  });
});
