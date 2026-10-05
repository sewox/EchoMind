import React from "react";
import { X, type LucideIcon } from "lucide-react";

/** Locale labels often start with an emoji; the icon next to them already shows it. */
export const stripLeadingEmoji = (label: string) =>
  label.replace(/^[\p{Extended_Pictographic}️‍\s]+/u, "");

export interface ModalTab<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
  /** Small extra marker after the label (e.g. a lock). */
  badge?: React.ReactNode;
}

const WIDTHS = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
} as const;

const GRID_COLS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

interface ModalShellProps<T extends string> {
  onClose: () => void;
  icon: LucideIcon;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Shown next to the title. */
  badge?: React.ReactNode;
  size?: keyof typeof WIDTHS;
  /**
   * `fixed`: the window keeps one height while switching tabs (tabbed
   * modals). `auto`: it grows with its content up to 90% of the screen.
   */
  height?: "fixed" | "auto";
  tone?: "default" | "danger";
  tabs?: ModalTab<T>[];
  activeTab?: T;
  onTabChange?: (id: T) => void;
  /** Always visible below the body. */
  footer?: React.ReactNode;
  /**
   * The body is the only scroll area. Pass `false` when the content
   * manages its own scrolling (e.g. a text area that fills the window).
   */
  scrollBody?: boolean;
  closeOnBackdrop?: boolean;
  /** While true (e.g. a job is running) the window cannot be closed. */
  closeDisabled?: boolean;
  closeLabel?: string;
  /** Sets `<id>-backdrop`, `<id>` (window) and `<id>-close-btn` test ids. */
  testId?: string;
  children: React.ReactNode;
}

/**
 * The shared window frame: fixed header, optional one-row tabs, a single
 * scrolling body and a footer that never scrolls away.
 */
export function ModalShell<T extends string>({
  onClose,
  icon: Icon,
  title,
  subtitle,
  badge,
  size = "md",
  height = "auto",
  tone = "default",
  tabs,
  activeTab,
  onTabChange,
  footer,
  scrollBody = true,
  closeOnBackdrop = true,
  closeDisabled = false,
  closeLabel = "Kapat",
  testId,
  children,
}: ModalShellProps<T>) {
  const danger = tone === "danger";
  return (
    <div
      data-testid={testId && `${testId}-backdrop`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={(e) => {
        if (closeOnBackdrop && !closeDisabled && e.target === e.currentTarget)
          onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid={testId}
        className={`w-full ${WIDTHS[size]} ${
          height === "fixed" ? "h-[90vh] max-h-[760px]" : "max-h-[90vh]"
        } bg-slate-900 border ${
          danger ? "border-rose-500/30" : "border-slate-800"
        } rounded-3xl shadow-2xl shadow-slate-950/60 p-6 relative overflow-hidden flex flex-col text-slate-100 cursor-default`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`shrink-0 p-2.5 rounded-2xl border ${
                danger
                  ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                  : "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
              }`}
            >
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="font-bold text-white text-base truncate">
                  {title}
                </h3>
                {badge}
              </div>
              {subtitle && (
                <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label={closeLabel}
            title={closeLabel}
            data-testid={testId && `${testId}-close-btn`}
            className="shrink-0 p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {tabs && tabs.length > 0 && (
          <div
            role="tablist"
            className={`shrink-0 grid ${
              GRID_COLS[tabs.length] ?? "grid-flow-col auto-cols-fr"
            } gap-1.5 border-b border-slate-800/80 mb-4 pb-2`}
          >
            {tabs.map((tab) => {
              const TabIcon = tab.icon;
              const isActive = tab.id === activeTab;
              const label = stripLeadingEmoji(tab.label).replace(
                /\s*(\.\.\.|…)$/,
                "",
              );
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  title={label}
                  onClick={() => onTabChange?.(tab.id)}
                  className={`min-w-0 flex items-center justify-center gap-2 px-2 py-2 text-xs font-semibold rounded-xl border transition cursor-pointer ${
                    isActive
                      ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300"
                      : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <TabIcon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? "text-cyan-400" : "text-slate-500"
                    }`}
                  />
                  <span className="truncate">{label}</span>
                  {tab.badge}
                </button>
              );
            })}
          </div>
        )}

        <div
          className={`flex-1 min-h-0 ${
            scrollBody
              ? "overflow-y-auto pr-1 space-y-4"
              : "flex flex-col gap-4 overflow-hidden"
          }`}
        >
          {children}
        </div>

        {footer && (
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4 mt-4 text-xs">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
