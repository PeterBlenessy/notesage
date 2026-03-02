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
import { Info, Loader2 } from "lucide-react";

interface NewFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentPath: string;
  onCreated: (folderPath: string) => void;
}

export function NewFolderDialog({
  open,
  onOpenChange,
  parentPath,
  onCreated,
}: NewFolderDialogProps) {
  const [folderName, setFolderName] = useState("New Folder");
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFolderName("New Folder");
      setError("");
      setIsCreating(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open]);

  const handleSubmit = async () => {
    const trimmed = folderName.trim();
    if (!trimmed || !parentPath || isCreating) return;

    const folderPath = `${parentPath}/${trimmed}`;

    setIsCreating(true);
    setError("");

    try {
      const exists = await tauriApi.pathExists(folderPath);
      if (exists) {
        setError(`A folder named "${trimmed}" already exists here.`);
        setIsCreating(false);
        return;
      }
      await tauriApi.createDirectory(folderPath);
      onCreated(folderPath);
      onOpenChange(false);
    } catch (err) {
      setError(`Failed to create folder: ${err}`);
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
          <DialogTitle>New Folder</DialogTitle>
          <DialogDescription>
            Create a new folder in this directory.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input
              ref={inputRef}
              id="folder-name"
              value={folderName}
              onChange={(e) => {
                setFolderName(e.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              placeholder="My Folder"
            />
          </div>
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2.5 text-sm">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" strokeWidth={1.5} />
              <span className="text-muted-foreground">{error}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!folderName.trim() || isCreating}>
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
