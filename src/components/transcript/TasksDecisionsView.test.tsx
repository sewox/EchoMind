import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TasksDecisionsView } from "./TasksDecisionsView";
import { I18nProvider } from "../../locales/i18nContext";
import { ActionItem } from "../../App";

describe("TasksDecisionsView Component", () => {
  const mockActions: ActionItem[] = [
    {
      task: "Kira kontratı imzalanacak",
      assignee: "Ahmet",
      source_citations: [1, 2],
      is_completed: false,
    },
    {
      task: "Bütçe tablosu hazırlanacak",
      assignee: undefined,
      source_citations: [],
      is_completed: true,
    },
  ];

  const defaultProps = {
    actionItems: mockActions,
    onToggleActionItem: vi.fn(),
    onJumpToCitation: vi.fn(),
  };

  it("renders action items, citations, and handles interactions", () => {
    render(
      <I18nProvider>
        <TasksDecisionsView {...defaultProps} />
      </I18nProvider>,
    );

    expect(screen.getByText("Kira kontratı imzalanacak")).toBeInTheDocument();
    expect(screen.getByText(/Ahmet/)).toBeInTheDocument();
    expect(screen.getByText("Bütçe tablosu hazırlanacak")).toBeInTheDocument();

    // Citation button click
    const citationBtn = screen.getByTitle("Transkript #1 referansına git");
    fireEvent.click(citationBtn);
    expect(defaultProps.onJumpToCitation).toHaveBeenCalledWith(1);

    // Toggle task completion
    const toggleButtons = screen.getAllByRole("button");
    fireEvent.click(toggleButtons[0]);
    expect(defaultProps.onToggleActionItem).toHaveBeenCalledWith(0);
  });

  it("renders empty state when no action items exist", () => {
    render(
      <I18nProvider>
        <TasksDecisionsView
          actionItems={[]}
          onToggleActionItem={vi.fn()}
          onJumpToCitation={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(
      screen.getByText(/Belirlenmiş görev maddesi bulunmuyor/i),
    ).toBeInTheDocument();
  });
});
