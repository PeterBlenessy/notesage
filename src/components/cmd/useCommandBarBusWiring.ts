import { useEffect } from "react";
import { subscribeToCmdBarEvents, emitCmdBarEvent } from "@/lib/cmd-bar-events";
import { useCmdBarSummonStore } from "@/stores/cmd-bar-summon-store";
import { MODES } from "@/components/cmd/prefix-modes";
import { VERBS } from "@/components/cmd/verb-modes";
import { type AttachmentChip } from "@/components/cmd/AttachmentChips";
import { type CommandBarPrefixState } from "@/components/cmd/useCommandBarPrefixState";
import { type EditContext } from "@/components/cmd/useResendEditDialog";

export interface UseCommandBarBusWiringArgs {
  /** The prefix/verb state machine — the bus seeds and clears it. */
  prefix: CommandBarPrefixState;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  setChips: React.Dispatch<React.SetStateAction<AttachmentChip[]>>;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setChatView: React.Dispatch<React.SetStateAction<"chat" | "history">>;
  /** Render-phase mirror of the edit-mode state (Esc stage 2). */
  editContextRef: React.RefObject<EditContext | null>;
  clearEditContext: () => void;
  /** Collapse the bar (no-op while pinned — gated internally). */
  collapse: () => void;
}

/**
 * useCommandBarBusWiring — the FloatingCommandBar's summon/dismiss wiring.
 *
 * #114 — Subscribes to the `cmd-bar-events` bus so `useCommandBarShortcuts`
 * (⌘K, ⌘⇧P, ⌘1–4, Esc from outside the bar) and `useDoubleTapCmd` can drive
 * the bar's state. Previously the shortcut hook emitted on this bus but
 * nothing subscribed — the ⌘K gesture was silently dropped. Subscribing
 * here is the missing wire; once mounted, every chord observed by the
 * hook reaches the bar.
 *
 * focus events: expand the bar; if the intent carries a prefix character,
 * prefill the input with that character and pre-arm the active-prefix
 * state so the mode picker opens on the same tick.
 *
 * dismiss events: if the bar is expanded, collapse; if it's already
 * collapsed the handler is a no-op and the Esc keydown keeps propagating
 * to the editor / popover / focus-mode chain (the hook intentionally
 * does not preventDefault on Esc).
 *
 * Durable summon path: the App-root dispatcher (`useGlobalShortcuts`) writes
 * keyboard summons (⌘K, ⌘⇧F, ⌘1–4, ⌘⇧P, double-⌘) to `cmd-bar-summon-store`
 * rather than the transient bus. Because the intent lives in durable state, a
 * bar that crashes (ErrorBoundary) and remounts reads the pending summon and
 * re-applies it via the same bus `focus` handler below — the summon survives
 * the crash (the old bus-only path dropped it whenever the single subscriber
 * was unmounted). We translate to the bus here so all the seeding logic stays
 * in one place.
 */
export function useCommandBarBusWiring({
  prefix,
  inputRef,
  setInputValue,
  setChips,
  setExpanded,
  setChatView,
  editContextRef,
  clearEditContext,
  collapse,
}: UseCommandBarBusWiringArgs): void {
  const {
    setActivePrefix,
    setActiveVerb,
    activePrefixRef,
    activeVerbRef,
    dismissedPrefixRef,
    dismissedVerbRef,
    setPendingTagDrilldown,
    setPendingMentionDrilldown,
  } = prefix;

  const pendingSummon = useCmdBarSummonStore((s) => s.pending);
  const consumeSummon = useCmdBarSummonStore((s) => s.consume);
  useEffect(() => {
    if (!pendingSummon) return;
    emitCmdBarEvent({
      type: "focus",
      prefix: pendingSummon.prefix,
      drilldown: pendingSummon.drilldown,
    });
    consumeSummon();
  }, [pendingSummon, consumeSummon]);

  // #114 — Subscribe to the `cmd-bar-events` bus so non-keyboard surfaces
  // (sidebar rows, toolbar buttons) and the durable summon effect above can
  // drive the bar's state.
  //
  // focus events: expand the bar; if the intent carries a prefix character,
  // prefill the input and pre-arm the active-prefix state so the mode picker
  // opens on the same tick.
  //
  // dismiss events: if the bar is expanded, collapse; if already collapsed the
  // handler is a no-op and the Esc keydown keeps propagating to the editor /
  // popover / focus-mode chain (the dispatcher does not preventDefault on Esc).
  useEffect(() => {
    return subscribeToCmdBarEvents((event) => {
      if (event.type === 'focus') {
        setExpanded(true);
        // Apply drilldown seed BEFORE setActivePrefix so the picker mounts
        // already pointed at level 2 (no level-1 flash).
        if (event.drilldown) {
          if (event.drilldown.kind === 'tag') {
            setPendingTagDrilldown(event.drilldown.name);
            setPendingMentionDrilldown(null);
          } else if (event.drilldown.kind === 'mention') {
            setPendingMentionDrilldown(event.drilldown.name);
            setPendingTagDrilldown(null);
          }
        } else {
          setPendingTagDrilldown(null);
          setPendingMentionDrilldown(null);
        }
        if (event.prefix) {
          // Verb chord seeds (PRD `2026-04-28-cmd-bar-verb-prefixes`).
          // Format `:<verb-name> ` — verb-prefix branch handled before
          // the single-char MODES lookup so a `:file ` chord doesn't
          // collide with the noun-prefix path.
          if (event.prefix.startsWith(':')) {
            // Strip optional trailing whitespace to find the verb
            // name; the seeded inputValue keeps the trailing space so
            // the cursor lands in the filter slot directly.
            const verbName = event.prefix.slice(1).trimEnd();
            const verb = VERBS[verbName as keyof typeof VERBS];
            if (verb) {
              setInputValue(event.prefix);
              const verbEnd = 1 + verb.name.length;
              const filterStart = event.prefix.length;
              setActiveVerb({
                verb,
                verbStart: 0,
                verbEnd,
                filterStart,
                filterEnd: event.prefix.length,
                filter: '',
                typedName: verb.name,
                // Chord-seeded: Esc collapses the bar in one stage.
                source: 'chord',
              });
              setActivePrefix(null);
            }
          } else {
            const mode = Object.values(MODES).find(
              (m) => m.prefix === event.prefix,
            );
            if (mode) {
              // Prefill with the prefix character only — no trailing space.
              // A space would (a) show an extra cursor-offset the user has to
              // delete, (b) count as post-prefix typed filter text and mis-seed
              // the picker's filter state. The input's onChange / selection
              // handlers handle cursor/filter state from here on as the user
              // types after the prefix.
              setInputValue(mode.prefix);
              setActivePrefix({
                mode,
                prefixIndex: 0,
                tokenStart: 0,
                tokenEnd: 1,
                filter: '',
                // Chord-seeded: Esc collapses the bar in one stage (see the
                // dismiss branch below). A `'typed'` prefix would instead
                // require two Escs (first clears prefix, second collapses).
                source: 'chord',
              });
            }
          }
        }
        // Defer focus to the next tick so the input has rendered when the
        // bar transitioned from collapsed → expanded in the same pass.
        // Place the cursor AFTER the prefilled prefix so the user can type
        // the filter immediately. Without `setSelectionRange`, browsers
        // place the cursor at offset 0 on focus and the next keystroke
        // lands BEFORE the `#` / `@` (live-test 2026-04-26).
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (!el) return;
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        });
        return;
      }

      if (event.type === 'dismiss') {
        // Three-stage Esc mirror of the in-input `handleKeyDown`:
        //   1. Typed prefix (`#`, `@`, `!`, …) → clear the prefix only;
        //      the bar stays expanded so the user keeps composing. A
        //      chord-seeded prefix (⌘1/2/3/4, ⌘⇧P, ⌘⇧F) skips this
        //      stage and falls through to collapse — the chord was the
        //      only reason we landed there.
        //   2. Edit mode active (#127 iter-2 fix) → cancel the edit
        //      (clear context + the pre-filled input + chips). Bar
        //      stays expanded; the next Esc collapses it.
        //   3. Nothing to cancel → collapse the bar.
        //
        // Refs mirror the live state so the once-mounted subscriber
        // doesn't need them in its deps.
        const currentPrefix = activePrefixRef.current;
        if (currentPrefix?.source === 'typed') {
          // #126 fix — remember which prefix was dismissed so the next
          // keystroke doesn't immediately re-open the picker. Cleared
          // when the user deletes or replaces the prefix character.
          dismissedPrefixRef.current = {
            index: currentPrefix.prefixIndex,
            char: currentPrefix.mode.prefix,
          };
          setActivePrefix(null);
          // #126 focus-regression fix — the skill / tag / reference
          // picker takes keyboard focus while open; clearing the
          // prefix alone leaves focus on a now-hidden picker DOM, so
          // the next keystroke lands nowhere. Explicitly restore focus
          // to the input after the prefix state update settles.
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }

        // Verb Esc — same two-stage semantics as noun prefixes (PRD
        // `2026-04-28-cmd-bar-verb-prefixes`). Typed verb → first Esc
        // clears the verb (back to chat mode, bar stays expanded);
        // chord-seeded verb → first Esc collapses the bar.
        const currentVerb = activeVerbRef.current;
        if (currentVerb?.source === 'typed') {
          dismissedVerbRef.current = { index: currentVerb.verbStart };
          setActiveVerb(null);
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }

        if (editContextRef.current) {
          // #127 iter-2 — Esc cancels edit mode before collapsing.
          clearEditContext();
          setInputValue('');
          setChips([]);
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }

        // In pinned mode the bar can't collapse — fall through to the
        // prefix-clearing behaviour in `collapse` (gated internally).
        // Otherwise collapse fully.
        collapse();
      }

      if (event.type === 'toggle-history') {
        // #118 — Clock icon in the context row (and ⌘⇧H when wired)
        // flips the stream area between the chat view and the past-
        // conversation list. Ensure the bar is expanded so the new
        // mode has somewhere to render.
        setExpanded(true);
        setChatView((prev) => (prev === 'history' ? 'chat' : 'history'));
      }

      if (event.type === 'close') {
        // X button in the context row — forced collapse that bypasses
        // both the pin guard in `collapse()` and the multi-stage prefix
        // semantics in `dismiss`. The trigger is responsible for
        // unpinning before firing; this just tears the bar down.
        //
        // The X is the MOUSE equivalent of Esc-to-collapse, so it must
        // PRESERVE the typed draft exactly like `collapse()` does —
        // reopening restores what the user was writing. Only an actual send
        // clears the input. (Earlier this wiped the draft, which read as a
        // bug: closing then reopening lost the prompt.)
        setExpanded(false);
        setActivePrefix(null);
        setActiveVerb(null);
        dismissedPrefixRef.current = null;
        dismissedVerbRef.current = null;
        inputRef.current?.blur();
      }
    });
    // The subscriber reads live state through refs (`activePrefixRef`,
    // `activeVerbRef`, `editContextRef`) and stable setters, so `collapse`
    // is the only dependency that can change identity (it re-memoizes on
    // pin-mode flips).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapse]);
}
