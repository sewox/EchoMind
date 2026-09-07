import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TemplateSelector } from "./TemplateSelector";
import { I18nProvider } from "../../locales/i18nContext";
import { MeetingTemplate } from "../../types/templates";

describe("TemplateSelector Component", () => {
  const mockCustomTemplates: MeetingTemplate[] = [
    {
      id: "custom_1",
      name: "Pazarlama Değerlendirmesi",
      description: "Kampanya ve ROAS analizi",
      icon: "Sliders",
      isCustom: true,
      systemPrompt: "Pazarlama odaklı analiz yap.",
    },
  ];

  it("renders active template and opens dropdown on click", () => {
    const onSelectTemplate = vi.fn();
    const onOpenCreateCustom = vi.fn();
    const onDeleteCustomTemplate = vi.fn();

    render(
      <I18nProvider>
        <TemplateSelector
          selectedTemplateId="general"
          customTemplates={mockCustomTemplates}
          onSelectTemplate={onSelectTemplate}
          onOpenCreateCustom={onOpenCreateCustom}
          onDeleteCustomTemplate={onDeleteCustomTemplate}
        />
      </I18nProvider>
    );

    // Initial button text contains default template name
    const button = screen.getByRole("button", { name: /Yönetici Özeti/i });
    expect(button).toBeInTheDocument();

    // Click to open dropdown
    fireEvent.click(button);

    // Builtin templates should be rendered
    expect(screen.getByText("1-on-1 Birebir Görüşme")).toBeInTheDocument();
    expect(screen.getByText("Sprint & Teknik Planlama")).toBeInTheDocument();
    expect(screen.getByText("Satış & Müşteri (BANT)")).toBeInTheDocument();
    expect(screen.getByText("Beyin Fırtınası & İnovasyon")).toBeInTheDocument();

    // Custom template should be rendered
    expect(screen.getByText("Pazarlama Değerlendirmesi")).toBeInTheDocument();
  });

  it("selects a built-in template and closes dropdown", () => {
    const onSelectTemplate = vi.fn();
    const onOpenCreateCustom = vi.fn();
    const onDeleteCustomTemplate = vi.fn();

    render(
      <I18nProvider>
        <TemplateSelector
          selectedTemplateId="general"
          customTemplates={[]}
          onSelectTemplate={onSelectTemplate}
          onOpenCreateCustom={onOpenCreateCustom}
          onDeleteCustomTemplate={onDeleteCustomTemplate}
        />
      </I18nProvider>
    );

    const button = screen.getByRole("button", { name: /Yönetici Özeti/i });
    fireEvent.click(button);

    const sprintTpl = screen.getByText("Sprint & Teknik Planlama");
    fireEvent.click(sprintTpl);

    expect(onSelectTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sprint_planning" })
    );
  });

  it("triggers custom template creation and deletion callbacks", () => {
    const onSelectTemplate = vi.fn();
    const onOpenCreateCustom = vi.fn();
    const onDeleteCustomTemplate = vi.fn();

    render(
      <I18nProvider>
        <TemplateSelector
          selectedTemplateId="custom_1"
          customTemplates={mockCustomTemplates}
          onSelectTemplate={onSelectTemplate}
          onOpenCreateCustom={onOpenCreateCustom}
          onDeleteCustomTemplate={onDeleteCustomTemplate}
        />
      </I18nProvider>
    );

    // Open dropdown
    const button = screen.getByRole("button", { name: /Pazarlama Değerlendirmesi/i });
    fireEvent.click(button);

    // Delete custom template
    const deleteBtn = screen.getByTitle("Şablonu sil");
    fireEvent.click(deleteBtn);
    expect(onDeleteCustomTemplate).toHaveBeenCalledWith("custom_1");

    // Click create custom template button
    const createBtn = screen.getByRole("button", {
      name: /\+ Özel Prompt Şablonu Oluştur/i,
    });
    fireEvent.click(createBtn);
    expect(onOpenCreateCustom).toHaveBeenCalled();
  });

  it("closes dropdown when clicking outside and renders all icon variants", () => {
    const multiIconTemplates: MeetingTemplate[] = [
      { id: "t1", name: "T1", description: "D1", icon: "UserCheck" },
      { id: "t2", name: "T2", description: "D2", icon: "Layers" },
      { id: "t3", name: "T3", description: "D3", icon: "TrendingUp" },
      { id: "t4", name: "T4", description: "D4", icon: "Lightbulb" },
      { id: "t5", name: "T5", description: "D5", icon: "Sliders" },
      { id: "t6", name: "T6", description: "D6", icon: "Sparkles" },
    ];

    render(
      <I18nProvider>
        <TemplateSelector
          selectedTemplateId="t1"
          customTemplates={multiIconTemplates}
          onSelectTemplate={vi.fn()}
          onOpenCreateCustom={vi.fn()}
          onDeleteCustomTemplate={vi.fn()}
        />
      </I18nProvider>
    );

    // Open dropdown
    const button = screen.getByRole("button", { name: /T1/i });
    fireEvent.click(button);

    expect(screen.getByText("T2")).toBeInTheDocument();
    expect(screen.getByText("T3")).toBeInTheDocument();
    expect(screen.getByText("T4")).toBeInTheDocument();

    // Click outside to close
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("T2")).not.toBeInTheDocument();
  });
});
