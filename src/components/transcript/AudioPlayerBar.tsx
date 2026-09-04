import React from "react";
import { Play, Pause } from "lucide-react";

interface AudioPlayerBarProps {
  isPlaying: boolean;
  audioCurrentTime: number;
  audioDuration: number;
  meetingDuration?: number;
  meetingTitle?: string;
  onTogglePlay: () => void;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  formatPlayerTime: (secs: number) => string;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  isPlaying,
  audioCurrentTime,
  audioDuration,
  meetingDuration,
  meetingTitle,
  onTogglePlay,
  onSeek,
  formatPlayerTime,
}) => {
  const totalDuration = audioDuration || meetingDuration || 100;

  return (
    <div className="px-6 py-3 border-b border-white/10 bg-slate-950/90 flex items-center justify-between gap-4 flex-wrap select-none">
      <div className="flex items-center gap-3">
        <button
          onClick={onTogglePlay}
          className="w-9 h-9 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center shadow-md shadow-cyan-600/30 transition transform active:scale-95"
          title={isPlaying ? "Durdur" : "Oynat"}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-white" />
          ) : (
            <Play className="w-4 h-4 fill-white ml-0.5" />
          )}
        </button>
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-white truncate max-w-[200px] sm:max-w-xs">
            {meetingTitle || "Toplantı Ses Kaydı"}
          </span>
          <span className="text-[11px] text-slate-400 font-mono">
            {formatPlayerTime(audioCurrentTime)} /{" "}
            {formatPlayerTime(totalDuration)}
          </span>
        </div>
      </div>

      {/* Scrubber Range */}
      <div className="flex-1 min-w-[200px] flex items-center gap-2.5">
        <span className="text-xs 2xl:text-sm font-mono text-slate-400 min-w-[44px]">
          {formatPlayerTime(audioCurrentTime)}
        </span>
        <input
          type="range"
          min={0}
          max={totalDuration}
          step={0.1}
          value={audioCurrentTime}
          onChange={onSeek}
          className="flex-1 accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
        />
        <span className="text-xs 2xl:text-sm font-mono text-slate-400 min-w-[44px]">
          {formatPlayerTime(totalDuration)}
        </span>
      </div>
    </div>
  );
};
