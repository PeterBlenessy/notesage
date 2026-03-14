import { useEffect, useRef, useState, useCallback } from "react";
import { Calendar } from "@/components/ui/calendar";

interface DatePickerState {
  date: string;
  rect: DOMRect;
  from: number;
  to: number;
}

interface DatePickerPopoverProps {
  /** Called when a new date is selected — receives old date string, new date string, and ProseMirror position range */
  onDateChange?: (oldDate: string, newDate: string, from: number, to: number) => void;
}

export function DatePickerPopover({ onDateChange }: DatePickerPopoverProps) {
  const [state, setState] = useState<DatePickerState | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setState(null), []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ date: string; rect: DOMRect; from: number; to: number }>).detail;
      setState({ date: detail.date, rect: detail.rect, from: detail.from, to: detail.to });
    };

    window.addEventListener("notesage:open-date-picker", handler);
    return () => window.removeEventListener("notesage:open-date-picker", handler);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!state) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // If the target was removed from DOM by React re-render, don't treat as outside click
      if (!target.isConnected) return;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        close();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [state, close]);

  if (!state) return null;

  // Parse the current date
  const [year, month, day] = state.date.split("-").map(Number);
  const selectedDate = new Date(year, month - 1, day);

  // Position below the badge
  const top = state.rect.bottom + 4;
  const left = state.rect.left;

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 rounded-lg border border-border bg-popover shadow-lg"
      style={{ top, left }}
    >
      <Calendar
        mode="single"
        selected={selectedDate}
        defaultMonth={selectedDate}
        onSelect={(date) => {
          if (date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, "0");
            const d = String(date.getDate()).padStart(2, "0");
            const newDateStr = `${y}-${m}-${d}`;
            if (newDateStr !== state.date) {
              onDateChange?.(state.date, newDateStr, state.from, state.to);
            }
            close();
          }
        }}
      />
    </div>
  );
}
