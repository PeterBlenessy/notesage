import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SidebarInlineEditProps {
  mode: "rename" | "create";
  initialValue?: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  validate?: (value: string) => string | null;
  className?: string;
}

export function SidebarInlineEdit({
  mode,
  initialValue = "",
  placeholder,
  onCommit,
  onCancel,
  validate,
  className,
}: SidebarInlineEditProps) {
  const [value, setValue] = useState(mode === "rename" ? initialValue : "");
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (mode === "rename") {
      input.select();
    } else {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }, [mode]);

  function finish(action: () => void) {
    if (settledRef.current) return;
    settledRef.current = true;
    action();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        finish(onCancel);
        return;
      }
      if (validate) {
        const message = validate(trimmed);
        if (message !== null) {
          setValidationError(message);
          return;
        }
      }
      finish(() => onCommit(trimmed));
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      finish(onCancel);
    }
  }

  function handleBlur() {
    finish(onCancel);
  }

  const errorId = "sidebar-inline-edit-error";

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (validationError) setValidationError(null);
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        aria-label={mode === "rename" ? "Rename" : "Create"}
        aria-invalid={validationError ? true : undefined}
        aria-describedby={validationError ? errorId : undefined}
        className="h-7 px-2 py-0 text-sm"
      />
      {validationError ? (
        <span
          id={errorId}
          role="alert"
          className="text-xs text-destructive px-2"
        >
          {validationError}
        </span>
      ) : null}
    </div>
  );
}
