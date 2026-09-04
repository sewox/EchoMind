import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AudioPlayerBar } from "./AudioPlayerBar";

describe("AudioPlayerBar Component", () => {
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = Math.floor(secs % 60);
    return `${mins.toString().padStart(2, "0")}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  const defaultProps = {
    isPlaying: false,
    audioCurrentTime: 65, // 01:05
    audioDuration: 125, // 02:05
    meetingDuration: 125,
    meetingTitle: "Yönetim Kurulu Toplantısı",
    onTogglePlay: vi.fn(),
    onSeek: vi.fn(),
    formatPlayerTime: formatTime,
  };

  it("renders audio playback controls with formatted time and responds to clicks", () => {
    render(<AudioPlayerBar {...defaultProps} />);

    expect(screen.getByText("Yönetim Kurulu Toplantısı")).toBeInTheDocument();
    expect(screen.getByText("01:05 / 02:05")).toBeInTheDocument();

    const playBtn = screen.getByRole("button", { name: /Oynat/i });
    fireEvent.click(playBtn);
    expect(defaultProps.onTogglePlay).toHaveBeenCalledTimes(1);

    const rangeInput = screen.getByRole("slider");
    expect(rangeInput).toHaveValue("65");

    fireEvent.change(rangeInput, { target: { value: "80" } });
    expect(defaultProps.onSeek).toHaveBeenCalled();
  });

  it("renders pause icon when isPlaying is true", () => {
    render(<AudioPlayerBar {...defaultProps} isPlaying={true} />);

    const pauseBtn = screen.getByRole("button", { name: /Durdur/i });
    expect(pauseBtn).toBeInTheDocument();
  });
});
