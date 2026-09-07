import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomTemplateModal } from "./CustomTemplateModal";
import { I18nProvider } from "../../locales/i18nContext";

describe("CustomTemplateModal Component", () => {
  it("does not render when isOpen is false", () => {
    const { container } = render(
      <I18nProvider>
        <CustomTemplateModal
          isOpen={false}
          onClose={vi.fn()}
          onSaveTemplate={vi.fn()}
        />
      </I18nProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it("validates required fields and saves custom template", () => {
    const onClose = vi.fn();
    const onSaveTemplate = vi.fn();

    render(
      <I18nProvider>
        <CustomTemplateModal
          isOpen={true}
          onClose={onClose}
          onSaveTemplate={onSaveTemplate}
        />
      </I18nProvider>
    );

    // Try submitting without name
    const submitBtn = screen.getByRole("button", { name: /Şablonu Kaydet/i });
    fireEvent.click(submitBtn);
    expect(screen.getByText(/Lütfen bir şablon adı girin/i)).toBeInTheDocument();

    // Fill name and try submitting without prompt
    const nameInput = screen.getByPlaceholderText(/Örn: Haftalık Pazarlama/i);
    fireEvent.change(nameInput, { target: { value: "Pazarlama Raporu" } });
    fireEvent.click(submitBtn);
    expect(
      screen.getByText(/Lütfen yapay zekaya verilecek sistem promptunu girin/i)
    ).toBeInTheDocument();

    // Fill description & prompt, then submit
    const descInput = screen.getByPlaceholderText(/Örn: Kampanya metrikleri/i);
    fireEvent.change(descInput, { target: { value: "Kreatif ve bütçe analizi" } });

    const promptTextarea = screen.getByPlaceholderText(/SEN KIDEMLİ BİR PAZARLAMA/i);
    fireEvent.change(promptTextarea, {
      target: { value: "Özel pazarlama promptu yönergeleri..." },
    });

    fireEvent.click(submitBtn);

    expect(onSaveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Pazarlama Raporu",
        description: "Kreatif ve bütçe analizi",
        systemPrompt: "Özel pazarlama promptu yönergeleri...",
        isCustom: true,
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("handles empty description with fallback description", () => {
    const onClose = vi.fn();
    const onSaveTemplate = vi.fn();

    render(
      <I18nProvider>
        <CustomTemplateModal
          isOpen={true}
          onClose={onClose}
          onSaveTemplate={onSaveTemplate}
        />
      </I18nProvider>
    );

    const nameInput = screen.getByPlaceholderText(/Örn: Haftalık Pazarlama/i);
    fireEvent.change(nameInput, { target: { value: "Şablon" } });

    const promptTextarea = screen.getByPlaceholderText(/SEN KIDEMLİ BİR PAZARLAMA/i);
    fireEvent.change(promptTextarea, {
      target: { value: "Sistem promptu" },
    });

    const submitBtn = screen.getByRole("button", { name: /Şablonu Kaydet/i });
    fireEvent.click(submitBtn);

    expect(onSaveTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Şablon",
        description: "Kullanıcı tanımlı özel prompt şablonu",
        systemPrompt: "Sistem promptu",
      })
    );
  });
});
