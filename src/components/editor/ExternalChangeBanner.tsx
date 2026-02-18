import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExternalChangeBannerProps {
  onReload: () => void;
  onKeep: () => void;
}

export function ExternalChangeBanner({ onReload, onKeep }: ExternalChangeBannerProps) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2 border-b transition-colors duration-150"
      style={{
        backgroundColor: "var(--color-muted)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-foreground)" }}>
        <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "var(--color-muted-foreground)" }} strokeWidth={1.5} />
        <span>This file was modified externally.</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="xs" onClick={onKeep}>
          <X className="h-3 w-3" strokeWidth={2} />
          Keep
        </Button>
        <Button variant="default" size="xs" onClick={onReload}>
          <RefreshCw className="h-3 w-3" strokeWidth={2} />
          Reload
        </Button>
      </div>
    </div>
  );
}
