import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useSettingsStore } from "@/stores/settings-store";
import { useChatStore, selectMessages } from "@/stores/chat-store";
import { useAIOperations } from "@/hooks/useAIOperations";
import type { ChatMessage as ChatMessageType } from "@/lib/ai/types";
import { subscribeToCmdBarEvents } from "@/lib/cmd-bar-events";
import { MODES } from "@/components/cmd/prefix-modes";
import CommandBarContext from "@/components/cmd/CommandBarContext";
import AttachmentChips, {
  type AttachmentChip,
} from "@/components/cmd/AttachmentChips";
import CommandBarStream from "@/components/cmd/CommandBarStream";
import {
  detectActivePrefix,
  type ActivePrefix,
} from "@/components/cmd/prefix-modes";
import SkillMode from "@/components/cmd/modes/SkillMode";
import ReferenceMode from "@/components/cmd/modes/ReferenceMode";
import TagMode from "@/components/cmd/modes/TagMode";
import TaskMode, { type TaskAction } from "@/components/cmd/modes/TaskMode";
import ResearchMode from "@/components/cmd/modes/ResearchMode";
import PaletteMode from "@/components/cmd/modes/PaletteMode";
import { log } from "@/lib/logger";

/**
 * Pinned-mode width clamping constants — kept at module scope so the resize
 * handle, store setter, and CSS variable fallback all agree on the same
 * range. Mirrors the clamp in `setCmdBarPinnedWidth`.
 */
const PINNED_WIDTH_MIN = 280;
const PINNED_WIDTH_MAX = 800;
const PINNED_WIDTH_DEFAULT = 400;
const PINNED_WIDTH_KEYBOARD_STEP = 20;

/**
 * FloatingCommandBar — the unified composer shell for the Quiet Composer
 * UI refresh (PRD `2026-04-21-ui-refresh`, Phase 1, task #9).
 *
 * This file is intentionally just the bar's outer chrome. It hosts:
 *   - Compact state: a centred placeholder pill near the bottom of the
 *     viewport that hints at the ⌘K shortcut.
 *   - Expanded state: the same pill grows in height to ~480 px and reveals
 *     an autofocused input plus an empty scroll region for the future
 *     conversation stream.
 *
 * Subsequent tasks fill in the contents:
 *   - #10 CommandBarContext      → context row (provider, projects, mode)
 *   - #11 AttachmentChips        → chips above the input
 *   - #12 CommandBarStream       → real chat stream replaces the placeholder
 *   - #13 prefix morph           → /, @, #, !, ?, > mode switching (this file
 *                                  reports the active prefix; pickers in
 *                                  #14–#19 render the dropdowns)
 *   - #28 pinned panel layout    → wires up the `isPinned` branch
 *
 * Behaviour summary:
 *   - Click the compact pill (or open via ⌘K — handled by a future task) to
 *     expand. The input autofocuses.
 *   - Esc collapses back to compact and blurs the input. When a prefix mode
 *     is active, the first Esc clears the active prefix only; a second Esc
 *     collapses the bar (fall-through).
 *   - On focus, the bar lifts 14 px with a 200 ms ease transition. When
 *     `prefers-reduced-motion: reduce` is set, the lift and the height
 *     transition are skipped — the bar just snaps.
 *   - When `isPinned` is true the bar renders inline (no portal). Caller
 *     positions it; this component does not paint pinned-mode chrome yet.
 */

export interface FloatingCommandBarProps {
  /**
   * When provided, overrides the persisted `cmdBarPinned` setting from
   * settings-store. Tests pass this explicitly; production call sites should
   * leave it undefined and let the store drive the mode (so the pin icon in
   * `CommandBarContext` is the single source of truth). Forward-declared in
   * #9; wired to the store in #28.
   */
  isPinned?: boolean;
}

const COMPACT_PLACEHOLDER = "Press ⌘K to ask";

function FloatingCommandBar({ isPinned: isPinnedProp }: FloatingCommandBarProps) {
  // Read the persisted pinned flag. The prop overrides it (for tests / for
  // call sites that need to force a mode); when the prop is undefined, the
  // store wins so the pin-icon toggle in `CommandBarContext` works.
  const cmdBarPinnedSetting = useSettingsStore((s) => s.cmdBarPinned);
  const isPinned = isPinnedProp ?? cmdBarPinnedSetting;

  const [expanded, setExpanded] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [activePrefix, setActivePrefix] = useState<ActivePrefix | null>(null);
  // Mirror `activePrefix` onto a ref so the bus-subscription effect (which
  // mounts once) can read the latest value without being in its deps.
  // `activePrefix.source` drives Esc behaviour (typed → two-stage, chord →
  // one-stage collapse).
  const activePrefixRef = useRef<ActivePrefix | null>(null);
  useEffect(() => {
    activePrefixRef.current = activePrefix;
  }, [activePrefix]);
  // Tracks the currently-highlighted option in the active mode picker so the
  // composer input can mirror it via `aria-activedescendant`. The picker
  // reports updates upward via its `onActiveOptionChange` callback (#78);
  // we reset to null whenever the active prefix flips off (no listbox open).
  const [activeOption, setActiveOption] = useState<{
    listboxId: string;
    activeOptionId: string | null;
    count: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const reducedMotion = useReducedMotion();

  // Send wiring (#23). We reuse the existing `sendChatMessage` from
  // `useAIOperations` — the same entry point `ChatPanel` calls — so all
  // routing (direct API / ACP / Copilot LSP / local), provider lock checks,
  // segment isolation, and downstream streaming come "for free".
  const messagesForSend = useChatStore(selectMessages);
  const { sendChatMessage } = useAIOperations();

  // Attachment chips above the input (#11). Populated by the reference / task /
  // research mode pickers (#15 / #17 / #18) via the dispatchers below.
  const [chips, setChips] = useState<AttachmentChip[]>([]);
  const removeChip = useCallback((id: string) => {
    setChips((prev) => prev.filter((c) => c.id !== id));
  }, []);
  const addChip = useCallback((chip: AttachmentChip) => {
    setChips((prev) => (prev.some((c) => c.id === chip.id) ? prev : [...prev, chip]));
  }, []);

  // Whether the user is "composing" — used by TaskMode to choose between
  // navigate and attach. We treat any non-empty input or any pending chip as
  // composing; the picker uses this to pick the default Enter action.
  const isComposing = inputValue.trim().length > 0 || chips.length > 0;

  // Pinned mode is "always expanded" — the panel is permanent docking, so
  // there's no compact pill to click and no Esc-to-collapse behaviour. We
  // model this as a derived value (`effectiveExpanded`) so the rest of the
  // component logic can stay shared between floating and pinned.
  const effectiveExpanded = isPinned || expanded;

  // Autofocus the input whenever we transition into the expanded state.
  useEffect(() => {
    if (effectiveExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [effectiveExpanded]);

  // Drop the cached active-option info whenever the picker closes — there's
  // no listbox to point at, so `aria-activedescendant` and `aria-controls`
  // must be cleared together.
  useEffect(() => {
    if (!activePrefix) setActiveOption(null);
  }, [activePrefix]);

  const expand = useCallback(() => {
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    // Pinned mode has no "collapsed" state — the panel always stays docked.
    // Esc still falls through to clear the prefix (handled in `handleKeyDown`)
    // but we never tear down the bar itself.
    if (isPinned) return;
    setExpanded(false);
    setInputValue("");
    setActivePrefix(null);
    // Blur is a courtesy — the input itself unmounts when expanded === false,
    // but if we ever animate the input out we still want the focus released.
    inputRef.current?.blur();
  }, [isPinned]);

  // #114 — Subscribe to the `cmd-bar-events` bus so `useCommandBarShortcuts`
  // (⌘K, ⌘⇧P, ⌘1–4, Esc from outside the bar) and `useDoubleTapCmd` can drive
  // the bar's state. Previously the shortcut hook emitted on this bus but
  // nothing subscribed — the ⌘K gesture was silently dropped. Subscribing
  // here is the missing wire; once mounted, every chord observed by the
  // hook reaches the bar.
  //
  // focus events: expand the bar; if the intent carries a prefix character,
  // prefill the input with that character and pre-arm the active-prefix
  // state so the mode picker opens on the same tick.
  //
  // dismiss events: if the bar is expanded, collapse; if it's already
  // collapsed the handler is a no-op and the Esc keydown keeps propagating
  // to the editor / popover / focus-mode chain (the hook intentionally
  // does not preventDefault on Esc).
  useEffect(() => {
    return subscribeToCmdBarEvents((event) => {
      if (event.type === 'focus') {
        setExpanded(true);
        if (event.prefix) {
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
            setInputValue(event.prefix);
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
        // Defer focus to the next tick so the input has rendered when the
        // bar transitioned from collapsed → expanded in the same pass.
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }

      if (event.type === 'dismiss') {
        // Two-stage Esc mirror of the in-input `handleKeyDown`: if the user
        // typed a prefix character (`#`, `@`, `!`, …) the first Esc should
        // only close the picker + clear the prefix, leaving the bar expanded
        // so they can keep composing. A chord-seeded prefix (⌘1/2/3/4,
        // ⌘⇧P, ⌘⇧F) collapses in one stage — the chord IS the only reason
        // the user landed here, so undoing it in full makes sense.
        //
        // `activePrefixRef.current` reads the live prefix (the subscription
        // closure itself captures a stale `activePrefix`; we mirror the state
        // via ref to avoid re-subscribing on every prefix change).
        const currentPrefix = activePrefixRef.current;
        if (currentPrefix?.source === 'typed') {
          setActivePrefix(null);
          return;
        }

        // In pinned mode the bar can't collapse — fall through to the
        // prefix-clearing behaviour in `collapse` (gated internally).
        // Otherwise collapse fully.
        collapse();
      }

      if (event.type === 'toggle-pin') {
        // #121 — ⌘⇧C pressed while the bar is expanded AND pinned. Flip the
        // pin off so the user returns to the floating overlay. The chord's
        // emit site in `useKeyboardShortcuts` already validated the state,
        // so we can setCmdBarPinned(false) unconditionally here.
        useSettingsStore.getState().setCmdBarPinned(false);
      }
    });
  }, [collapse]);

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
      setActivePrefix(next);
    },
    [],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      const cursor = event.target.selectionStart ?? value.length;
      setInputValue(value);
      recomputePrefix(value, cursor);
    },
    [recomputePrefix],
  );

  const handleSelectionChange = useCallback(
    (event: React.SyntheticEvent<HTMLInputElement>) => {
      // Ignore Escape's keyUp — its keyDown handler already cleared (or
      // collapsed) the prefix mode and we don't want to re-detect from the
      // unchanged input value and resurrect a badge the user just dismissed.
      if (
        "key" in event.nativeEvent &&
        (event.nativeEvent as KeyboardEvent).key === "Escape"
      ) {
        return;
      }
      const target = event.currentTarget;
      const cursor = target.selectionStart ?? target.value.length;
      recomputePrefix(target.value, cursor);
    },
    [recomputePrefix],
  );

  // ---------------------------------------------------------------------
  // Send (#23) — Enter (no active prefix) sends via the existing
  // `useAIOperations.sendChatMessage` pipeline. We REUSE this hook rather
  // than rebuild the streaming flow so the composer inherits provider
  // routing, project lock enforcement, segment isolation, and downstream
  // streaming behaviour from `ChatPanel`.
  //
  // Chip handling for v1 is pragmatic: when the message has chips, we
  // prepend a tiny `[refs: …]` block so the references reach the model as
  // text. Tag chips already arrive as literal `#tag` text (TagMode keeps
  // the literal); `file`, `person`, `comment`, `task`, and `research`
  // chips are inlined here.
  //
  // TODO(#25 / future): Replace the inline-text fallback with a structured
  // `references` field on `sendChatMessage` opts so the chat-store can
  // surface them as proper chips on the resulting user message (matching
  // today's image-attachment thumbnails).
  // ---------------------------------------------------------------------

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0 && chips.length === 0) {
      // Empty input AND no chips → no-op. Don't fire blank messages.
      return;
    }

    const refsBlock =
      chips.length > 0
        ? `[refs: ${chips.map((c) => `${c.kind}:${c.name}`).join(", ")}] `
        : "";
    const content = `${refsBlock}${trimmed}`;

    // Reset the composer optimistically — the send is async but the user
    // expects the input to clear immediately so they can keep typing.
    setInputValue("");
    setChips([]);
    setActivePrefix(null);

    // Fire-and-forget — the chat-store handles its own loading + error state
    // and the chat stream renders the assistant response.
    void sendChatMessage(content, messagesForSend);

    // Keep focus in the input for the next message. The autofocus effect on
    // `effectiveExpanded` doesn't re-fire when only the input value changes,
    // so we ensure focus explicitly here.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [inputValue, chips, sendChatMessage, messagesForSend]);

  // ---------------------------------------------------------------------
  // Stream → send bridge. `ChatMessageList` fires `onSend(content)` for
  // QuickReplies (user clicks a suggested follow-up) and onboarding
  // prompts (empty-state bubble buttons). Neither flows through the
  // composer input — they're direct send-a-specific-string calls, so
  // we bypass `handleSend`'s input-reading path and send `content`
  // verbatim.
  // ---------------------------------------------------------------------

  const handleStreamSend = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (trimmed.length === 0) return;
      void sendChatMessage(trimmed, messagesForSend);
    },
    [sendChatMessage, messagesForSend],
  );

  // onPrefill: stream's empty-state onboarding prompts. Drop the content
  // into the input so the user can tweak before sending.
  const handleStreamPrefill = useCallback(
    (text: string) => {
      setInputValue(text);
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [],
  );

  // Resend a user message — delete it + its descendants and send the same
  // content again. Matches the same-provider branch in
  // `ChatPanel.handleResend`; the cross-provider dialog is deferred to a
  // follow-up (needs shared extraction so both shells can render it).
  const handleStreamResend = useCallback(
    (message: ChatMessageType) => {
      if (message.id) {
        useChatStore.getState().deleteMessageAndDescendants(message.id);
      }
      const trimmed = message.content.trim();
      if (trimmed.length === 0) return;
      void sendChatMessage(trimmed, messagesForSend);
    },
    [sendChatMessage, messagesForSend],
  );

  // Edit a user message — prefill the composer with its content so the
  // user can tweak and send. Simplified vs `ChatPanel.handleEdit`: this
  // path doesn't track `parentId` for branching yet (send will append to
  // the current leaf instead of branching from the edited message's
  // parent). Branching parity is a follow-up.
  const handleStreamEdit = useCallback(
    (message: ChatMessageType) => {
      setInputValue(message.content);
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        // Two-stage Esc fall-through: when a prefix is active, the first Esc
        // dismisses the picker only and leaves the input + bar alone. The
        // user's literal text (including the prefix character) stays put.
        // A subsequent Esc collapses the bar.
        if (activePrefix) {
          setActivePrefix(null);
          return;
        }
        collapse();
        return;
      }
      if (event.key === "Enter") {
        // When a prefix is active, Enter is reserved for the picker (handled
        // by mode pickers in #14–#19). We must NOT swallow Enter here — the
        // picker component owns it.
        if (activePrefix) {
          return;
        }
        // Allow newlines via Shift+Enter for forward-compat (the input is a
        // single-line `<input>` today, so this branch is just a guard for
        // when the bar grows a textarea).
        if (event.shiftKey) return;
        event.preventDefault();
        handleSend();
        return;
      }
    },
    [activePrefix, collapse, handleSend],
  );

  // ---------------------------------------------------------------------
  // Mode picker dispatchers (#14–#19)
  //
  // Each picker emits a domain-specific selection; these handlers translate
  // the selection into input-text / chip-state mutations. After applying,
  // the active prefix is cleared (the picker has done its job) and focus
  // returns to the input.
  // ---------------------------------------------------------------------

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
    [activePrefix, inputValue],
  );

  const handlePickSkill = useCallback(
    (skillName: string) => {
      replaceActiveToken(`/${skillName} `);
    },
    [replaceActiveToken],
  );

  const handlePickTag = useCallback(
    (tagName: string) => {
      replaceActiveToken(`#${tagName} `);
    },
    [replaceActiveToken],
  );

  const handlePickReference = useCallback(
    (chip: AttachmentChip) => {
      addChip(chip);
      replaceActiveToken("");
    },
    [addChip, replaceActiveToken],
  );

  const handlePickResearch = useCallback(
    (chip: AttachmentChip) => {
      addChip(chip);
      replaceActiveToken("");
    },
    [addChip, replaceActiveToken],
  );

  const handlePickTask = useCallback(
    (action: TaskAction) => {
      if (action.kind === "attach") {
        addChip(action.chip);
        replaceActiveToken("");
        return;
      }
      // Navigate path is forward-declared — wired with global shortcuts in #20+.
      log.info("perf:cmdbar", "task-navigate stub", action);
      replaceActiveToken("");
    },
    [addChip, replaceActiveToken],
  );

  const handlePickPalette = useCallback(
    (commandId: string) => {
      // Real command execution wires up alongside the global shortcut hook in
      // #20+. For now, log and clear so the picker UX is testable end-to-end.
      log.info("perf:cmdbar", "palette-execute stub", { commandId });
      replaceActiveToken("");
    },
    [replaceActiveToken],
  );

  // ---------------------------------------------------------------------
  // Visual chrome
  //
  // The bar is the same DOM in both compact and expanded states — only the
  // size, contents, and lift offset differ. Tailwind `h-*` + `transition-all`
  // gives a smooth height/opacity morph; reduced-motion strips both the
  // transition utility and the lift transform.
  // ---------------------------------------------------------------------

  // Position / sizing depend on the current mode:
  //   - pinned       → fixed right-edge full-height side panel; width comes
  //                    from the `--cmd-bar-pinned-width` CSS variable so the
  //                    drag handle can mutate it without React re-renders
  //   - floating + expanded → centered overlay near the bottom, fixed width
  //   - floating + compact  → smaller pill, same horizontal centring
  //
  // In pinned mode the panel is always "expanded" — there's no compact pill
  // and no height collapse. We still funnel through `effectiveExpanded` so
  // a single conditional below picks the right content slot.
  const positionClasses = isPinned
    ? "fixed top-0 right-0 h-screen"
    : "fixed bottom-10 left-1/2 -translate-x-1/2";

  const widthClasses = isPinned
    ? // Width is driven by the CSS variable. We set a Tailwind w-* fallback
      // (defaults to PINNED_WIDTH_DEFAULT) for the very first paint before
      // the inline style is applied. `max-w-[90vw]` keeps the panel sane on
      // narrow windows.
      "max-w-[90vw]"
    : effectiveExpanded
      ? "w-[640px] max-w-[90vw]"
      : "w-[480px] max-w-[90vw]";

  const heightClasses = isPinned
    ? "" // pinned: full-screen height owned by `positionClasses`
    : effectiveExpanded
      ? "h-[480px]"
      : "h-12";

  // Pinned panel uses square corners on the right edge (it's flush against
  // the window) and only rounds the left side.
  const radiusClasses = isPinned
    ? "rounded-l-2xl rounded-r-none"
    : effectiveExpanded
      ? "rounded-2xl"
      : "rounded-xl";

  // 14 px lift on focus / when expanded — only for the floating overlay.
  // Pinned mode is permanent docking; lift would feel out of place.
  const liftClasses =
    !reducedMotion && expanded && !isPinned ? "-translate-y-[14px]" : "";

  // Fixed-position overlay needs a vertical translate that combines with
  // the horizontal -translate-x-1/2. We layer them via Tailwind's transform
  // composition: `-translate-x-1/2` already sets transform; the lift then
  // composes via the additional `-translate-y-[14px]` utility.

  const transitionClasses = reducedMotion
    ? ""
    : "transition-all duration-200 ease-out";

  // Inline style for pinned mode — the CSS variable cascades from <html>
  // (set by the resize-handle drag logic) so resizes don't re-render React.
  const inlineStyle: React.CSSProperties = isPinned
    ? { width: `var(--cmd-bar-pinned-width, ${PINNED_WIDTH_DEFAULT}px)` }
    : {};

  const bar = (
    <div
      data-cmd-bar
      data-cmd-bar-pinned={isPinned ? "true" : "false"}
      data-expanded={effectiveExpanded ? "true" : "false"}
      data-prefix-mode={activePrefix?.mode.id ?? ""}
      // Pinned mode is a permanent docked panel — give AT users a landmark to
      // jump to. Floating mode is a transient overlay; no region role applied
      // there per the spec (#82).
      role={isPinned ? "region" : undefined}
      aria-label={isPinned ? "Chat panel" : undefined}
      style={inlineStyle}
      className={cn(
        positionClasses,
        widthClasses,
        heightClasses,
        radiusClasses,
        liftClasses,
        transitionClasses,
        // z-30 in pinned mode — slightly behind floating overlays so dialogs
        // still appear on top. Floating mode keeps z-40 to sit above the
        // editor and friends.
        isPinned ? "z-30" : "z-40",
        "flex flex-col overflow-hidden",
        "border border-border bg-popover/95 backdrop-blur-md shadow-lg",
      )}
    >
      {/*
        Pinned-mode resize handle. A thin (6px) draggable strip on the LEFT
        edge of the panel. Hidden in floating mode — there's nothing to
        resize there.
       */}
      {isPinned ? <PinnedResizeHandle /> : null}

      {effectiveExpanded ? (
        <ExpandedContent
          inputRef={inputRef}
          inputValue={inputValue}
          activePrefix={activePrefix}
          activeOption={activeOption}
          onActiveOptionChange={setActiveOption}
          onInputChange={handleInputChange}
          onSelectionChange={handleSelectionChange}
          onKeyDown={handleKeyDown}
          chips={chips}
          onRemoveChip={removeChip}
          isComposing={isComposing}
          onPickSkill={handlePickSkill}
          onPickReference={handlePickReference}
          onPickTag={handlePickTag}
          onPickTask={handlePickTask}
          onPickResearch={handlePickResearch}
          onPickPalette={handlePickPalette}
          onStreamSend={handleStreamSend}
          onStreamPrefill={handleStreamPrefill}
          onStreamResend={handleStreamResend}
          onStreamEdit={handleStreamEdit}
        />
      ) : (
        <CompactContent onActivate={expand} />
      )}
    </div>
  );

  if (isPinned) {
    // Pinned mode: render inline (no portal). The fixed-positioning on the
    // bar itself is what docks it to the right edge — the parent QuietLayout
    // applies a corresponding padding-right so document content doesn't
    // slide under the panel.
    return bar;
  }

  // SSR / non-browser fallback: skip the portal entirely.
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(bar, document.body);
}

// ---------------------------------------------------------------------------
// PinnedResizeHandle — vertical drag handle on the left edge of the pinned
// panel. The actual width state lives in the `--cmd-bar-pinned-width` CSS
// variable on <html>; we only persist the final value to settings-store on
// pointerup / keyup. This keeps mousemove paths free of React re-renders.
// ---------------------------------------------------------------------------

function PinnedResizeHandle() {
  const persistedWidth = useSettingsStore((s) => s.cmdBarPinnedWidth);
  const setCmdBarPinnedWidth = useSettingsStore((s) => s.setCmdBarPinnedWidth);

  // Sync the persisted width to the CSS variable on mount and whenever the
  // store value changes (e.g., on rehydration after restart).
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--cmd-bar-pinned-width",
      `${persistedWidth}px`,
    );
  }, [persistedWidth]);

  // Pointer drag — write to the CSS variable on every move, persist on up.
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        // The panel docks to the right edge, so the new width is the
        // distance from the pointer to the right edge of the viewport.
        const next = Math.round(
          Math.max(
            PINNED_WIDTH_MIN,
            Math.min(PINNED_WIDTH_MAX, window.innerWidth - moveEvent.clientX),
          ),
        );
        document.documentElement.style.setProperty(
          "--cmd-bar-pinned-width",
          `${next}px`,
        );
      };

      const onUp = (upEvent: PointerEvent) => {
        const finalWidth = Math.round(
          Math.max(
            PINNED_WIDTH_MIN,
            Math.min(PINNED_WIDTH_MAX, window.innerWidth - upEvent.clientX),
          ),
        );
        setCmdBarPinnedWidth(finalWidth);
        target.releasePointerCapture(event.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setCmdBarPinnedWidth],
  );

  // Keyboard adjustment — ←/→ adjust width by ±20 px while focused. Persist
  // immediately (no need to defer; key events are coarse-grained).
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      // ArrowLeft makes the panel WIDER (it grows away from the right edge).
      const delta =
        event.key === "ArrowLeft"
          ? PINNED_WIDTH_KEYBOARD_STEP
          : -PINNED_WIDTH_KEYBOARD_STEP;
      const current = persistedWidth;
      const next = Math.max(
        PINNED_WIDTH_MIN,
        Math.min(PINNED_WIDTH_MAX, current + delta),
      );
      // Update the CSS variable immediately so the user sees the change,
      // then persist via the store setter (which will re-sync on the next
      // effect run, but this avoids any flicker).
      document.documentElement.style.setProperty(
        "--cmd-bar-pinned-width",
        `${next}px`,
      );
      setCmdBarPinnedWidth(next);
    },
    [persistedWidth, setCmdBarPinnedWidth],
  );

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Resize chat panel"
      aria-orientation="vertical"
      aria-valuemin={PINNED_WIDTH_MIN}
      aria-valuemax={PINNED_WIDTH_MAX}
      aria-valuenow={persistedWidth}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-cmd-bar-resize-handle
      className={cn(
        // Absolute-positioned strip on the left edge of the pinned panel.
        "absolute left-0 top-0 h-full w-1.5 cursor-col-resize",
        // Subtle accent on hover/focus so it's discoverable without being
        // visually noisy at rest.
        "bg-transparent hover:bg-border/60 transition-colors",
        "focus-visible:outline-none focus-visible:bg-border",
        // Sit above the panel content so pointer events land on the handle.
        "z-10",
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Sub-components — kept private to this module per the "one component per
// file" rule. These are pure visual fragments, not standalone components.
// ---------------------------------------------------------------------------

interface CompactContentProps {
  onActivate: () => void;
}

function CompactContent({ onActivate }: CompactContentProps) {
  return (
    <button
      type="button"
      onClick={onActivate}
      className={cn(
        "flex h-full w-full items-center justify-between px-4",
        "text-left text-sm text-muted-foreground",
        "hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
    >
      <span>{COMPACT_PLACEHOLDER}</span>
      <kbd className="hidden text-xs text-muted-foreground/70 sm:inline-flex">⌘K</kbd>
    </button>
  );
}

interface ActiveOptionInfo {
  listboxId: string;
  activeOptionId: string | null;
  count: number;
}

interface ExpandedContentProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputValue: string;
  activePrefix: ActivePrefix | null;
  /**
   * Currently-highlighted option in the open mode picker, reported up by the
   * picker via `onActiveOptionChange`. Wired through to `aria-controls` /
   * `aria-activedescendant` on the combobox input below (#78).
   */
  activeOption: ActiveOptionInfo | null;
  onActiveOptionChange: (info: ActiveOptionInfo) => void;
  onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectionChange: (event: React.SyntheticEvent<HTMLInputElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  chips: AttachmentChip[];
  onRemoveChip: (id: string) => void;
  isComposing: boolean;
  onPickSkill: (name: string) => void;
  onPickReference: (chip: AttachmentChip) => void;
  onPickTag: (name: string) => void;
  onPickTask: (action: TaskAction) => void;
  onPickResearch: (chip: AttachmentChip) => void;
  onPickPalette: (commandId: string) => void;
  /**
   * Stream-originated send (QuickReplies, onboarding prompts). Bypasses
   * the composer input — content is sent verbatim.
   */
  onStreamSend: (content: string) => void;
  /**
   * Stream-originated prefill (empty-state onboarding prompts). Drops
   * the content into the composer input and focuses.
   */
  onStreamPrefill: (text: string) => void;
  /**
   * Per-user-message Resend button (same-provider path). Deletes the
   * message + descendants and re-sends the content.
   */
  onStreamResend: (message: ChatMessageType) => void;
  /**
   * Per-user-message Edit button — prefills the composer with the
   * message content and focuses.
   */
  onStreamEdit: (message: ChatMessageType) => void;
}

function ExpandedContent({
  inputRef,
  inputValue,
  activePrefix,
  activeOption,
  onActiveOptionChange,
  onInputChange,
  onSelectionChange,
  onKeyDown,
  chips,
  onRemoveChip,
  isComposing,
  onPickSkill,
  onPickReference,
  onPickTag,
  onPickTask,
  onPickResearch,
  onPickPalette,
  onStreamSend,
  onStreamPrefill,
  onStreamResend,
  onStreamEdit,
}: ExpandedContentProps) {
  return (
    <div className="flex h-full flex-col">
      {/*
        Layout (top → bottom):
          - Context row (#10) — provider, projects, mode, history, pin
          - Chat stream (#12) — fills the scroll region below
          - Attachment chips (#11) — above the input
          - Mode pickers (#14–#19) — rendered when `activePrefix` is non-null
       */}
      <CommandBarContext />

      <CommandBarStream
        onSend={onStreamSend}
        onPrefill={onStreamPrefill}
        onResend={onStreamResend}
        onEdit={onStreamEdit}
      />

      {/* #11 — Attachment chips strip. Renders nothing while `chips` is empty. */}
      <AttachmentChips chips={chips} onRemove={onRemoveChip} />

      {activePrefix ? <PrefixModeBadge prefix={activePrefix} /> : null}

      {activePrefix ? (
        <ModePickerDispatch
          activePrefix={activePrefix}
          isComposing={isComposing}
          onActiveOptionChange={onActiveOptionChange}
          onPickSkill={onPickSkill}
          onPickReference={onPickReference}
          onPickTag={onPickTag}
          onPickTask={onPickTask}
          onPickResearch={onPickResearch}
          onPickPalette={onPickPalette}
        />
      ) : null}

      <div className="border-t border-border px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          // The input doubles as a combobox when a prefix-mode picker is open
          // (#78): the picker's listbox stays focus-free, and the input
          // mirrors the highlighted option via `aria-activedescendant`. When
          // no picker is open, the combobox is collapsed (`aria-expanded` is
          // false) and `aria-controls`/`aria-activedescendant` are unset.
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={Boolean(activePrefix)}
          aria-autocomplete="list"
          aria-controls={activeOption?.listboxId}
          aria-activedescendant={activeOption?.activeOptionId ?? undefined}
          value={inputValue}
          onChange={onInputChange}
          onKeyUp={onSelectionChange}
          onClick={onSelectionChange}
          onKeyDown={onKeyDown}
          placeholder="Ask, search, or type / for skills…"
          className={cn(
            "w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground",
            "outline-none",
          )}
        />
      </div>
    </div>
  );
}

interface PrefixModeBadgeProps {
  prefix: ActivePrefix;
}

/**
 * Visual indicator that a prefix mode is active. The actual mode picker
 * dropdown (file/skill/tag list, keyboard nav) is built in #14–#19; this
 * badge is just the signal that detection works and previews the mode
 * metadata until the pickers land.
 */
function PrefixModeBadge({ prefix }: PrefixModeBadgeProps) {
  return (
    <div
      data-cmd-bar-prefix-badge
      role="status"
      aria-live="polite"
      className={cn(
        "border-t border-border px-3 py-2",
        "flex items-center gap-2 text-xs text-muted-foreground",
      )}
    >
      <span className="font-medium text-foreground">{prefix.mode.label}</span>
      <span className="text-muted-foreground/70">·</span>
      <kbd className="rounded bg-muted px-1 py-px text-[11px] text-foreground">
        {prefix.mode.prefix}
      </kbd>
      <span>{prefix.mode.description}</span>
    </div>
  );
}

interface ModePickerDispatchProps {
  activePrefix: ActivePrefix;
  isComposing: boolean;
  onActiveOptionChange: (info: ActiveOptionInfo) => void;
  onPickSkill: (name: string) => void;
  onPickReference: (chip: AttachmentChip) => void;
  onPickTag: (name: string) => void;
  onPickTask: (action: TaskAction) => void;
  onPickResearch: (chip: AttachmentChip) => void;
  onPickPalette: (commandId: string) => void;
}

/**
 * Stable per-mode listbox ids — used by the input's `aria-controls` and as
 * the option-id prefix every picker emits (`${listboxId}-opt-${i}`). Keeping
 * one fixed id per mode means tests and DOM queries can target a known id
 * without race conditions on `useId()` regeneration across renders.
 */
const MODE_LISTBOX_IDS: Record<string, string> = {
  skill: "cmd-skill-listbox",
  reference: "cmd-reference-listbox",
  tag: "cmd-tag-listbox",
  task: "cmd-task-listbox",
  research: "cmd-research-listbox",
  palette: "cmd-palette-listbox",
};

/**
 * Picker dispatcher — selects the mode-specific picker based on the active
 * prefix's mode id. Each picker is a standalone component (#14–#19); the
 * dispatcher is just the route table. Forwards the stable listbox id and
 * the active-option callback so the parent can mirror highlight state on
 * the combobox input via `aria-activedescendant` (#78).
 */
function ModePickerDispatch({
  activePrefix,
  isComposing,
  onActiveOptionChange,
  onPickSkill,
  onPickReference,
  onPickTag,
  onPickTask,
  onPickResearch,
  onPickPalette,
}: ModePickerDispatchProps) {
  const filter = activePrefix.filter;
  const listboxId = MODE_LISTBOX_IDS[activePrefix.mode.id];
  switch (activePrefix.mode.id) {
    case "skill":
      return (
        <SkillMode
          filter={filter}
          onPick={onPickSkill}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
    case "reference":
      return (
        <ReferenceMode
          filter={filter}
          onPick={onPickReference}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
    case "tag":
      return (
        <TagMode
          filter={filter}
          onPick={onPickTag}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
    case "task":
      return (
        <TaskMode
          filter={filter}
          onPick={onPickTask}
          isComposing={isComposing}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
    case "research":
      return (
        <ResearchMode
          filter={filter}
          onPick={onPickResearch}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
    case "palette":
      return (
        <PaletteMode
          filter={filter}
          onPick={onPickPalette}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
  }
}

export default FloatingCommandBar;
