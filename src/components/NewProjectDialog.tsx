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
import { serializeFrontmatter } from "@/lib/frontmatter";
import { PROJECT_TEMPLATES, type ProjectTemplate } from "@/lib/project-templates";
import { getGoalTemplate } from "@/lib/goal-templates";
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
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate>(PROJECT_TEMPLATES[0]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setProjectName("");
      setLocation("");
      setSelectedTemplate(PROJECT_TEMPLATES[0]);
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
    if (!trimmedName || !location || isCreating) return;

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

      // Create project directory
      await tauriApi.createDirectory(projectPath);

      // Create template folders
      for (const folder of selectedTemplate.folders) {
        await tauriApi.createDirectory(`${projectPath}/${folder}`);
      }

      // Create goal file if template specifies one
      if (selectedTemplate.goalTemplate && selectedTemplate.goalFilename) {
        const goalTemplate = getGoalTemplate(selectedTemplate.goalTemplate);
        if (goalTemplate) {
          const frontmatter = {
            type: "goal" as const,
            template: goalTemplate.id,
            created: new Date().toISOString().split("T")[0],
            title: goalTemplate.name,
          };

          // If goal filename includes a directory, ensure it exists
          const goalDir = selectedTemplate.goalFilename.split("/").slice(0, -1).join("/");
          if (goalDir) {
            const goalDirPath = `${projectPath}/${goalDir}`;
            const dirExists = await tauriApi.pathExists(goalDirPath);
            if (!dirExists) {
              await tauriApi.createDirectory(goalDirPath);
            }
          }

          const fileContent = serializeFrontmatter(frontmatter, goalTemplate.content);
          await tauriApi.writeFile(`${projectPath}/${selectedTemplate.goalFilename}`, fileContent);
        }
      }

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
      <DialogContent className="sm:max-w-[480px]">
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

          {/* Template picker */}
          <div className="space-y-2">
            <Label>Template</Label>
            <div className="space-y-2">
              {PROJECT_TEMPLATES.map((template) => {
                const isSelected = selectedTemplate.id === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setSelectedTemplate(template)}
                    className={`w-full text-left rounded-md border px-3 py-2.5 transition-all duration-150 ease-in-out cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                      isSelected
                        ? "border-foreground/30 bg-muted"
                        : "border-border hover:bg-muted/50 hover:border-border"
                    }`}
                  >
                    <div className="text-sm font-medium">{template.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {template.description}
                    </div>
                  </button>
                );
              })}
            </div>
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
          <Button onClick={handleSubmit} disabled={!canCreate}>
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
