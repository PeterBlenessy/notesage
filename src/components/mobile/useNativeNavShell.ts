import { useEffect, useRef, useState } from "react";

import {
  iosNavShellDismiss,
  iosNavShellPop,
  iosNavShellPopToRoot,
  iosNavShellPrepare,
  iosNavShellPresent,
  iosNavShellPush,
  iosNavShellRendered,
  iosNavShellSetTitle,
} from "@/lib/ios-api";
import { t } from "@/lib/i18n";
import { log } from "@/lib/logger";
import { useFlagStore } from "@/stores/flag-store";
import { setNavigationGate, useMobileStore } from "@/stores/mobile-store";

import { deriveNavStack, diffNavStack, storeStateForScreen, type NavScreen } from "./nav-stack";
import { setNavShellPresented, useNavShellPresented } from "./nav-shell-state";

/**
 * Keep the native navigation stack and the store in step (PRD
 * `docs/prds/2026-09-06-ios-native-navigation.md`).
 *
 * One direction at a time, and never both at once:
 *
 * - The user taps a row → the store changes → this reconciles the native
 *   stack to match, freezing the outgoing screen first so the push animates
 *   between two different pictures rather than one.
 * - The user swipes back → the SYSTEM pops → `didPop` arrives → the store is
 *   moved to match, and only then is the frozen picture over the revealed
 *   screen dropped.
 *
 * The reconcile is a diff rather than a replay: a rename changes a screen's
 * title but not its id, and rebuilding the stack under someone because a
 * folder was renamed would be its own bug.
 */
export function useNativeNavShell(active: boolean): void {
  const flagOn = useFlagStore((s) => s.enabled.includes("native-shell"));
  const on = flagOn && active;

  const folderStack = useMobileStore((s) => s.folderStack);
  const docStack = useMobileStore((s) => s.docStack);
  const openDoc = useMobileStore((s) => s.openDoc);
  const homeEditorOpen = useMobileStore((s) => s.homeEditorOpen);
  // The root's title is the library's own name — what the breadcrumb shows
  // today, so the bar reads the same as the chrome it replaces.
  const rootTitle = useMobileStore((s) => s.libraryName) || "Notesage";
  const rootTitleRef = useRef(rootTitle);
  rootTitleRef.current = rootTitle;

  /** Whether the bar is actually up. The reconcile below must not run before
   *  it is: with an empty `nativeStack` the diff would treat Home itself as a
   *  screen to push, stacking the root on top of the root. */
  const presented = useNavShellPresented();

  /** What the native stack currently holds, as far as we know. */
  const nativeStack = useRef<NavScreen[]>([]);
  /** Set while applying a system pop, so the reconcile does not answer the
   *  store change it just caused with a second round of pops. */
  const applyingPop = useRef(false);
  /**
   * One reconcile at a time.
   *
   * A reconcile is several awaited calls, and someone tapping quickly changes
   * the store again in the middle of one. Two overlapping runs both mutate the
   * tracked stack and end up describing a stack neither of them built — which
   * the drift recovery then answers by collapsing to the root, in front of a
   * user whose only crime was tapping twice. So runs are serialised, and a
   * change that arrives mid-run schedules exactly one more pass afterwards.
   */
  const reconciling = useRef(false);
  const rerun = useRef(false);
  const [reconcileTick, setReconcileTick] = useState(0);

  // The freeze has to happen at the tap, before React redraws — see
  // `setNavigationGate`.
  useEffect(() => {
    if (!on) {
      setNavigationGate(null);
      return;
    }
    setNavigationGate(() => {
      if (applyingPop.current) return;
      void iosNavShellPrepare().catch(() => {});
    });
    return () => setNavigationGate(null);
  }, [on]);

  // Present and tear down.
  useEffect(() => {
    if (!on) {
      nativeStack.current = [];
      setNavShellPresented(false);
      void iosNavShellDismiss().catch(() => {});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        // `rootTitleRef`, not `rootTitle`: the library's name arrives after the
        // grant resolves, and depending on it here would tear the stack down
        // and rebuild it the moment it did — mid-launch, under the user. The
        // title is updated in place instead, below.
        await iosNavShellPresent(rootTitleRef.current);
        if (cancelled) return;
        nativeStack.current = [{ id: "", title: rootTitleRef.current }];
        // Only now: the chrome's top row stands down because the navigation
        // bar replaces it, and announcing that before the bar exists strips
        // the back button off a screen that then has no way out.
        setNavShellPresented(true);
      } catch (err) {
        // Off iOS, or a build without the plugin: the web shell keeps its own
        // chrome and its own gestures, exactly as before. Logged rather than
        // swallowed — a shell that quietly fails to present looks identical to
        // a flag that is off, and that cost a build cycle to tell apart.
        log.warn("nav-shell", `present failed: ${String(err)}`);
        setNavShellPresented(false);
      }
    })();
    return () => {
      cancelled = true;
      nativeStack.current = [];
      setNavShellPresented(false);
      void iosNavShellDismiss().catch(() => {});
    };
  }, [on]);

  // Store → stack.
  useEffect(() => {
    if (!on || !presented || nativeStack.current.length === 0) return;
    const next = deriveNavStack({
      folderStack,
      docStack,
      openDoc,
      homeEditorOpen,
      rootTitle,
      homeEditorTitle: t("menu.editHome"),
    });
    if (reconciling.current) {
      rerun.current = true;
      return;
    }
    const { pops, pushes } = diffNavStack(nativeStack.current, next);
    if (pops === 0 && pushes.length === 0) {
      // Same screens: a title may still have changed under a rename.
      const top = next[next.length - 1];
      const known = nativeStack.current[nativeStack.current.length - 1];
      if (top && known && top.title !== known.title) {
        nativeStack.current = next;
        void iosNavShellSetTitle(top.title).catch(() => {});
      }
      return;
    }
    // Animate a STEP, not a rebuild. One push or one pop is somebody tapping
    // or going back, and it should move. Several at once is the app catching
    // up with itself — a session restored at launch with a folder and a
    // document already open, or a breadcrumb jump across three levels — and
    // animating that is a stack of slides nobody asked for, on the first
    // screen they see.
    const animated = pops + pushes.length === 1;
    reconciling.current = true;
    void (async () => {
      try {
        for (let i = 0; i < pops; i += 1) await iosNavShellPop(animated).catch(() => {});
        for (const screen of pushes) {
          await iosNavShellPush(screen.id, screen.title, animated).catch(() => {});
        }
        nativeStack.current = next;
        // The destination is drawn — the outgoing screen's frozen picture can go.
        const top = next[next.length - 1];
        if (top) await iosNavShellRendered(top.id).catch(() => {});
      } finally {
        reconciling.current = false;
        if (rerun.current) {
          rerun.current = false;
          setReconcileTick((n) => n + 1);
        }
      }
    })();
  }, [on, presented, folderStack, docStack, openDoc, homeEditorOpen, rootTitle, reconcileTick]);

  // Stack → store.
  useEffect(() => {
    if (!on) return;
    const onShell = (e: Event) => {
      const detail = (e as CustomEvent<{ type?: string; screenId?: string }>).detail;
      if (detail?.type !== "didPop" || detail.screenId === undefined) return;
      const screenId = detail.screenId;
      const target = storeStateForScreen(nativeStack.current, screenId);
      if (!target) {
        // The two sides disagree about what is on the stack. Guessing which is
        // right produces a stack that lies — and simply forgetting, which this
        // used to do, left `nativeStack` empty and the reconcile permanently
        // guarded off: the shell stopped following the store until the flag
        // was toggled. Collapse to the root instead, the one state both sides
        // agree on without asking, and let the reconcile below push whatever
        // the store actually holds.
        nativeStack.current = [{ id: "", title: rootTitleRef.current }];
        void iosNavShellPopToRoot().catch(() => {});
        const store = useMobileStore.getState();
        applyingPop.current = true;
        try {
          if (store.openDoc) store.closeDocument();
          if (store.homeEditorOpen) store.closeHomeEditor();
          store.goToDepth(0);
        } finally {
          applyingPop.current = false;
        }
        return;
      }
      const index = nativeStack.current.findIndex((s) => s.id === screenId);
      nativeStack.current = nativeStack.current.slice(0, index + 1);

      applyingPop.current = true;
      try {
        const store = useMobileStore.getState();
        if (screenId === "home-editor") {
          // Nothing above it to unwind.
        } else if (target.closesDoc) {
          if (store.openDoc) store.closeDocument();
          if (store.homeEditorOpen) store.closeHomeEditor();
          store.goToDepth(target.folderDepth);
        } else {
          // Back to a document in the link trail. `goBack` walks it one step
          // at a time and is the only API for it, which is right: the trail
          // is the store's own idea and this should not reach around it.
          const steps = store.docStack.length - target.docTrail;
          for (let i = 0; i < steps; i += 1) store.goBack();
        }
      } finally {
        applyingPop.current = false;
      }
      // Thaw AFTER the screen has actually been drawn, not after the store was
      // told to change it. `set` is not a render: dropping the frozen picture
      // here would show the document that was just left, for as long as React
      // takes to commit and WebKit to paint. Two frames is the smallest wait
      // that spans both — one for the commit, one for the paint.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void iosNavShellRendered(screenId).catch(() => {});
        });
      });
    };
    window.addEventListener("notesage:nav-shell", onShell);
    return () => window.removeEventListener("notesage:nav-shell", onShell);
  }, [on]);
}
