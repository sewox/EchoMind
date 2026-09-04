import React, { useEffect, useState, useRef } from "react";
import { Copy, CheckSquare, Sparkles, Settings } from "lucide-react";

interface CustomContextMenuProps {
  onOpenAssistant: () => void;
  onOpenSettings: () => void;
}

export const CustomContextMenu: React.FC<CustomContextMenuProps> = ({
  onOpenAssistant,
  onOpenSettings,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [position, setPosition] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [hasSelection, setHasSelection] = useState<boolean>(false);
  const [selectedText, setSelectedText] = useState<string>("");
  const menuRef = useRef<HTMLDivElement>(null);

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);
  const modKey = isMac ? "⌘" : "Ctrl+";

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const selection = window.getSelection()?.toString() || "";
      setHasSelection(selection.length > 0);
      setSelectedText(selection);

      // Adjust position if close to screen edges
      const menuWidth = 220;
      const menuHeight = 240;
      let x = e.clientX;
      let y = e.clientY;

      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
      }
      if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 10;
      }

      setPosition({ x, y });
      setIsOpen(true);
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("click", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (selectedText) {
      navigator.clipboard.writeText(selectedText);
    }
    setIsOpen(false);
  };

  const handleSelectAll = () => {
    document.execCommand("selectAll", false);
    setIsOpen(false);
  };

  return (
    <div
      ref={menuRef}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      className="fixed z-[9999] w-56 rounded-2xl bg-slate-900/95 border border-cyan-500/30 shadow-2xl shadow-cyan-950/80 p-1.5 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100 text-xs select-none"
    >
      {/* EchoMind Header Label */}
      <div className="px-3 py-1.5 border-b border-white/10 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
        <span>EchoMind AI</span>
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
      </div>

      <div className="py-1 space-y-0.5">
        {/* Copy */}
        <button
          onClick={handleCopy}
          disabled={!hasSelection}
          className={`w-full px-3 py-2 rounded-xl flex items-center justify-between transition ${
            hasSelection
              ? "text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-200"
              : "text-slate-500 opacity-50 cursor-not-allowed"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Copy className="w-3.5 h-3.5 text-cyan-400" />
            <span>Kopyala</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">
            {modKey}C
          </span>
        </button>

        {/* Select All */}
        <button
          onClick={handleSelectAll}
          className="w-full px-3 py-2 rounded-xl text-slate-200 hover:bg-white/10 flex items-center justify-between transition"
        >
          <div className="flex items-center gap-2.5">
            <CheckSquare className="w-3.5 h-3.5 text-slate-400" />
            <span>Tümünü Seç</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">
            {modKey}A
          </span>
        </button>

        <div className="my-1 border-t border-white/10" />

        {/* Open AI Assistant */}
        <button
          onClick={() => {
            setIsOpen(false);
            onOpenAssistant();
          }}
          className="w-full px-3 py-2 rounded-xl text-cyan-200 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/20 hover:border-cyan-500/40 flex items-center justify-between transition font-medium"
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Toplantı Asistanı</span>
          </div>
          <span className="text-[10px] font-mono text-cyan-400">{modKey}K</span>
        </button>

        {/* Settings */}
        <button
          onClick={() => {
            setIsOpen(false);
            onOpenSettings();
          }}
          className="w-full px-3 py-2 rounded-xl text-slate-200 hover:bg-white/10 flex items-center justify-between transition"
        >
          <div className="flex items-center gap-2.5">
            <Settings className="w-3.5 h-3.5 text-slate-400" />
            <span>Ayarlar & Tercihler</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">
            {modKey},
          </span>
        </button>
      </div>
    </div>
  );
};
