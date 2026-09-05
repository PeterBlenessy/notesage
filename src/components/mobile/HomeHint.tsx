import { X } from "lucide-react";
import { t } from "@/lib/i18n";

/**
 * One muted line, shown once: an existing user's root shrinking to the
 * Inbox alone is a surprise, and one sentence at the point of surprise is
 * enough. Dismissed by its ×, or by the first folder put on Home.
 */
export function HomeHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2 px-4 pb-3 pt-1">
      <p
        className="min-w-0 flex-1 text-[length:calc(0.75rem*var(--ns-a11y-scale,1))] text-muted-foreground"
        style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
      >
        {t("home.hint")}
      </p>
      <button
        type="button"
        aria-label={t("home.dismiss")}
        onClick={onDismiss}
        className="ios-press-row -mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground"
      >
        <X strokeWidth={1.5} className="h-4 w-4" />
      </button>
    </div>
  );
}
