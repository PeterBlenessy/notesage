import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { ThemeProvider } from "@/components/ThemeProvider";

function generateFilename(content: string): string {
  const firstLine = content.trim().split("\n")[0]?.trim() ?? "";
  if (firstLine.length > 0) {
    // Strip markdown headings
    const clean = firstLine.replace(/^#+\s*/, "");
    // Sanitize for filename
    const sanitized = clean
      .replace(/[/\\:*?"<>|]/g, "")
      .trim()
      .slice(0, 50);
    if (sanitized.length > 0) return `${sanitized}.md`;
  }
  // Fallback to timestamp
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `quick-note-${ts}.md`;
}

function QuickCaptureInner() {
  const [content, setContent] = useState("");
  const [destination, setDestination] = useState("quick-notes");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const projects = useWorkspaceStore((s) => s.projects);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        getCurrentWindow().hide();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSave = useCallback(async () => {
    if (!content.trim() || saving) return;
    setSaving(true);

    try {
      const filename = generateFilename(content);
      let dir: string;
      if (destination === "quick-notes") {
        // Resolve home directory and use Quick Notes folder
        const homeDir = await invoke<string>("get_home_dir");
        dir = `${homeDir}/Notesage/Quick Notes`;
        // Ensure directory exists
        try {
          await invoke("create_directory", { path: dir });
        } catch {
          // May already exist
        }
      } else {
        dir = destination;
      }

      const path = `${dir}/${filename}`;
      await invoke("write_file", { path, content });

      // Reset and hide
      setContent("");
      getCurrentWindow().hide();
    } catch (error) {
      console.error("Failed to save quick note:", error);
    } finally {
      setSaving(false);
    }
  }, [content, destination, saving]);

  // Cmd+Enter to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground p-4 gap-3">
      <div className="text-sm font-medium text-muted-foreground">Quick Note</div>

      <Textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Type your note here..."
        className="flex-1 resize-none text-sm"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Save to:</span>
          <Select value={destination} onValueChange={setDestination}>
            <SelectTrigger className="w-[180px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quick-notes">Quick Notes</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.path} value={p.path}>
                  {p.path.split("/").pop()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {content.trim() ? "⌘↵ to save" : ""}
          </span>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!content.trim() || saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function QuickCapture() {
  return (
    <ThemeProvider>
      <QuickCaptureInner />
    </ThemeProvider>
  );
}
