import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MeetingRecord } from "../App";

export function useMeetingManager() {
  const [pastMeetings, setPastMeetings] = useState<MeetingRecord[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingRecord | null>(
    null,
  );
  const [isLoadingMeeting, setIsLoadingMeeting] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState<string>("");
  const [meetingToDelete, setMeetingToDelete] = useState<MeetingRecord | null>(
    null,
  );

  const fetchPastMeetings = async () => {
    try {
      const meetings = await invoke<MeetingRecord[]>("get_all_meetings");
      setPastMeetings(Array.isArray(meetings) ? meetings : []);
    } catch (err) {
      console.error("Failed to fetch past meetings:", err);
    }
  };

  useEffect(() => {
    fetchPastMeetings();
  }, []);

  const handleDeleteMeeting = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await invoke("delete_meeting_by_id", { id, meetingId: id });
      setPastMeetings((prev) =>
        Array.isArray(prev) ? prev.filter((m) => m.id !== id) : [],
      );
      if (selectedMeeting?.id === id) {
        setSelectedMeeting(null);
      }
      if (meetingToDelete?.id === id) {
        setMeetingToDelete(null);
      }
    } catch (err) {
      console.error("Failed to delete meeting:", err);
    }
  };

  const handlePromptDeleteMeeting = (
    meeting: MeetingRecord,
    e?: React.MouseEvent,
  ) => {
    if (e) e.stopPropagation();
    setMeetingToDelete(meeting);
  };

  const handleConfirmDelete = async () => {
    if (!meetingToDelete) return;
    await handleDeleteMeeting(meetingToDelete.id);
  };

  const handleCancelDelete = () => {
    setMeetingToDelete(null);
  };

  const handleStartEditMeetingTitle = (
    meeting: MeetingRecord,
    e?: React.MouseEvent,
  ) => {
    if (e) e.stopPropagation();
    setEditingMeetingId(meeting.id);
    setEditingTitleText(meeting.title);
  };

  const handleSaveMeetingTitle = async (
    meetingId: string,
    e?: React.MouseEvent,
  ) => {
    if (e) e.stopPropagation();
    if (!editingTitleText.trim()) {
      setEditingMeetingId(null);
      return;
    }
    const newTitle = editingTitleText.trim();
    try {
      await invoke("update_meeting_title", { meetingId, newTitle });
      setPastMeetings((prev) =>
        Array.isArray(prev)
          ? prev.map((m) =>
              m.id === meetingId ? { ...m, title: newTitle } : m,
            )
          : [],
      );
      if (selectedMeeting?.id === meetingId) {
        setSelectedMeeting((prev) =>
          prev ? { ...prev, title: newTitle } : null,
        );
      }
    } catch (err) {
      console.error("Failed to update meeting title:", err);
    } finally {
      setEditingMeetingId(null);
    }
  };

  const handleCancelEditMeetingTitle = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingMeetingId(null);
  };

  const handleAddMeetingTag = async (meetingId: string, tag: string) => {
    const cleanTag = tag.trim();
    if (!cleanTag) return;
    try {
      const updated = await invoke<MeetingRecord>("add_meeting_tag", {
        meetingId,
        tag: cleanTag,
      });
      setPastMeetings((prev) =>
        Array.isArray(prev)
          ? prev.map((m) => (m.id === meetingId ? updated : m))
          : [updated],
      );
      if (selectedMeeting?.id === meetingId) {
        setSelectedMeeting(updated);
      }
    } catch (err) {
      console.error("Failed to add meeting tag:", err);
    }
  };

  const handleRemoveMeetingTag = async (meetingId: string, tag: string) => {
    try {
      const updated = await invoke<MeetingRecord>("remove_meeting_tag", {
        meetingId,
        tag,
      });
      setPastMeetings((prev) =>
        Array.isArray(prev)
          ? prev.map((m) => (m.id === meetingId ? updated : m))
          : [updated],
      );
      if (selectedMeeting?.id === meetingId) {
        setSelectedMeeting(updated);
      }
    } catch (err) {
      console.error("Failed to remove meeting tag:", err);
    }
  };

  const allAvailableTags = useMemo(() => {
    const tagSet = new Set<string>();
    pastMeetings.forEach((m) => {
      if (m.tags && Array.isArray(m.tags)) {
        m.tags.forEach((t) => {
          if (t && t.trim()) tagSet.add(t.trim());
        });
      }
    });
    return Array.from(tagSet).sort();
  }, [pastMeetings]);

  const filteredMeetings = useMemo(() => {
    let list = pastMeetings;
    if (selectedTag) {
      list = list.filter((m) => m.tags && m.tags.includes(selectedTag));
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.summary.toLowerCase().includes(q) ||
        (m.tags && m.tags.some((t) => t.toLowerCase().includes(q))) ||
        m.segments.some((s) => s.text.toLowerCase().includes(q)),
    );
  }, [pastMeetings, searchQuery, selectedTag]);

  return {
    pastMeetings,
    setPastMeetings,
    selectedMeeting,
    setSelectedMeeting,
    isLoadingMeeting,
    setIsLoadingMeeting,
    searchQuery,
    setSearchQuery,
    selectedTag,
    setSelectedTag,
    allAvailableTags,
    editingMeetingId,
    editingTitleText,
    setEditingTitleText,
    filteredMeetings,
    fetchPastMeetings,
    meetingToDelete,
    setMeetingToDelete,
    handlePromptDeleteMeeting,
    handleConfirmDelete,
    handleCancelDelete,
    handleDeleteMeeting,
    handleStartEditMeetingTitle,
    handleSaveMeetingTitle,
    handleCancelEditMeetingTitle,
    handleAddMeetingTag,
    handleRemoveMeetingTag,
  };
}
