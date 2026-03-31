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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { tauriApi } from "@/lib/tauri";
import { Loader2, Info } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStylesStore } from "@/stores/editor-styles-store";
import {
  PRESET_BUNDLES,
  TYPOGRAPHY_VERSION,
  type PresetBundleName,
  type TypographyFile,
} from "@/lib/typography-presets";

type StyleOption = "keep" | PresetBundleName;

const STYLE_OPTIONS: { value: StyleOption; label: string; description: string }[] = [
  { value: "keep", label: "Keep current", description: "Use existing project typography" },
  { value: "default", label: "Default", description: "System fonts, clean modern" },
  { value: "academic", label: "Academic", description: "Source Serif 4, formal traditional" },
  { value: "report", label: "Report", description: "Inter, business structured" },
];

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
  const [selectedStyle, setSelectedStyle] = useState<StyleOption>("keep");
  const [hasTypography, setHasTypography] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Determine if parentPath is within a project
  useEffect(() => {
    if (!open) return;

    const projects = useWorkspaceStore.getState().projects;
    const match = projects.find(
      (p) => parentPath === p.path || parentPath.startsWith(p.path + "/"),
    );
    const matchedPath = match?.path ?? null;
    setProjectPath(matchedPath);

    if (matchedPath) {
      // Check if typography.json already exists
      tauriApi
        .pathExists(`${matchedPath}/.notesage/typography.json`)
        .then((exists) => {
          setHasTypography(exists);
          setSelectedStyle(exists ? "keep" : "default");
        })
        .catch(() => {
          setHasTypography(false);
          setSelectedStyle("default");
        });
    } else {
      setHasTypography(false);
      setSelectedStyle("keep");
    }
  }, [open, parentPath]);

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

      // Write typography.json if a preset is selected and we're in a project
      if (projectPath && selectedStyle !== "keep") {
        try {
          const presets = PRESET_BUNDLES[selectedStyle];
          const file: TypographyFile = { version: TYPOGRAPHY_VERSION, presets };
          // Ensure .notesage directory exists
          const notesageDir = `${projectPath}/.notesage`;
          const dirExists = await tauriApi.pathExists(notesageDir);
          if (!dirExists) {
            await tauriApi.createDirectory(notesageDir);
          }
          await tauriApi.writeFile(
            `${notesageDir}/typography.json`,
            JSON.stringify(file, null, 2),
          );
          // Reload the store so the editor picks up the new presets immediately
          useEditorStylesStore.getState().loadTypography(projectPath);
        } catch (err) {
          console.error("Failed to write typography.json:", err);
        }
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
        <div className="space-y-4">
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

          {projectPath && (
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs font-medium">Typography style</Label>
              <RadioGroup
                value={selectedStyle}
                onValueChange={(v) => setSelectedStyle(v as StyleOption)}
                className="grid gap-1.5"
              >
                {STYLE_OPTIONS.filter(
                  (opt) => opt.value !== "keep" || hasTypography,
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 cursor-pointer transition-colors duration-150 hover:bg-muted"
                  >
                    <RadioGroupItem value={opt.value} />
                    <div className="flex flex-col gap-0">
                      <span className="text-sm font-medium leading-tight">{opt.label}</span>
                      <span className="text-xs text-muted-foreground leading-tight">{opt.description}</span>
                    </div>
                  </label>
                ))}
              </RadioGroup>
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
