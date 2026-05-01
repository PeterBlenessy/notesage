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
import { Checkbox } from "@/components/ui/checkbox";
import { tauriApi } from "@/lib/tauri";
import { serializeFrontmatter } from "@/lib/frontmatter";
import { PROJECT_TEMPLATES, type ProjectTemplate } from "@/lib/project-templates";
import { getGoalTemplate } from "@/lib/goal-templates";
import { useSettingsStore } from "@/stores/settings-store";
import { FolderOpen, Loader2, Info, Cloud } from "lucide-react";

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
  const [isCustomLocation, setIsCustomLocation] = useState(false);
  const [syncToICloud, setSyncToICloud] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate>(PROJECT_TEMPLATES[0]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { notesRootPath, icloudAvailable, icloudNotesagePath } = useSettingsStore();

  // The "Create in iCloud Drive" checkbox shows whenever iCloud Drive is
  // detected at the OS level. There is no separate global iCloud-enabled
  // toggle to gate on — sync state is derived from the path the project
  // ends up at.
  const showICloudCheckbox = icloudAvailable && !isCustomLocation;

  useEffect(() => {
    if (open) {
      setProjectName("");
      setLocation(notesRootPath);
      setIsCustomLocation(false);
      setSyncToICloud(icloudAvailable);
      setSelectedTemplate(PROJECT_TEMPLATES[0]);
      setError("");
      setIsCreating(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open, notesRootPath, icloudAvailable]);

  const handleChooseLocation = async () => {
    try {
      const folderPath = await tauriApi.openFolderDialog();
      if (folderPath) {
        setLocation(folderPath);
        setIsCustomLocation(true);
        setSyncToICloud(false);
        setError("");
      }
    } catch (err) {
      console.error("Failed to open folder dialog:", err);
    }
  };

  const handleResetLocation = () => {
    setLocation(notesRootPath);
    setIsCustomLocation(false);
    setSyncToICloud(icloudAvailable);
    setError("");
  };

  const handleSubmit = async () => {
    const trimmedName = projectName.trim();
    if (!trimmedName || !location || isCreating) return;

    setIsCreating(true);
    setError("");

    // Determine actual creation location
    const effectiveLocation = syncToICloud && icloudNotesagePath
      ? icloudNotesagePath
      : location;

    const projectPath = `${effectiveLocation}/${trimmedName}`;

    try {
      // Ensure the parent directory exists (e.g., iCloud/Notesage)
      const parentExists = await tauriApi.pathExists(effectiveLocation);
      if (!parentExists) {
        await tauriApi.createDirectory(effectiveLocation);
      }

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

      // No sync-state bookkeeping — the project's path determines whether
      // it's synced (under iCloud Notesage = synced, anywhere else = local).
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

  // Display-friendly location label
  const locationLabel = isCustomLocation
    ? location
    : syncToICloud
      ? "iCloud Drive/Notesage"
      : "~/Notesage";

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
                    className={`w-full text-left rounded-md border px-3 py-2.5 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
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

          {/* Location */}
          <div className="space-y-2">
            <Label htmlFor="project-location">Location</Label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-background text-sm min-w-0">
                {syncToICloud && (
                  <Cloud className="h-3.5 w-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                )}
                <span className="truncate text-muted-foreground">{locationLabel}</span>
              </div>
              {isCustomLocation ? (
                <Button
                  variant="outline"
                  onClick={handleResetLocation}
                  className="shrink-0"
                >
                  Reset
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={handleChooseLocation}
                  className="shrink-0"
                >
                  <FolderOpen className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
                  Change...
                </Button>
              )}
            </div>
          </div>

          {/* iCloud sync checkbox */}
          {showICloudCheckbox && (
            <div className="flex items-center gap-2.5 px-1">
              <Checkbox
                id="sync-to-icloud"
                checked={syncToICloud}
                onCheckedChange={(checked) => setSyncToICloud(checked === true)}
              />
              <Label
                htmlFor="sync-to-icloud"
                className="text-sm font-medium cursor-pointer"
              >
                Sync to iCloud
              </Label>
            </div>
          )}

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
