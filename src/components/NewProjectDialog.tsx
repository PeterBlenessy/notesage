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
import { FolderOpen, Loader2, Info } from "lucide-react";

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (projectPath: string) => void;
}

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: NewProjectDialogProps) {
  const [projectName, setProjectName] = useState("");
  const [location, setLocation] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setProjectName("");
      setLocation("");
      setError("");
      setIsCreating(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  const handleChooseLocation = async () => {
    try {
      const folderPath = await tauriApi.openFolderDialog();
      if (folderPath) {
        setLocation(folderPath);
        setError("");
      }
    } catch (err) {
      console.error("Failed to open folder dialog:", err);
    }
  };

  const handleSubmit = async () => {
    const trimmedName = projectName.trim();
    if (!trimmedName || !location) return;

    setIsCreating(true);
    setError("");

    const projectPath = `${location}/${trimmedName}`;

    try {
      const exists = await tauriApi.pathExists(projectPath);
      if (exists) {
        setError("A folder with this name already exists at that location. Choose a different name.");
        setIsCreating(false);
        return;
      }

      await tauriApi.createDirectory(projectPath);
      onCreated(projectPath);
      onOpenChange(false);
    } catch (err) {
      setError(`Failed to create project: ${err}`);
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canCreate = projectName.trim() && location && !isCreating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>
            Create a new project folder with Notesage configuration.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              ref={inputRef}
              id="project-name"
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              placeholder="My Notes"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-location">Location</Label>
            <div className="flex gap-2">
              <Input
                id="project-location"
                value={location}
                readOnly
                placeholder="Choose a folder..."
                className="flex-1 cursor-default"
              />
              <Button
                variant="outline"
                onClick={handleChooseLocation}
                className="shrink-0"
              >
                <FolderOpen className="h-4 w-4 mr-1.5" />
                Choose...
              </Button>
            </div>
          </div>
          {error && (
            <div className="flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
            >
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
              <span className="text-muted-foreground">{error}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleSubmit} disabled={!canCreate}>
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Project"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
