import { Bell } from "lucide-react";
import { t } from "@/lib/i18n";

/**
 * Asked when it means something: never on first launch, only once the Inbox
 * has received its first item. iOS allows one system prompt, so this card
 * comes first — *Turn on* spends it, *Not now* keeps it and is permanent
 * (the menu rows remain the way back). Geometry is the Inbox card's.
 */
export function NotificationPrePrompt({ onTurnOn, onNotNow }: { onTurnOn: () => void; onNotNow: () => void }) {
  return (
    <div className="px-2 pb-3">
      <div className="flex items-start gap-3 rounded-xl bg-muted/60 px-2 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center">
          <Bell strokeWidth={1.5} className="h-5 w-5 text-[var(--color-accent-primary)]" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="text-[length:calc(0.9375rem*var(--ns-a11y-scale,1))] text-foreground"
            style={{ fontWeight: "max(500, var(--ns-a11y-weight, 400))" }}
          >
            {t("notify.prePromptTitle")}
          </p>
          <p
            className="mt-0.5 text-[length:calc(0.8125rem*var(--ns-a11y-scale,1))] text-muted-foreground"
            style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
          >
            {t("notify.prePromptBody")}
          </p>
          <div className="mt-2 flex gap-4">
            <button
              type="button"
              onClick={onTurnOn}
              className="ios-press-row text-[length:calc(0.9375rem*var(--ns-a11y-scale,1))] text-[var(--color-accent-primary)]"
              style={{ fontWeight: "max(500, var(--ns-a11y-weight, 400))" }}
            >
              {t("notify.turnOn")}
            </button>
            <button
              type="button"
              onClick={onNotNow}
              className="ios-press-row text-[length:calc(0.9375rem*var(--ns-a11y-scale,1))] text-muted-foreground"
              style={{ fontWeight: "var(--ns-a11y-weight, 400)" }}
            >
              {t("notify.notNow")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
