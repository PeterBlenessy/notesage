import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/** The listing's loading placeholder: eight rows of the list's own shape. */
export function BrowserSkeleton() {
  return (
    <ul className="animate-pulse" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="h-5 w-5 rounded bg-muted" />
          <div className="h-3 flex-1 rounded bg-muted" style={{ maxWidth: `${50 + ((i * 7) % 40)}%` }} />
        </li>
      ))}
    </ul>
  );
}

/** A listing that could not be read, with the error and a way to retry. */
export function BrowserError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
      <AlertCircle strokeWidth={1.25} className="h-8 w-8 text-muted-foreground" />
      <p
        className="mt-3 text-[length:calc(0.875rem*var(--ns-a11y-scale,1))] text-foreground"
        style={{ fontWeight: "max(500, var(--ns-a11y-weight, 400))" }}
      >
        Couldn't open this folder
      </p>
      <p
        className="mt-1 max-w-xs text-[length:calc(0.75rem*var(--ns-a11y-scale,1))] text-muted-foreground break-words"
        style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
      >
        {message}
      </p>
      <Button variant="outline" size="sm" className="ios-press-row mt-4" onClick={onRetry}>
        {t("library.tryAgain")}
      </Button>
    </div>
  );
}
