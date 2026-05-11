import { ArrowUpCircle, Sparkles, Bug, Zap, ChevronDown } from "lucide-react";
import { renderInlineMarkdown } from "@/lib/render-inline-markdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChangelog, type Release } from "@/hooks/useChangelog";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { UpdateInfo, UpdateStatus } from "@/hooks/useAutoUpdate";

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateInfo: UpdateInfo | null;
  status: UpdateStatus;
  progress: number | null;
  onInstall: () => void;
  onRestartNow: () => void;
  onDismiss: () => void;
}

function VersionRelease({ release }: { release: Release }) {
  const [expanded, setExpanded] = useState(true);

  const hasMultipleSections =
    (release.sections.features?.length ?? 0) +
      (release.sections.fixes?.length ?? 0) +
      (release.sections.improvements?.length ?? 0) >
    0;

  if (!hasMultipleSections) return null;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className="text-xs font-medium text-foreground">
          v{release.version}
        </span>
        {release.date && (
          <span className="text-[10px] text-muted-foreground">
            {release.date}
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-3 w-3 text-muted-foreground ml-auto transition-transform duration-150",
            expanded && "rotate-180"
          )}
          strokeWidth={1.5}
        />
      </button>

      {expanded && (
        <div className="space-y-2 pl-0.5">
          <SectionItems
            icon={Sparkles}
            items={release.sections.features}
          />
          <SectionItems
            icon={Bug}
            items={release.sections.fixes}
          />
          <SectionItems
            icon={Zap}
            items={release.sections.improvements}
          />
        </div>
      )}
    </div>
  );
}

function SectionItems({
  icon: Icon,
  items,
}: {
  icon: typeof Sparkles;
  items?: string[];
}) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex gap-1.5 text-xs text-muted-foreground leading-relaxed"
        >
          <Icon className="h-3 w-3 shrink-0 mt-0.5" strokeWidth={1.5} />
          <span>{renderInlineMarkdown(item)}</span>
        </li>
      ))}
    </ul>
  );
}

export function UpdateDialog({
  open,
  onOpenChange,
  updateInfo,
  status,
  progress,
  onInstall,
  onRestartNow,
  onDismiss,
}: UpdateDialogProps) {
  if (!updateInfo) return null;

  const { getChangesBetween } = useChangelog();
  const isDownloading = status === "downloading";
  const isDownloaded = status === "downloaded";

  // "Leave alpha" downgrade — different copy / different confirmation. The
  // user is on a prerelease binary, switched to Stable, and the latest stable
  // is older than their current alpha. Treat this as an explicit channel
  // exit, not as a normal update offer.
  const isLeaveAlphaDowngrade = updateInfo.isLeaveAlphaDowngrade === true;

  const releases = getChangesBetween(
    updateInfo.currentVersion,
    updateInfo.version
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <ArrowUpCircle
              className="h-5 w-5 text-foreground"
              strokeWidth={1.5}
            />
            <div>
              <DialogTitle>
                {isDownloaded
                  ? "Ready to Restart"
                  : isLeaveAlphaDowngrade
                    ? "Switch back to Stable?"
                    : "Update Available"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                v{updateInfo.currentVersion} → v{updateInfo.version}
                {isLeaveAlphaDowngrade && " (downgrade)"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isLeaveAlphaDowngrade && !isDownloading && !isDownloaded ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
            <p>
              You're running an alpha build on the Stable channel. Switching
              back to Stable will install <strong>v{updateInfo.version}</strong>,
              which is older than your current build.
            </p>
            <p>
              Settings or data added by alpha versions may not carry over.
              You can also stay on the alpha and wait for a stable release
              newer than yours — Notesage will offer that automatically.
            </p>
          </div>
        ) : null}

        <ScrollArea className="max-h-96 rounded-md border border-border p-3">
          {releases.length > 0 ? (
            <div className="space-y-3">
              {releases.map((release) => (
                <VersionRelease key={release.version} release={release} />
              ))}
            </div>
          ) : updateInfo.notes ? (
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {updateInfo.notes}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {isLeaveAlphaDowngrade
                ? `Release notes for v${updateInfo.version}.`
                : "A new version is available."}
            </p>
          )}
        </ScrollArea>

        {isDownloading ? (
          <div className="space-y-2 py-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {isLeaveAlphaDowngrade ? "Switching to Stable..." : "Downloading update..."}
              </span>
              {progress !== null && <span>{progress}%</span>}
            </div>
            <Progress value={progress ?? 0} className="h-1.5" />
          </div>
        ) : isDownloaded ? (
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
            <Button onClick={onRestartNow}>Restart Now</Button>
          </DialogFooter>
        ) : (
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onDismiss();
                onOpenChange(false);
              }}
            >
              {isLeaveAlphaDowngrade ? "Stay on Alpha" : "Later"}
            </Button>
            <Button onClick={onInstall}>
              {isLeaveAlphaDowngrade ? "Switch to Stable" : "Install & Restart"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
