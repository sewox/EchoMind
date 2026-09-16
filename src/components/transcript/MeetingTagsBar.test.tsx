import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MeetingTagsBar, getTagColorClass } from "./MeetingTagsBar";

vi.mock("../../locales/i18nContext", () => ({
  useI18n: () => ({
    t: (k: string) => k,
  }),
}));

describe("MeetingTagsBar Component", () => {
  it("renders all tag categories with correct color classes", () => {
    expect(getTagColorClass("Finans & Bütçe").bg).toContain("emerald");
    expect(getTagColorClass("Finance & Budget").bg).toContain("emerald");
    expect(getTagColorClass("Yönetim & Strateji").bg).toContain("indigo");
    expect(getTagColorClass("Software & Tech").bg).toContain("cyan");
    expect(getTagColorClass("UI/UX Design").bg).toContain("fuchsia");
    expect(getTagColorClass("Müşteri Satış").bg).toContain("amber");
    expect(getTagColorClass("Marketing Growth").bg).toContain("rose");
    expect(getTagColorClass("İnsan Kaynakları").bg).toContain("violet");
    expect(getTagColorClass("Sprint Operasyon").bg).toContain("yellow");
    expect(getTagColorClass("Bilinmeyen").bg).toContain("slate");
  });

  it("renders tags correctly and allows deletion", () => {
    const onRemoveTag = vi.fn();
    const onAddTag = vi.fn();

    render(
      <MeetingTagsBar
        tags={["Finans & Bütçe", "Yazılım & Teknoloji"]}
        meetingId="mtg-1"
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
      />,
    );

    expect(screen.getByText("Finans & Bütçe")).toBeInTheDocument();
    expect(screen.getByText("Yazılım & Teknoloji")).toBeInTheDocument();

    const deleteButtons = screen.getAllByTitle("tags.removeTag");
    expect(deleteButtons).toHaveLength(2);
    fireEvent.click(deleteButtons[0]);
    expect(onRemoveTag).toHaveBeenCalledWith("mtg-1", "Finans & Bütçe");
  });

  it("allows adding a new tag via input", () => {
    const onAddTag = vi.fn();
    render(
      <MeetingTagsBar
        tags={["Tasarım"]}
        meetingId="mtg-2"
        onAddTag={onAddTag}
      />,
    );

    const addBtn = screen.getByTitle("tags.addTag");
    fireEvent.click(addBtn);

    const input = screen.getByPlaceholderText("tags.addTagPlaceholder");
    fireEvent.change(input, { target: { value: "Yeni Etiket" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAddTag).toHaveBeenCalledWith("mtg-2", "Yeni Etiket");
  });

  it("cancels adding a new tag on Escape key", () => {
    const onAddTag = vi.fn();
    render(
      <MeetingTagsBar
        tags={["Tasarım"]}
        meetingId="mtg-2"
        onAddTag={onAddTag}
      />,
    );

    const addBtn = screen.getByTitle("tags.addTag");
    fireEvent.click(addBtn);

    const input = screen.getByPlaceholderText("tags.addTagPlaceholder");
    fireEvent.change(input, { target: { value: "İptal Edilecek" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(
      screen.queryByPlaceholderText("tags.addTagPlaceholder"),
    ).not.toBeInTheDocument();
  });

  it("handles empty tag input on blur and empty tag list placeholder", () => {
    const onAddTag = vi.fn();
    render(
      <MeetingTagsBar tags={[]} meetingId="mtg-empty" onAddTag={onAddTag} />,
    );

    expect(screen.getByText("tags.noTags")).toBeInTheDocument();

    const addBtn = screen.getByTitle("tags.addTag");
    fireEvent.click(addBtn);

    const input = screen.getByPlaceholderText("tags.addTagPlaceholder");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    expect(onAddTag).not.toHaveBeenCalled();
    expect(
      screen.queryByPlaceholderText("tags.addTagPlaceholder"),
    ).not.toBeInTheDocument();
  });

  it("renders read-only mode without buttons", () => {
    render(
      <MeetingTagsBar tags={["Finans"]} meetingId="mtg-3" readOnly={true} />,
    );

    expect(screen.getByText("Finans")).toBeInTheDocument();
    expect(screen.queryByTitle("tags.addTag")).not.toBeInTheDocument();
    expect(screen.queryByTitle("tags.removeTag")).not.toBeInTheDocument();
  });
});
