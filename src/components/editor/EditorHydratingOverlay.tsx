import { useEffect, useState } from "react";

/**
 * Small frosted-glass card that shows when the user has signalled an intent
 * to edit (keypress / paste / non-link click) on the `MarkdownPreview`
 * surface, but the editor isn't yet hydrated. Phase 2 task #17.
 *
 * Just a "be patient, the editor is coming" affordance — keystrokes typed
 * during the preview window are NOT queued (PRD's Edit-A is "block briefly",
 * not Edit-B "queue intent"); the user can retype after the editor takes
 * over. The overlay's job is to make it obvious that input isn't being
 * silently dropped.
 *
 * Auto-dismisses when the editor hydrates — the parent (`Editor.tsx`)
 * unmounts this when `previewState` flips to `"hydrated"`.
 *
 * Reduced-motion: the elapsed counter still ticks, but the spinner /
 * scale-in transition collapses to a static fade.
 */
interface EditorHydratingOverlayProps {
  /** Render the overlay only when this is true. */
  open: boolean;
}

export function EditorHydratingOverlay({ open }: EditorHydratingOverlayProps) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!open) {
      setSeconds(0);
      return;
    }
    const t0 = performance.now();
    const id = window.setInterval(() => {
      setSeconds(Math.max(1, Math.round((performance.now() - t0) / 1000)));
    }, 250);
    return () => window.clearInterval(id);
  }, [open]);

  if (!open) return null;

  // Centred over the document area. Pointer-events-none on the wrapper so it
  // doesn't intercept the user's cursor; the inner card has its own pointer
  // events for accessibility (screen-reader announcement).
  //
  // Color: `bg-amber-500` matches the Settings → Connections "starting" /
  // local-AI server-loading indicator (`LocalAISettings.tsx`). Same visual
  // language for "in-progress, will be ready soon" across the app.
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Editor loading${seconds > 0 ? `, ${seconds} ${seconds === 1 ? "second" : "seconds"}` : ""}`}
      className="absolute inset-0 z-30 flex items-start justify-center pt-24 pointer-events-none motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      data-editor-hydrating-overlay="true"
    >
      <div className="pointer-events-auto rounded-lg border border-amber-500/40 bg-popover/90 px-4 py-2 text-sm text-popover-foreground shadow-md backdrop-blur">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-amber-500 motion-safe:animate-pulse"
          />
          <span>
            Loading editor{seconds > 0 ? ` (${seconds}s)` : "…"}
          </span>
        </div>
      </div>
    </div>
  );
}
