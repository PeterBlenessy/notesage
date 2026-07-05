import { useCallback, useEffect, useRef, useState } from "react";
import {
  detectActivePrefix,
  type ActivePrefix,
} from "@/components/cmd/prefix-modes";
import {
  detectActiveVerb,
  type ActiveVerb,
} from "@/components/cmd/verb-modes";
import { type ActiveOptionInfo } from "@/components/cmd/ModePickerDispatch";

export interface UseCommandBarPrefixStateArgs {
  inputValue: string;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  /** Composer textarea ref — cursor restoration after token replacement. */
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export interface CommandBarPrefixState {
  activePrefix: ActivePrefix | null;
  setActivePrefix: React.Dispatch<React.SetStateAction<ActivePrefix | null>>;
  /** Render-phase mirror of `activePrefix` for once-mounted subscribers. */
  activePrefixRef: React.RefObject<ActivePrefix | null>;
  activeVerb: ActiveVerb | null;
  setActiveVerb: React.Dispatch<React.SetStateAction<ActiveVerb | null>>;
  /** Render-phase mirror of `activeVerb`. */
  activeVerbRef: React.RefObject<ActiveVerb | null>;
  /** Esc-dismissal suppression for typed noun prefixes (#126). */
  dismissedPrefixRef: React.RefObject<{ index: number; char: string } | null>;
  /** Esc-dismissal suppression for typed verbs. */
  dismissedVerbRef: React.RefObject<{ index: number } | null>;
  activeOption: ActiveOptionInfo | null;
  setActiveOption: React.Dispatch<
    React.SetStateAction<ActiveOptionInfo | null>
  >;
  pendingTagDrilldown: string | null;
  setPendingTagDrilldown: React.Dispatch<React.SetStateAction<string | null>>;
  pendingMentionDrilldown: string | null;
  setPendingMentionDrilldown: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  recomputePrefix: (value: string, cursor: number) => void;
  handlePickSkill: (skillName: string) => void;
  handlePickVerb: (verbName: string) => void;
}

/**
 * useCommandBarPrefixState — the FloatingCommandBar's prefix/verb detection
 * state machine (PRD `2026-04-28-cmd-bar-verb-prefixes` + tasks #13–#19).
 *
 * Owns the active noun prefix (`/ @ # ! ? >`), the active `:verb`, their
 * Esc-dismissal suppression refs, the picker's highlighted-option mirror
 * (`aria-activedescendant` wiring, #78), and the sidebar drilldown seeds.
 */
export function useCommandBarPrefixState({
  inputValue,
  setInputValue,
  inputRef,
}: UseCommandBarPrefixStateArgs): CommandBarPrefixState {
  const [activePrefix, setActivePrefix] = useState<ActivePrefix | null>(null);
  // Mirror `activePrefix` onto a ref so the bus-subscription effect (which
  // mounts once) can read the latest value without being in its deps.
  // `activePrefix.source` drives Esc behaviour (typed → two-stage, chord →
  // one-stage collapse). The write happens DURING RENDER (not in useEffect)
  // so the ref is always in sync with the latest committed state by the
  // time React's commit phase finishes — eliminating any possibility of
  // a window-level keydown firing before the post-commit useEffect mirrors
  // the ref. (Mirror-via-useEffect was the previous pattern; #149 review
  // surfaced the timing race as a likely culprit for "Esc collapses bar
  // mid-edit" reports.)
  const activePrefixRef = useRef<ActivePrefix | null>(null);
  activePrefixRef.current = activePrefix;
  // Verb-prefix mirror — same shape as `activePrefix`, separate
  // namespace. Verbs and noun prefixes are mutually exclusive: when
  // `activePrefix` is non-null we force `activeVerb` to null so the
  // every-existing single-char chord keeps winning. PRD
  // `2026-04-28-cmd-bar-verb-prefixes`.
  const [activeVerb, setActiveVerb] = useState<ActiveVerb | null>(null);
  const activeVerbRef = useRef<ActiveVerb | null>(null);
  activeVerbRef.current = activeVerb;
  // Esc-suppression mirror of `dismissedPrefixRef` — when a typed
  // verb is dismissed via Esc, suppress re-detection of the same `:`
  // at the same index until the user actually deletes / replaces it.
  const dismissedVerbRef = useRef<{ index: number } | null>(null);
  // #126 fix — when a typed prefix is dismissed via Esc, suppress
  // re-detection of the SAME prefix character at the SAME index until
  // the user actually deletes or replaces it. Without this the picker
  // reopens on every subsequent keystroke (e.g. "/de" + Esc + Backspace
  // → "/d" → picker re-fires).
  const dismissedPrefixRef = useRef<{ index: number; char: string } | null>(
    null,
  );
  // Tracks the currently-highlighted option in the active mode picker so the
  // composer input can mirror it via `aria-activedescendant`. The picker
  // reports updates upward via its `onActiveOptionChange` callback (#78);
  // we reset to null whenever the active prefix flips off (no listbox open).
  const [activeOption, setActiveOption] = useState<ActiveOptionInfo | null>(
    null,
  );

  // Drilldown seed forwarded from the bus `focus` event so sidebar
  // TagsSection / MentionsSection clicks can jump straight to level-2 of
  // the relevant picker (live-test 2026-04-26). Cleared whenever the
  // active prefix changes back to null.
  const [pendingTagDrilldown, setPendingTagDrilldown] = useState<string | null>(
    null,
  );
  const [pendingMentionDrilldown, setPendingMentionDrilldown] = useState<
    string | null
  >(null);
  // Live-test 2026-04-26 — keep the highlighted picker row in view when
  // arrow-key navigation runs past the visible window. Pickers report
  // their active option via `onActiveOptionChange`; we scroll that option
  // into view from one place rather than duplicating scrollIntoView logic
  // in every mode.
  useEffect(() => {
    const id = activeOption?.activeOptionId;
    if (!id) return;
    const el = document.getElementById(id);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeOption?.activeOptionId]);

  // Drop the cached active-option info whenever the picker closes — there's
  // no listbox to point at, so `aria-activedescendant` and `aria-controls`
  // must be cleared together. Also clear pending drilldown seeds so the
  // next picker mount doesn't inherit a stale level-2 jump.
  useEffect(() => {
    if (!activePrefix) {
      setActiveOption(null);
      setPendingTagDrilldown(null);
      setPendingMentionDrilldown(null);
    }
  }, [activePrefix]);

  // ---------------------------------------------------------------------
  // Prefix detection — runs on every input change AND on selection moves.
  //
  // We compute the active prefix from (value, selectionStart) so that moving
  // the cursor outside the prefix token (e.g. arrow-keying into a later word)
  // dismisses the picker without typing anything.
  // ---------------------------------------------------------------------

  const recomputePrefix = useCallback(
    (value: string, cursor: number) => {
      const next = detectActivePrefix(value, cursor);

      // #126 fix — suppress re-detection of an Esc-dismissed prefix
      // until the user breaks the pattern (deletes or replaces the
      // prefix char). Without this, typing then Esc then any keystroke
      // would re-open the picker because the prefix is still in the
      // value.
      const dismissed = dismissedPrefixRef.current;
      if (dismissed) {
        if (next && next.prefixIndex === dismissed.index && value[dismissed.index] === dismissed.char) {
          // Still suppressed.
          setActivePrefix(null);
          // Verb detection is also gated when a single-char prefix
          // would have won, so skip it here too.
          setActiveVerb(null);
          return;
        }
        // Pattern broken — clear suppression so future prefixes work.
        dismissedPrefixRef.current = null;
      }

      setActivePrefix(next);

      // Verb-prefix detection runs ONLY when no single-char prefix is
      // active. Single-char prefixes win to preserve every existing
      // chord (PRD `2026-04-28-cmd-bar-verb-prefixes`, "mutually
      // exclusive" rule).
      if (next) {
        setActiveVerb(null);
        return;
      }
      const verbNext = detectActiveVerb(value, cursor);
      const dismissedVerb = dismissedVerbRef.current;
      if (dismissedVerb) {
        if (verbNext && verbNext.verbStart === dismissedVerb.index && value[dismissedVerb.index] === ':') {
          setActiveVerb(null);
          return;
        }
        dismissedVerbRef.current = null;
      }
      setActiveVerb(verbNext);
    },
    [],
  );

  /** Replace the active prefix token (prefix + filter) with the given string. */
  const replaceActiveToken = useCallback(
    (replacement: string) => {
      if (!activePrefix) return;
      const before = inputValue.slice(0, activePrefix.tokenStart);
      const after = inputValue.slice(activePrefix.tokenEnd);
      const next = before + replacement + after;
      const cursor = (before + replacement).length;
      setInputValue(next);
      setActivePrefix(null);
      // Restore cursor position after React applies the value.
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(cursor, cursor);
        }
      });
    },
    [activePrefix, inputValue, setInputValue, inputRef],
  );

  const handlePickSkill = useCallback(
    (skillName: string) => {
      replaceActiveToken(`/${skillName} `);
    },
    [replaceActiveToken],
  );

  // Verb discovery menu picked a verb name (PRD
  // `2026-04-28-cmd-bar-verb-prefixes`). Replace the `:typedName`
  // slice with `:fullName ` and jump cursor into the filter slot.
  // Mirrors the single-match path in `computeTabCompletion`.
  const handlePickVerb = useCallback(
    (verbName: string) => {
      const current = activeVerbRef.current;
      if (!current) return;
      const before = inputValue.slice(0, current.verbStart);
      const after = inputValue.slice(current.verbEnd);
      const needsSpace = after === '' || !/\s/.test(after[0]);
      const replaced = `:${verbName}${needsSpace ? ' ' : ''}`;
      const newInput = before + replaced + after;
      const newCursor = before.length + replaced.length;
      setInputValue(newInput);
      requestAnimationFrame(() => {
        const node = inputRef.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(newCursor, newCursor);
        recomputePrefix(newInput, newCursor);
      });
    },
    [inputValue, recomputePrefix, setInputValue, inputRef],
  );

  return {
    activePrefix,
    setActivePrefix,
    activePrefixRef,
    activeVerb,
    setActiveVerb,
    activeVerbRef,
    dismissedPrefixRef,
    dismissedVerbRef,
    activeOption,
    setActiveOption,
    pendingTagDrilldown,
    setPendingTagDrilldown,
    pendingMentionDrilldown,
    setPendingMentionDrilldown,
    recomputePrefix,
    handlePickSkill,
    handlePickVerb,
  };
}
