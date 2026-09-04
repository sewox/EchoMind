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
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState<string>("");
  const [meetingToDelete, setMeetingToDelete] = useState<MeetingRecord | null>(
    null,
  );

  const fetchPastMeetings = async () => {
    try {
      const meetings = await invoke<MeetingRecord[]>("get_all_meetings");
      setPastMeetings(meetings);
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
      setPastMeetings((prev) => prev.filter((m) => m.id !== id));
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
        prev.map((m) => (m.id === meetingId ? { ...m, title: newTitle } : m)),
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

  const filteredMeetings = useMemo(() => {
    if (!searchQuery.trim()) return pastMeetings;
    const q = searchQuery.toLowerCase();
    return pastMeetings.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.summary.toLowerCase().includes(q) ||
        m.segments.some((s) => s.text.toLowerCase().includes(q)),
    );
  }, [pastMeetings, searchQuery]);

  return {
    pastMeetings,
    setPastMeetings,
    selectedMeeting,
    setSelectedMeeting,
    isLoadingMeeting,
    setIsLoadingMeeting,
    searchQuery,
    setSearchQuery,
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
  };
}
