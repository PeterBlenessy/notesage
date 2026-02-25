import { useState, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FolderOpen, ImageIcon } from "lucide-react";
import { resolveImageSrc } from "@/lib/image-utils";
import { toast } from "sonner";

interface ImageInsertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (src: string, alt: string) => void;
  /** Current document's directory, used to resolve relative paths for preview. */
  documentDir?: string;
  /** Project root directory. When set, local images are copied to images/ subfolder for portability. */
  projectRoot?: string;
}

export function ImageInsertDialog({
  open: isOpen,
  onOpenChange,
  onInsert,
  documentDir,
  projectRoot,
}: ImageInsertDialogProps) {
  const [tab, setTab] = useState<"url" | "file">("url");
  const [url, setUrl] = useState("");
  const [filePath, setFilePath] = useState("");
  const [alt, setAlt] = useState("");
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setUrl("");
      setFilePath("");
      setAlt("");
      setTab("url");
      requestAnimationFrame(() => urlInputRef.current?.focus());
    }
  }, [isOpen]);

  const handlePickFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"],
        },
      ],
    });

    if (selected) {
      setFilePath(selected);
      // Pre-fill alt text from filename
      if (!alt) {
        const name = selected.split("/").pop() ?? "";
        const noExt = name.replace(/\.[^.]+$/, "");
        setAlt(noExt);
      }
    }
  };

  const handleSubmit = async () => {
    const src = tab === "url" ? url.trim() : filePath;
    if (!src) return;

    if (tab === "file" && projectRoot) {
      // Copy image to project-relative images/ folder for portability
      try {
        const fileName = src.split("/").pop() ?? "image.png";
        const imagesDir = `${projectRoot}/images`;

        // Ensure images/ directory exists
        try {
          await invoke("create_directory", { path: imagesDir });
        } catch {
          // Directory may already exist — that's fine
        }

        // Handle name collisions by adding a numeric suffix
        let destName = fileName;
        let destPath = `${imagesDir}/${destName}`;
        let counter = 1;
        while (await invoke<boolean>("path_exists", { path: destPath })) {
          const ext = fileName.lastIndexOf(".") >= 0 ? fileName.slice(fileName.lastIndexOf(".")) : "";
          const base = fileName.lastIndexOf(".") >= 0 ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;
          destName = `${base}-${counter}${ext}`;
          destPath = `${imagesDir}/${destName}`;
          counter++;
        }

        await invoke("copy_file", { source: src, destination: destPath });
        onInsert(`images/${destName}`, alt.trim());
      } catch (err) {
        console.error("Failed to copy image:", err);
        toast.error("Failed to copy image to project");
        // Fall back to relative path
        const relativePath = documentDir ? toRelativePath(src, documentDir) : src;
        onInsert(relativePath, alt.trim());
      }
    } else if (tab === "file" && documentDir) {
      // No project root — use relative path with portability warning
      const relativePath = toRelativePath(src, documentDir);
      if (relativePath === src) {
        toast.warning("Image uses an absolute path and won't be visible on other devices");
      }
      onInsert(relativePath, alt.trim());
    } else {
      onInsert(src, alt.trim());
    }

    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const currentSrc = tab === "url" ? url.trim() : filePath;
  const previewSrc = currentSrc
    ? resolveImageSrc(currentSrc, documentDir)
    : "";
  const canInsert = currentSrc.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Insert Image</DialogTitle>
          <DialogDescription>
            Add an image from a URL or pick a local file.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "url" | "file")}>
          <TabsList className="w-full">
            <TabsTrigger value="url" className="flex-1">URL</TabsTrigger>
            <TabsTrigger value="file" className="flex-1">Local File</TabsTrigger>
          </TabsList>

          <TabsContent value="url" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="image-url">Image URL</Label>
              <Input
                ref={urlInputRef}
                id="image-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="https://example.com/image.png"
              />
            </div>
          </TabsContent>

          <TabsContent value="file" className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label>File</Label>
              <div className="flex gap-2">
                <Input
                  value={filePath ? filePath.split("/").pop() ?? filePath : ""}
                  readOnly
                  placeholder="No file selected"
                  className="flex-1 text-muted-foreground"
                />
                <Button variant="outline" size="sm" onClick={handlePickFile}>
                  <FolderOpen className="h-4 w-4 mr-1.5" strokeWidth={1.5} />
                  Browse
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="space-y-1.5">
          <Label htmlFor="image-alt">Alt text</Label>
          <Input
            id="image-alt"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the image (optional)"
          />
        </div>

        {previewSrc && (
          <div className="rounded-lg border border-border bg-muted/50 p-3 flex items-center justify-center min-h-[120px] max-h-[200px] overflow-hidden">
            <img
              src={previewSrc}
              alt={alt || "Preview"}
              className="max-w-full max-h-[176px] object-contain rounded"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
              onLoad={(e) => {
                (e.target as HTMLImageElement).style.display = "";
              }}
            />
          </div>
        )}

        {!previewSrc && (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 flex flex-col items-center justify-center gap-2 text-muted-foreground min-h-[120px]">
            <ImageIcon className="h-8 w-8" strokeWidth={1} />
            <span className="text-xs">Image preview</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canInsert}>
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Convert an absolute file path to a relative path from the given directory.
 * Falls back to the absolute path if it's not under the directory.
 */
function toRelativePath(absolutePath: string, baseDir: string): string {
  // Normalize trailing slashes
  const base = baseDir.endsWith("/") ? baseDir : `${baseDir}/`;

  if (absolutePath.startsWith(base)) {
    return `./${absolutePath.slice(base.length)}`;
  }

  // Not under base directory — return absolute path
  return absolutePath;
}
