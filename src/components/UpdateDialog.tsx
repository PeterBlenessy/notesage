import { ArrowUpCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import type { UpdateInfo, UpdateStatus } from "@/hooks/useAutoUpdate";

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateInfo | null;
  status: UpdateStatus;
  progress: number | null;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateDialog({
  open,
  onOpenChange,
  updateInfo,
  status,
  progress,
  onInstall,
  onDismiss,
}: UpdateDialogProps) {
  if (!updateInfo) return null;

  const isDownloading = status === "downloading";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <ArrowUpCircle className="h-5 w-5 text-foreground" strokeWidth={1.5} />
            <div>
              <DialogTitle>Update Available</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                v{updateInfo.currentVersion} → v{updateInfo.version}
              </p>
            </div>
          </div>
        </DialogHeader>

        {updateInfo.notes && (
          <ScrollArea className="max-h-48 rounded-md border border-border p-3">
            <div className="prose prose-sm dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-a:text-foreground prose-strong:text-foreground max-w-none text-xs leading-relaxed [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0">
              <ReactMarkdown>{updateInfo.notes}</ReactMarkdown>
            </div>
          </ScrollArea>
        )}

        {isDownloading ? (
          <div className="space-y-2 py-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Downloading update...</span>
              {progress !== null && <span>{progress}%</span>}
            </div>
            <Progress value={progress ?? 0} className="h-1.5" />
          </div>
        ) : (
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onDismiss();
                onOpenChange(false);
              }}
            >
              Later
            </Button>
            <Button onClick={onInstall}>
              Install & Restart
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
