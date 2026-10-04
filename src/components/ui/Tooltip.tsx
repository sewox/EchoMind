import React, { useEffect, useId, useRef, useState } from "react";

const SHOW_DELAY_MS = 250;

const ALIGN = {
  start: { bubble: "left-0", arrow: "left-4" },
  center: { bubble: "left-1/2 -translate-x-1/2", arrow: "left-1/2 -ml-1" },
  end: { bubble: "right-0", arrow: "right-4" },
} as const;

interface TooltipProps {
  title: string;
  description?: string;
  /** Which edge of the trigger the bubble lines up with (keeps it on screen near the edges). */
  align?: keyof typeof ALIGN;
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
}

/**
 * A small bubble above its trigger with a name and a one-line purpose.
 * Shows on hover (after a short delay) and right away on keyboard focus.
 */
export function Tooltip({
  title,
  description,
  align = "center",
  children,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (delay: number) => {
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };
  useEffect(() => clear, []);

  const trigger = React.cloneElement(children, {
    "aria-describedby": open ? id : undefined,
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      children.props.onFocus?.(e);
      show(0);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      children.props.onBlur?.(e);
      hide();
    },
  });

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => show(SHOW_DELAY_MS)}
      onMouseLeave={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
    >
      {trigger}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={`pointer-events-none absolute bottom-full mb-2.5 z-50 w-max max-w-[240px] rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-2 text-left shadow-xl shadow-black/40 backdrop-blur-sm animate-in fade-in duration-150 ${ALIGN[align].bubble}`}
        >
          <span className="block text-xs font-semibold text-white">
            {title}
          </span>
          {description && (
            <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
              {description}
            </span>
          )}
          <span
            aria-hidden="true"
            className={`absolute top-full -mt-1 h-2 w-2 rotate-45 border-b border-r border-slate-700 bg-slate-950 ${ALIGN[align].arrow}`}
          />
        </span>
      )}
    </span>
  );
}
