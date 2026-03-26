import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Link, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function LinkButton({ editor }: { editor: Editor }) {
  const isLink = editor.isActive("link");
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = useCallback(() => {
    if (isLink) {
      // Already a link — remove it
      editor.chain().focus().unsetLink().run();
      return;
    }
    setUrl(editor.getAttributes("link").href || "");
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [editor, isLink]);

  const handleSubmit = useCallback(() => {
    const raw = url.trim();
    if (!raw) {
      setOpen(false);
      return;
    }

    // Auto-prepend https:// if no protocol specified
    const href = /^https?:\/\/|^mailto:|^tel:|^#/.test(raw) ? raw : `https://${raw}`;

    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    if (hasSelection) {
      editor.chain().focus().setLink({ href }).run();
    } else {
      editor.chain().focus().insertContent({
        type: "text",
        marks: [{ type: "link", attrs: { href } }],
        text: raw,
      }).run();
    }
    setOpen(false);
    setUrl("");
  }, [editor, url]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 w-6 p-0 text-muted-foreground transition-colors duration-150",
                isLink && "bg-accent text-accent-foreground"
              )}
              onClick={(e) => {
                if (isLink) {
                  e.preventDefault();
                  handleOpen();
                }
              }}
              title={isLink ? "Remove link" : "Insert link (Cmd+K)"}
            >
              {isLink ? (
                <Unlink className="size-4" strokeWidth={1.5} />
              ) : (
                <Link className="size-4" strokeWidth={1.5} />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {isLink ? "Remove link" : "Insert link (Cmd+K)"}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-72 p-2" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
              if (e.key === "Escape") { setOpen(false); }
            }}
            placeholder="https://..."
            className="flex-1 h-7 px-2 text-xs rounded-md border border-input bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            autoFocus
          />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSubmit}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
