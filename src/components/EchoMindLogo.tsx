import React from "react";

interface IconProps {
  className?: string;
  size?: number;
}

// Stitch Official Brain Wave Icon (Separated Icon)
export const EchoMindIcon: React.FC<IconProps> = ({
  className = "w-9 h-9",
}) => {
  return (
    <img
      src="/echomind-icon.png"
      alt="EchoMind Icon"
      className={`object-contain rounded-lg transition-transform duration-200 hover:scale-105 ${className}`}
    />
  );
};

// Full Header Brand Combo (Stitch Brain Icon + Separated Typography)
export const EchoMindLogo: React.FC<{
  className?: string;
  showTagline?: boolean;
}> = ({ className = "", showTagline = false }) => {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Stitch Official Separated Brain Wave Icon */}
      <EchoMindIcon className="w-9 h-9 shrink-0 drop-shadow-md" />

      {/* Separated Clean Typography */}
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-white text-lg tracking-tight font-sans">
            EchoMind
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 font-normal border border-white/5">
            v0.1.0
          </span>
        </div>
        {showTagline && (
          <span className="text-[11px] text-slate-400 tracking-normal">
            Serene Offline Assistant
          </span>
        )}
      </div>
    </div>
  );
};

export default EchoMindLogo;
