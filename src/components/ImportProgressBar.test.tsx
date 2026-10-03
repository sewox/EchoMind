import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../locales/i18nContext";
import { ImportProgressBar } from "./ImportProgressBar";
import type { ImportProgressState } from "../hooks/useImportProgress";

const renderBar = (progress: ImportProgressState) =>
  render(
    <I18nProvider>
      <ImportProgressBar progress={progress} />
    </I18nProvider>,
  );

describe("ImportProgressBar", () => {
  it("shows stage, percentage and minutes left", () => {
    renderBar({ stage: "transcribing", percent: 42.4, etaSeconds: 150 });
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText(/~3/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
  });

  it("names the report stage", () => {
    renderBar({ stage: "summarizing", percent: 80, etaSeconds: null });
    expect(screen.getByText("Rapor hazırlanıyor…")).toBeInTheDocument();
  });

  it("rounds short remaining times to seconds", () => {
    renderBar({ stage: "diarizing", percent: 92, etaSeconds: 12 });
    expect(screen.getByText(/~10/)).toBeInTheDocument();
  });

  it("shows an indeterminate bar without a percentage", () => {
    renderBar({ stage: "transcribing", percent: null, etaSeconds: null });
    expect(
      screen.getByTestId("import-progress-indeterminate"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
  });
});
