import { Sparkles, Bug, Zap, ChevronDown } from 'lucide-react';
import { renderInlineMarkdown } from '@/lib/render-inline-markdown';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useChangelog, type Release } from '@/hooks/useChangelog';
import { cn } from '@/lib/utils';
import { useState } from 'react';

declare const __APP_VERSION__: string;

interface ChangelogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ReleaseSection({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: typeof Sparkles;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        <Icon className="h-3 w-3" strokeWidth={1.5} />
        {title}
      </div>
      <ul className="space-y-1 text-sm text-foreground pl-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 leading-relaxed">
            <span className="text-muted-foreground shrink-0 leading-relaxed">•</span>
            <span>{renderInlineMarkdown(item)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReleaseCard({ release }: { release: Release }) {
  const [expanded, setExpanded] = useState(true);
  const isCurrent = release.version === __APP_VERSION__;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors duration-150"
      >
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">v{release.version}</span>
            {isCurrent && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground">
                current
              </span>
            )}
          </div>
          {release.date && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {release.date}
            </p>
          )}
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-150',
            expanded && 'rotate-180'
          )}
          strokeWidth={1.5}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-border pt-3">
          <ReleaseSection
            title="Features"
            icon={Sparkles}
            items={release.sections.features ?? []}
          />
          <ReleaseSection
            title="Fixes"
            icon={Bug}
            items={release.sections.fixes ?? []}
          />
          <ReleaseSection
            title="Improvements"
            icon={Zap}
            items={release.sections.improvements ?? []}
          />
        </div>
      )}
    </div>
  );
}

export function ChangelogDialog({ open, onOpenChange }: ChangelogDialogProps) {
  const { changelog, loading } = useChangelog();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Live-test 2026-04-25 #146 — chrome upgraded to match the
        v2 dialog aesthetic (KeyboardShortcutsDialogV2,
        SettingsDialogV2): wider 640 px modal, generous 28 px header
        padding, 20 px semibold title, ScrollArea body. The dialog is
        only opened from the v2 About panel (`AboutSettings`) so
        no legacy callers depend on the old chrome.
      */}
      <DialogContent className="max-w-[640px] max-h-[80vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-7 pt-7 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-[20px] font-semibold tracking-tight">
            Changelog
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
            Version history and release notes for Notesage.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-7 py-5 space-y-3">
            {loading && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Loading changelog…
              </p>
            )}
            {!loading && (!changelog || changelog.releases.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No changelog available.
              </p>
            )}
            {changelog?.releases.map((release) => (
              <ReleaseCard key={release.version} release={release} />
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
