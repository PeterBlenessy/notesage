import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { tauriApi } from "@/lib/tauri";
import { Loader2, Info } from "lucide-react";

interface NewNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentPath: string;
  onCreated: (filePath: string, fileName: string) => void;
}

export function NewNoteDialog({
  open,
  onOpenChange,
  parentPath,
  onCreated,
}: NewNoteDialogProps) {
  const [fileName, setFileName] = useState("untitled.md");
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFileName("untitled.md");
      setError("");
      setIsCreating(false);
      // Select the name part (without extension) after a tick so the input is mounted
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (input) {
          input.focus();
          const dotIndex = "untitled.md".lastIndexOf(".");
          input.setSelectionRange(0, dotIndex > 0 ? dotIndex : "untitled.md".length);
        }
      });
    }
  }, [open]);

  const handleSubmit = async () => {
    const trimmed = fileName.trim();
    if (!trimmed || !parentPath || isCreating) return;

    const finalName = trimmed.includes(".") ? trimmed : `${trimmed}.md`;
    const filePath = `${parentPath}/${finalName}`;

    setIsCreating(true);
    setError("");

    try {
      const exists = await tauriApi.pathExists(filePath);
      if (exists) {
        setError(`"${finalName}" already exists. Choose a different name.`);
        setIsCreating(false);
        // Re-select the name part so user can quickly type a new name
        requestAnimationFrame(() => {
          const input = inputRef.current;
          if (input) {
            input.focus();
            const dotIndex = finalName.lastIndexOf(".");
            input.setSelectionRange(0, dotIndex > 0 ? dotIndex : finalName.length);
          }
        });
        return;
      }

      onCreated(filePath, finalName);
      onOpenChange(false);
    } catch (err) {
      setError(`Failed to create file: ${err}`);
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>New Note</DialogTitle>
          <DialogDescription>
            Create a new file in the current project.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="note-filename">File name</Label>
          <Input
            ref={inputRef}
            id="note-filename"
            value={fileName}
            onChange={(e) => {
              setFileName(e.target.value);
              setError("");
            }}
            onKeyDown={handleKeyDown}
            placeholder="untitled.md"
          />
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2.5 text-sm">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
              <span className="text-muted-foreground">{error}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!fileName.trim() || isCreating}>
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
