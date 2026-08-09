import { useEffect } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { useMobileStore } from "@/stores/mobile-store";
import { Onboarding } from "@/components/mobile/Onboarding";
import { LibraryBrowser } from "@/components/mobile/LibraryBrowser";
import { Reader } from "@/components/mobile/Reader";

/**
 * Root of the iOS mobile shell — a read-only reader over the iCloud-synced
 * Notesage library (PRD `docs/prds/2026-06-28-ios-mobile-app.md`). Mounted in
 * place of the desktop `App`/`QuietLayout` by `main.tsx` when `isIos()`, so the
 * desktop lifecycle hooks (AI, ACP, watcher, git, editor) never run here.
 *
 * The only write path in the whole shell is the iOS Share Extension's capture
 * (a separate process) — this UI never mutates the library.
 */
export function MobileApp() {
  const grantState = useMobileStore((s) => s.grantState);
  const openDoc = useMobileStore((s) => s.openDoc);
  const refreshGrant = useMobileStore((s) => s.refreshGrant);

  // Resolve the native grant once on mount — never trust a persisted flag.
  useEffect(() => {
    void refreshGrant();
  }, [refreshGrant]);

  // Keep the chrome islands anchored ("sticky"): when the on-screen keyboard
  // appears, iOS pans the visual viewport to reveal the focused input, which
  // shoves fixed/absolute chrome offscreen. `interactive-widget=
  // resizes-content` in the viewport meta prevents most of it; this guard
  // undoes any residual pan the moment it happens.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const settle = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    };
    vv.addEventListener("scroll", settle);
    vv.addEventListener("resize", settle);
    return () => {
      vv.removeEventListener("scroll", settle);
      vv.removeEventListener("resize", settle);
    };
  }, []);

  return (
    <ThemeProvider>
      {/* `fixed inset-0` rather than `h-screen w-screen`: 100vh/100vw disagree
          with iOS's visual viewport, and a WKWebView sized that way lays out
          but does not composite until a touch invalidates the layer — the app
          looks blank until you tap it. Pinning to the viewport avoids vh units
          altogether. (gaimer, which works, uses no vh units at all.) */}
      <div className="mobile-shell fixed inset-0 overflow-hidden bg-background text-foreground">
        {grantState === "unknown" ? (
          <Splash />
        ) : grantState === "granted" ? (
          openDoc ? <Reader /> : <LibraryBrowser />
        ) : (
          <Onboarding />
        )}
      </div>
      <Toaster position="top-center" />
    </ThemeProvider>
  );
}

/** Neutral splash shown while the grant resolves (no flash of onboarding). */
function Splash() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground"
        aria-label="Loading"
      />
    </div>
  );
}

export default MobileApp;
