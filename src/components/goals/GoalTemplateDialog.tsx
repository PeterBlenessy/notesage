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
import { GOAL_TEMPLATES, type GoalTemplate } from "@/lib/goal-templates";
import { Target, Loader2, Info } from "lucide-react";

interface GoalTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  onCreated?: (filePath: string) => void;
}

type LocationOption = "root" | "goals-folder";

function templateToFilename(template: GoalTemplate): string {
  // Convert template name to a kebab-case filename
  // e.g. "OKR (Objectives & Key Results)" -> "okr-objectives-key-results"
  // Simpler: just use the template id as the base
  return `${template.id}-goals`;
}

export function GoalTemplateDialog({
  open,
  onOpenChange,
  projectPath,
  onCreated,
}: GoalTemplateDialogProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<GoalTemplate | null>(
    null
  );
  const [filename, setFilename] = useState("");
  const [location, setLocation] = useState<LocationOption>("root");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const filenameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSelectedTemplate(null);
      setFilename("");
      setLocation("root");
      setIsCreating(false);
      setError("");
    }
  }, [open]);

  const handleSelectTemplate = (template: GoalTemplate) => {
    setSelectedTemplate(template);
    setFilename(templateToFilename(template));
    setError("");
    // Focus the filename input after selecting a template
    requestAnimationFrame(() => {
      const input = filenameRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(0, templateToFilename(template).length);
      }
    });
  };

  const handleCreate = async () => {
    const trimmedFilename = filename.trim();
    if (!selectedTemplate || !trimmedFilename || isCreating) return;

    setIsCreating(true);
    setError("");

    try {
      // Build directory path
      let dirPath = projectPath;
      if (location === "goals-folder") {
        dirPath = `${projectPath}/goals`;
        const dirExists = await tauriApi.pathExists(dirPath);
        if (!dirExists) {
          await tauriApi.createDirectory(dirPath);
        }
      }

      // Build file path with .md extension
      const fullFilename = trimmedFilename.endsWith(".md")
        ? trimmedFilename
        : `${trimmedFilename}.md`;
      const filePath = `${dirPath}/${fullFilename}`;

      // Check if file already exists
      const exists = await tauriApi.pathExists(filePath);
      if (exists) {
        setError(
          `"${fullFilename}" already exists. Choose a different name.`
        );
        setIsCreating(false);
        return;
      }

      // Build frontmatter
      const frontmatter = {
        type: "goal" as const,
        template: selectedTemplate.id,
        created: new Date().toISOString().split("T")[0],
        title: selectedTemplate.name,
      };

      // Combine frontmatter + template content
      const fileContent = serializeFrontmatter(frontmatter, selectedTemplate.content);

      // Write the file
      await tauriApi.writeFile(filePath, fileContent);

      // Notify parent and close
      onCreated?.(filePath);
      onOpenChange(false);
    } catch (err) {
      setError(`Failed to create goals file: ${err}`);
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    }
  };

  const canCreate = selectedTemplate && filename.trim() && !isCreating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            New Goals File
          </DialogTitle>
          <DialogDescription>
            Choose a template to add a goals file to your project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Template cards */}
          <div className="space-y-2">
            <Label>Template</Label>
            <div className="space-y-2">
              {GOAL_TEMPLATES.map((template) => {
                const isSelected = selectedTemplate?.id === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleSelectTemplate(template)}
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

          {/* Filename input */}
          <div className="space-y-2">
            <Label htmlFor="goal-filename">File name</Label>
            <div className="flex items-center gap-1.5">
              <Input
                ref={filenameRef}
                id="goal-filename"
                value={filename}
                onChange={(e) => {
                  setFilename(e.target.value);
                  setError("");
                }}
                onKeyDown={handleKeyDown}
                placeholder="project-goals"
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground shrink-0">.md</span>
            </div>
          </div>

          {/* Location toggle */}
          <div className="space-y-2">
            <Label>Location</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLocation("root")}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-all duration-150 ease-in-out cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  location === "root"
                    ? "border-foreground/30 bg-muted font-medium"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                Project root
              </button>
              <button
                type="button"
                onClick={() => setLocation("goals-folder")}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-all duration-150 ease-in-out cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  location === "goals-folder"
                    ? "border-foreground/30 bg-muted font-medium"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                goals/ folder
              </button>
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div
              className="flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-muted)",
              }}
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
          <Button onClick={handleCreate} disabled={!canCreate}>
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
