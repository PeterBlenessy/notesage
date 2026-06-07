import { useState, useCallback } from "react";
import { ChevronDown, Braces } from "lucide-react";
import { useEditorStore } from "@/stores/editor-store";
import type { Frontmatter } from "@/lib/frontmatter";

interface FrontmatterBlockProps {
  tabId: string;
  frontmatter: Frontmatter | null;
}

export function FrontmatterBlock({ tabId, frontmatter }: FrontmatterBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { updateFrontmatter } = useEditorStore();

  const handleFieldChange = useCallback(
    (key: string, value: string) => {
      updateFrontmatter(tabId, { [key]: value });
    },
    [tabId, updateFrontmatter]
  );

  if (!frontmatter) return null;

  const entries = Object.entries(frontmatter);

  return (
    <div className="mb-2">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs text-muted-foreground
            hover:bg-muted hover:text-foreground transition-colors duration-150 cursor-pointer"
        >
          <ChevronDown className="h-3 w-3 -rotate-90 transition-transform duration-150" strokeWidth={1.5} />
          <span>Frontmatter</span>
          <Braces className="h-3 w-3" strokeWidth={1.5} />
        </button>
      ) : (
        <div
          className="rounded-lg border bg-muted/50 p-3 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="flex items-center gap-1 mb-2">
            <button
              onClick={() => setIsOpen(false)}
              className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-background
                text-muted-foreground hover:text-foreground transition-colors duration-150 cursor-pointer"
            >
              <ChevronDown className="h-3 w-3 transition-transform duration-150" strokeWidth={1.5} />
            </button>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Frontmatter
            </span>
            <Braces className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div className="space-y-1.5">
            {entries.map(([key, value]) => (
              <FrontmatterField
                key={key}
                fieldKey={key}
                value={value}
                onChange={handleFieldChange}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface FrontmatterFieldProps {
  fieldKey: string;
  value: unknown;
  onChange: (key: string, value: string) => void;
}

function FrontmatterField({ fieldKey, value, onChange }: FrontmatterFieldProps) {
  const isComplex = typeof value === 'object' && value !== null;
  // Arrays of PRIMITIVES (tags etc.) display as a comma list. Arrays containing
  // objects (e.g. a transcript's `segments`) fall through to JSON — `join`
  // would render every entry as "[object Object]".
  const isPrimitiveArray =
    Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null);
  const displayValue = isPrimitiveArray
    ? (value as unknown[]).join(", ")
    : isComplex
      ? JSON.stringify(value)
      : String(value ?? "");

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground min-w-[80px] shrink-0 text-right">
        {fieldKey}
      </label>
      <input
        type="text"
        value={displayValue}
        readOnly={isComplex}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        className={`flex-1 h-6 px-1.5 rounded text-xs bg-background border border-transparent
          focus:border-border focus:outline-none transition-colors duration-150
          text-foreground placeholder:text-muted-foreground${isComplex ? ' opacity-60 cursor-default' : ''}`}
      />
    </div>
  );
}
