import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMeetingManager } from "./useMeetingManager";
import { invoke } from "@tauri-apps/api/core";
import { MeetingRecord } from "../App";

describe("useMeetingManager Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockMeetings: MeetingRecord[] = [
    {
      id: "m1",
      title: "Haftalık Senkronizasyon",
      date_formatted: "01.09.2026",
      duration_seconds: 60,
      duration_formatted: "01:00",
      audio_file_path: "/audio1.flac",
      segments: [
        {
          id: 1,
          speaker_id: "spk1",
          speaker_name: "Ahmet",
          start_time_ms: 0,
          end_time_ms: 2000,
          timestamp_formatted: "00:00",
          text: "Bütçe onaylandı",
          language: "tr",
          confidence: 0.99,
        },
      ],
      summary: "Proje bütçe değerlendirmesi",
      key_decisions: ["Bütçe kabul"],
    },
    {
      id: "m2",
      title: "Tasarım İncelemesi",
      date_formatted: "02.09.2026",
      duration_seconds: 120,
      duration_formatted: "02:00",
      audio_file_path: "/audio2.flac",
      segments: [],
      summary: "UI/UX arayüz kararları",
      key_decisions: [],
    },
  ];

  it("fetches past meetings on mount and filters by query across title, summary and segments", async () => {
    (invoke as any).mockResolvedValue(mockMeetings);

    const { result } = renderHook(() => useMeetingManager());

    await act(async () => {
      await result.current.fetchPastMeetings();
    });

    expect(result.current.pastMeetings.length).toBe(2);

    // Search by title
    act(() => {
      result.current.setSearchQuery("Tasarım");
    });
    expect(result.current.filteredMeetings.length).toBe(1);
    expect(result.current.filteredMeetings[0].id).toBe("m2");

    // Search by segment text
    act(() => {
      result.current.setSearchQuery("Bütçe");
    });
    expect(result.current.filteredMeetings.length).toBe(1);
    expect(result.current.filteredMeetings[0].id).toBe("m1");
  });

  it("deletes a meeting and updates state", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockMeetings);
      if (cmd === "delete_meeting_by_id") return Promise.resolve();
      return Promise.resolve();
    });

    const { result } = renderHook(() => useMeetingManager());

    await act(async () => {
      await result.current.fetchPastMeetings();
    });

    act(() => {
      result.current.setSelectedMeeting(mockMeetings[0]);
    });

    await act(async () => {
      await result.current.handleDeleteMeeting("m1");
    });

    expect(invoke).toHaveBeenCalledWith("delete_meeting_by_id", {
      id: "m1",
      meetingId: "m1",
    });
    expect(result.current.pastMeetings.length).toBe(1);
    expect(result.current.selectedMeeting).toBeNull();
  });

  it("handles editing and saving meeting title", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockMeetings);
      if (cmd === "update_meeting_title") return Promise.resolve();
      return Promise.resolve();
    });

    const { result } = renderHook(() => useMeetingManager());

    await act(async () => {
      await result.current.fetchPastMeetings();
    });

    act(() => {
      result.current.setSelectedMeeting(mockMeetings[0]);
      result.current.handleStartEditMeetingTitle(mockMeetings[0]);
    });

    expect(result.current.editingMeetingId).toBe("m1");
    expect(result.current.editingTitleText).toBe("Haftalık Senkronizasyon");

    act(() => {
      result.current.setEditingTitleText("Yeni Toplantı Başlığı");
    });

    await act(async () => {
      await result.current.handleSaveMeetingTitle("m1");
    });

    expect(invoke).toHaveBeenCalledWith("update_meeting_title", {
      meetingId: "m1",
      newTitle: "Yeni Toplantı Başlığı",
    });
    expect(result.current.selectedMeeting?.title).toBe("Yeni Toplantı Başlığı");
  });

  it("handles cancelling title edit and empty title saving", async () => {
    const { result } = renderHook(() => useMeetingManager());

    act(() => {
      result.current.handleStartEditMeetingTitle(mockMeetings[0]);
      result.current.handleCancelEditMeetingTitle();
    });
    expect(result.current.editingMeetingId).toBeNull();

    act(() => {
      result.current.handleStartEditMeetingTitle(mockMeetings[0]);
      result.current.setEditingTitleText("   ");
    });

    await act(async () => {
      await result.current.handleSaveMeetingTitle("m1");
    });
    expect(result.current.editingMeetingId).toBeNull();
  });

  it("handles fetch, delete, and save errors safely without unhandled rejections", async () => {
    (invoke as any).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useMeetingManager());

    await act(async () => {
      await result.current.fetchPastMeetings();
      await result.current.handleDeleteMeeting("m1");
      result.current.setEditingTitleText("Test");
      await result.current.handleSaveMeetingTitle("m1");
      await result.current.handleAddMeetingTag("m1", "Etiket");
      await result.current.handleRemoveMeetingTag("m1", "Etiket");
    });

    expect(result.current.editingMeetingId).toBeNull();
  });

  it("filters meetings by selected tag and computes allAvailableTags", async () => {
    const taggedMeetings: MeetingRecord[] = [
      {
        ...mockMeetings[0],
        tags: ["Finans & Bütçe", "Yazılım"],
      },
      {
        ...mockMeetings[1],
        tags: ["Tasarım & UI/UX"],
      },
    ];

    (invoke as any).mockResolvedValue(taggedMeetings);

    const { result } = renderHook(() => useMeetingManager());

    await act(async () => {
      await result.current.fetchPastMeetings();
    });

    expect(result.current.allAvailableTags).toEqual([
      "Finans & Bütçe",
      "Tasarım & UI/UX",
      "Yazılım",
    ]);

    act(() => {
      result.current.setSelectedTag("Finans & Bütçe");
    });
    expect(result.current.filteredMeetings.length).toBe(1);
    expect(result.current.filteredMeetings[0].id).toBe("m1");

    act(() => {
      result.current.setSelectedTag(null);
    });
    expect(result.current.filteredMeetings.length).toBe(2);
  });

  it("adds and removes tags properly", async () => {
    const updatedMeeting: MeetingRecord = {
      ...mockMeetings[0],
      tags: ["Finans & Bütçe", "Yeni Etiket"],
    };
    const removedMeeting: MeetingRecord = {
      ...mockMeetings[0],
      tags: ["Finans & Bütçe"],
    };

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_all_meetings") return Promise.resolve(mockMeetings);
      if (cmd === "add_meeting_tag") return Promise.resolve(updatedMeeting);
      if (cmd === "remove_meeting_tag") return Promise.resolve(removedMeeting);
      return Promise.resolve();
    });

    const { result } = renderHook(() => useMeetingManager());

    await act(async () => {
      await result.current.fetchPastMeetings();
    });

    act(() => {
      result.current.setSelectedMeeting(mockMeetings[0]);
    });

    await act(async () => {
      await result.current.handleAddMeetingTag("m1", "Yeni Etiket");
    });

    expect(invoke).toHaveBeenCalledWith("add_meeting_tag", {
      meetingId: "m1",
      tag: "Yeni Etiket",
    });

    await act(async () => {
      await result.current.handleRemoveMeetingTag("m1", "Yeni Etiket");
    });

    expect(invoke).toHaveBeenCalledWith("remove_meeting_tag", {
      meetingId: "m1",
      tag: "Yeni Etiket",
    });
  });
});
