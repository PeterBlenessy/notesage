import { useEffect } from "react";
import { log } from "@/lib/logger";
import { iosContentReady } from "@/lib/ios-api";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { useMobileStore } from "@/stores/mobile-store";
import { Onboarding } from "@/components/mobile/Onboarding";
import { LibraryBrowser } from "@/components/mobile/LibraryBrowser";
import { Reader } from "@/components/mobile/Reader";
import { useInlineSweep } from "@/components/mobile/useInlineSweep";

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

  // Mounted HERE, at the root, deliberately: it must keep working while the
  // user reads. Hosting it in LibraryBrowser would stop the sweep the moment a
  // document opened, because that component unmounts — the same class of bug
  // as scoping a global listener to a collapsible surface.
  useInlineSweep();

  // Resolve the native grant once on mount — never trust a persisted flag.
  useEffect(() => {
    void refreshGrant();
  }, [refreshGrant]);

  // Drop the native launch cover once we have actually painted (#675). Two
  // nested rAFs: the first fires before the browser paints this commit, the
  // second after — so the cover lifts onto real pixels, not an empty frame.
  // Errors are ignored: off-iOS there is no cover, and the native side also
  // removes it on a timeout.
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        void iosContentReady().catch(() => {});
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, []);

  // Local-only JS diagnostics (#587): Apple's crash reporting sees only
  // NATIVE crashes — JS errors and unhandled rejections are invisible to it.
  // Forward them to the app's own on-device log via the existing logger
  // (log_frontend), which is never transmitted anywhere: the iOS binary
  // links no telemetry SDKs. Capped so an error loop can't flood the log.
  useEffect(() => {
    let logged = 0;
    const CAP = 50;
    const onError = (e: ErrorEvent) => {
      if (logged++ >= CAP) return;
      log.error("mobile-js", `Unhandled error: ${e.message} @ ${e.filename}:${e.lineno}`);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (logged++ >= CAP) return;
      log.error("mobile-js", `Unhandled rejection: ${String(e.reason)}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

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
          // Keyed by path: a document switch REMOUNTS the reader, so per-doc
          // state (find query, marks, refs) can never leak between documents.
          openDoc ? <Reader key={openDoc.relPath} /> : <LibraryBrowser />
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
      {/* An SVG ring rather than a bordered div — see the matching comment in
          LibraryBrowser. A `border-t-*` tint on a 2px circle was reported as
          "just a circle" with no discernible motion; an explicit stroked arc
          has nothing to override and reads at any size. */}
      <svg viewBox="0 0 24 24" className="h-6 w-6 animate-spin" aria-label="Loading" role="img">
        <circle cx="12" cy="12" r="10" fill="none" stroke="var(--color-muted)" strokeWidth="2.5" />
        <circle
          cx="12"
          cy="12"
          r="10"
          fill="none"
          stroke="var(--color-foreground)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="15.7 47.1"
        />
      </svg>
    </div>
  );
}

export default MobileApp;
