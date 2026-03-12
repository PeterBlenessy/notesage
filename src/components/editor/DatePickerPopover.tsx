import { useEffect, useRef, useState, useCallback } from "react";
import { Calendar } from "@/components/ui/calendar";

interface DatePickerState {
  date: string;
  rect: DOMRect;
}

interface DatePickerPopoverProps {
  /** Called when a new date is selected — receives old date string and new date string */
  onDateChange?: (oldDate: string, newDate: string, rect: DOMRect) => void;
}

export function DatePickerPopover({ onDateChange }: DatePickerPopoverProps) {
  const [state, setState] = useState<DatePickerState | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setState(null), []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ date: string; rect: DOMRect }>).detail;
      setState({ date: detail.date, rect: detail.rect });
    };

    window.addEventListener("notesage:open-date-picker", handler);
    return () => window.removeEventListener("notesage:open-date-picker", handler);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!state) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
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
              onDateChange?.(state.date, newDateStr, state.rect);
            }
            close();
          }
        }}
      />
    </div>
  );
}
