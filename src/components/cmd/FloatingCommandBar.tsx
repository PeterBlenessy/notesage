import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useSettingsStore } from "@/stores/settings-store";
import { useChatStore, selectMessages, selectProjectPaths } from "@/stores/chat-store";
import { ChatHistoryView } from "@/components/chat/ChatHistoryView";
import { ContextPill } from "@/components/chat/ContextPill";
import { useChatContext } from "@/hooks/useChatContext";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { FILE_DRAG_MIME } from "@/components/sidebar/quiet/file-drag";
import { useAIOperations } from "@/hooks/useAIOperations";
import { useRoutingStore } from "@/stores/routing-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { toast } from "sonner";
import { ArrowUp, ImagePlus, Mic, MicOff, Plus, Square, X } from "lucide-react";
import type { ChatMessage as ChatMessageType, ImageAttachment } from "@/lib/ai/types";
import { compressImage } from "@/lib/image-compress";
import {
  registerSendImageHandler,
  unregisterSendImageHandler,
} from "@/lib/ai/vision";
import { AttachmentStrip } from "@/components/chat/AttachmentStrip";
import {
  ResendProviderDialog,
  type ResendProviderChoice,
  type ResendProviderOption,
} from "@/components/chat/ResendProviderDialog";
import {
  expandSkillPrefix,
  interpretAgentPrefix,
} from "@/lib/ai/chat-expansion";
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
  // one-stage collapse). The write happens DURING RENDER (not in useEffect)
  // so the ref is always in sync with the latest committed state by the
  // time React's commit phase finishes — eliminating any possibility of
  // a window-level keydown firing before the post-commit useEffect mirrors
  // the ref. (Mirror-via-useEffect was the previous pattern; #149 review
  // surfaced the timing race as a likely culprit for "Esc collapses bar
  // mid-edit" reports.)
  const activePrefixRef = useRef<ActivePrefix | null>(null);
  activePrefixRef.current = activePrefix;
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
  const { sendChatMessage, cancelChat } = useAIOperations();
  const isLoading = useChatStore((s) => s.isLoading);

  // #118 — chatView toggles the expanded bar between its usual chat
  // stream and a past-conversation list. The clock icon in
  // `CommandBarContext` fires `toggle-history` on the bus; the
  // subscription below flips this state. Selecting a conversation from
  // the list returns to chat mode (same UX as legacy `ChatPanel`).
  const [chatView, setChatView] = useState<"chat" | "history">("chat");
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveConversation(id);
      setChatView("chat");
    },
    [setActiveConversation],
  );

  // #134 — context chips + explicit-attach offer. Mirrors the legacy
  // ChatInput's render: auto-attached files appear as ContextPill rows
  // above the input; when the active tab sits outside the selected
  // project scope, an "Add this file to chat" affordance lets the user
  // opt in. The hook is shared with ChatInput; reading it here keeps
  // the UX consistent across shells.
  const {
    contextItems,
    dismissItem,
    explicitAttachOffer,
    attachExplicit,
  } = useChatContext();

  // #133 — dictation. The hook tries Web Speech first and falls back
  // to whisper-rs in WKWebView. `finalText` accumulates as transcription
  // completes; `interimText` is the live "still hearing you" preview
  // shown as a placeholder while dictating. Mirrors the legacy
  // `ChatInput` wiring exactly.
  const {
    startDictation,
    stopDictation,
    isDictating,
    interimText,
    finalText,
  } = useSpeechRecognition();
  const handleMicToggle = useCallback(async () => {
    if (isDictating) await stopDictation();
    else await startDictation();
  }, [isDictating, startDictation, stopDictation]);

  // Append `finalText` to the composer input as the dictation engine
  // finalises each chunk. Same append shape ChatInput uses (a single
  // space separator so the user can keep typing in between).
  useEffect(() => {
    if (!finalText) return;
    setInputValue((prev) => (prev ? `${prev} ${finalText}` : finalText));
  }, [finalText]);

  // #127 parity — connection + routing state for the cross-provider
  // resend/edit dialog. Mirrors the logic ChatPanel uses (minus the
  // per-project `ai.provider` override layer; a follow-up can extract
  // that into a shared hook if needed).
  const interactiveConnection = useRoutingStore((s) =>
    s.getConnectionForUseCase("interactive"),
  );
  const allConnections = useConnectionsStore((s) => s.connections);
  const setRouting = useRoutingStore((s) => s.setRouting);

  // #127 parity — edit-mode state. When the user clicks Edit on a user
  // message, we capture the original parentId + connectionId so the
  // follow-up send can (a) branch from the edited message's parent
  // instead of appending to the leaf, and (b) surface a cross-provider
  // dialog if the active connection now differs.
  const [editContext, setEditContext] = useState<{
    parentId: string | null;
    originalContent: string;
    originalConnectionId?: string;
  } | null>(null);
  // Mirror on a ref so the bus-subscription effect can read the latest
  // edit-mode state without being in its deps. Drives the Esc stage
  // chain: typed-prefix → clear prefix; edit mode → cancel edit; neither
  // → collapse. Same render-phase write as `activePrefixRef` above —
  // post-commit useEffect mirroring left an open window where a fast
  // Esc keydown could fire with a stale ref and fall through to
  // collapse() instead of cancelling the edit (#149).
  const editContextRef = useRef<typeof editContext>(null);
  editContextRef.current = editContext;

  // #126 parity — image attachments. Paste, drag-drop, and the file
  // picker all dump ImageAttachments into this state; `handleSend` then
  // hands them to `sendChatMessage` where the Rust backend serializes
  // them per-provider. Cleared on successful send. The legacy
  // `AttachmentStrip` component handles thumbnail rendering (see the
  // render block below the input).
  const [pendingAttachments, setPendingAttachments] = useState<
    ImageAttachment[]
  >([]);
  const addImageAttachment = useCallback((att: ImageAttachment) => {
    setPendingAttachments((prev) => {
      // Cap at 5 to match ChatInput's limit (user-facing toast if we
      // hit it — simpler than growing the strip unboundedly).
      if (prev.length >= 5) {
        toast.error("Max 5 images per message");
        return prev;
      }
      return [...prev, att];
    });
  }, []);
  const removeImageAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // #126 parity — subscribe to the vision event bus so editor "Add to
  // chat" actions and sidebar drops route their images into the
  // composer. Legacy `ChatInput` owns the same subscription; we mirror
  // it here so the Quiet shell gets the same behaviour. Mounted once
  // per bar instance — the bus rejects duplicate registrations.
  useEffect(() => {
    registerSendImageHandler((attachment) => {
      addImageAttachment(attachment);
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => unregisterSendImageHandler();
  }, [addImageAttachment]);

  // #126 parity — pick images via the native dialog. Mirrors
  // `ChatInput.handleAttachClick`: read bytes + compress + push to the
  // strip. The file dialog is dynamically imported so the Tauri plugin
  // only loads when the user actually clicks the button.
  const handleImagePick = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"],
          },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        try {
          const bytes = await (await import("@/lib/tauri")).tauriApi.readBinaryFile(path);
          const name = path.split("/").pop() ?? "image";
          const ext = name.split(".").pop()?.toLowerCase() ?? "";
          const mimeMap: Record<string, string> = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            webp: "image/webp",
            bmp: "image/bmp",
            svg: "image/svg+xml",
          };
          const blob = new Blob([new Uint8Array(bytes)], {
            type: mimeMap[ext] ?? "image/png",
          });
          const attachment = await compressImage(blob, { name });
          addImageAttachment(attachment);
        } catch (err) {
          toast.error(`Failed to attach ${path}: ${err}`);
        }
      }
    } catch (err) {
      toast.error(`Failed to open image picker: ${err}`);
    }
  }, [addImageAttachment]);

  // #127 parity — cross-provider resend/edit dialog state. Opens when
  // the message's recorded connectionId differs from the active
  // `interactiveConnection`. ChatPanel owns the same state machine for
  // the legacy surface.
  interface ResendDialogState {
    mode: "resend" | "edit";
    content: string;
    messageIdToDelete?: string;
    originalConnectionId: string;
    currentConnectionId: string | null;
  }
  const [resendDialog, setResendDialog] = useState<ResendDialogState | null>(
    null,
  );

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
    // Reset the typed-prefix dismissal suppression so the next time the
    // bar expands, the picker is willing to open again on the next `/`.
    dismissedPrefixRef.current = null;
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

        if (editContextRef.current) {
          // #127 iter-2 — Esc cancels edit mode before collapsing.
          setEditContext(null);
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

      if (event.type === 'toggle-pin') {
        // #121 — ⌘⇧C pressed while the bar is expanded AND pinned. Flip the
        // pin off so the user returns to the floating overlay. The chord's
        // emit site in `useKeyboardShortcuts` already validated the state,
        // so we can setCmdBarPinned(false) unconditionally here.
        useSettingsStore.getState().setCmdBarPinned(false);
      }

      if (event.type === 'toggle-history') {
        // #118 — Clock icon in the context row (and ⌘⇧H when wired)
        // flips the stream area between the chat view and the past-
        // conversation list. Ensure the bar is expanded so the new
        // mode has somewhere to render.
        setExpanded(true);
        setChatView((prev) => (prev === 'history' ? 'chat' : 'history'));
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
          return;
        }
        // Pattern broken — clear suppression so future prefixes work.
        dismissedPrefixRef.current = null;
      }

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

  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0 && chips.length === 0 && pendingAttachments.length === 0) {
      // Empty input AND no chips AND no images → no-op.
      return;
    }

    const refsBlock =
      chips.length > 0
        ? `[refs: ${chips.map((c) => `${c.kind}:${c.name}`).join(", ")}] `
        : "";
    const rawContent = `${refsBlock}${trimmed}`;

    // #126 parity — `@agent-name` / `/skill-name` expansion at send time.
    // ChatPanel.doSend does the same pipeline via the shared helpers in
    // `src/lib/ai/chat-expansion.ts`. Skipping these would send the
    // literal prefix as model input, losing the agent swap + skill-body
    // injection the user expects.
    const agentResult = interpretAgentPrefix(rawContent, interactiveConnection);
    if (agentResult.skipSend) {
      // Only a bare `@agent-name` was typed — active agent has been
      // swapped; nothing more to do.
      setInputValue("");
      setChips([]);
      setActivePrefix(null);
      return;
    }
    const skillResult = await expandSkillPrefix(agentResult.content);
    if (skillResult.abortSend) return;
    const content = skillResult.content;

    // #127 parity — if we're editing a message and the active connection
    // now differs from the message's original connectionId, open the
    // dialog instead of sending. On confirm the dialog will fire the
    // actual send with the selected routing.
    if (
      editContext?.originalConnectionId &&
      editContext.originalConnectionId !== (interactiveConnection?.id ?? null)
    ) {
      setResendDialog({
        mode: "edit",
        content,
        originalConnectionId: editContext.originalConnectionId,
        currentConnectionId: interactiveConnection?.id ?? null,
      });
      // Leave editContext in place — the dialog's confirm path clears it
      // via `doSend` (same semantics as ChatPanel).
      return;
    }

    // Reset the composer optimistically — the send is async but the user
    // expects the input to clear immediately so they can keep typing.
    setInputValue("");
    setChips([]);
    setActivePrefix(null);

    // #127 parity — when editing, branch from the edited message's
    // parent instead of appending to the leaf. The chat-store's send
    // pipeline honours `parentId` in opts.
    // #126 parity — when a skill expanded, pass `displayContent` +
    // `skillName` so the user-visible bubble shows the original text
    // (not the expanded prompt) and the activity log tags the skill.
    const sendOpts: Record<string, unknown> = {};
    if (editContext) sendOpts.parentId = editContext.parentId;
    if (skillResult.skillName) {
      sendOpts.displayContent = rawContent;
      sendOpts.skillName = skillResult.skillName;
    }
    // #126 parity — image attachments reach the provider via the same
    // `attachments` opt ChatPanel uses. Cleared optimistically alongside
    // the input / chips.
    if (pendingAttachments.length > 0) {
      sendOpts.attachments = pendingAttachments;
      setPendingAttachments([]);
    }
    if (editContext) setEditContext(null);

    // Fire-and-forget — the chat-store handles its own loading + error state
    // and the chat stream renders the assistant response.
    void sendChatMessage(
      content,
      messagesForSend,
      Object.keys(sendOpts).length > 0 ? sendOpts : undefined,
    );

    // Keep focus in the input for the next message. The autofocus effect on
    // `effectiveExpanded` doesn't re-fire when only the input value changes,
    // so we ensure focus explicitly here.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [
    inputValue,
    chips,
    pendingAttachments,
    sendChatMessage,
    messagesForSend,
    editContext,
    interactiveConnection,
  ]);

  // ---------------------------------------------------------------------
  // Stream → send bridge. `ChatMessageList` fires `onSend(content)` for
  // QuickReplies (user clicks a suggested follow-up) and onboarding
  // prompts (empty-state bubble buttons). Neither flows through the
  // composer input — they're direct send-a-specific-string calls, so
  // we bypass `handleSend`'s input-reading path and send `content`
  // verbatim.
  // ---------------------------------------------------------------------

  const handleStreamSend = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (trimmed.length === 0) return;

      // #126 parity — stream-originated sends (QuickReplies / onboarding
      // prompts) run through the same `@agent` / `/skill` pipeline as
      // the composer send. A quick-reply chip that begins with
      // `/research-source` should still hydrate the skill body.
      const agentResult = interpretAgentPrefix(trimmed, interactiveConnection);
      if (agentResult.skipSend) return;
      const skillResult = await expandSkillPrefix(agentResult.content);
      if (skillResult.abortSend) return;

      const sendOpts = skillResult.skillName
        ? { displayContent: trimmed, skillName: skillResult.skillName }
        : undefined;
      void sendChatMessage(skillResult.content, messagesForSend, sendOpts);
    },
    [sendChatMessage, messagesForSend, interactiveConnection],
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

  // Resend a user message — same-provider path deletes + re-sends. On
  // cross-provider mismatch we open `ResendProviderDialog` so the user
  // can pick which connection receives the resend. Mirrors
  // `ChatPanel.handleResend` for #127 parity.
  const handleStreamResend = useCallback(
    (message: ChatMessageType) => {
      const currentId = interactiveConnection?.id ?? null;
      const originalId = message.connectionId ?? null;

      if (originalId && originalId !== currentId) {
        setResendDialog({
          mode: "resend",
          content: message.content,
          messageIdToDelete: message.id,
          originalConnectionId: originalId,
          currentConnectionId: currentId,
        });
        return;
      }

      if (message.id) {
        useChatStore.getState().deleteMessageAndDescendants(message.id);
      }
      const trimmed = message.content.trim();
      if (trimmed.length === 0) return;
      void sendChatMessage(trimmed, messagesForSend);
    },
    [sendChatMessage, messagesForSend, interactiveConnection?.id],
  );

  // Edit a user message — prefill the composer + capture edit context so
  // (a) the next send branches from the edited message's parent and (b)
  // a provider-mismatch dialog can fire at send time if the active
  // connection differs from the message's original `connectionId`.
  const handleStreamEdit = useCallback(
    (message: ChatMessageType) => {
      setEditContext({
        parentId: message.parentId !== undefined ? message.parentId : null,
        originalContent: message.content,
        originalConnectionId: message.connectionId,
      });
      setInputValue(message.content);
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [],
  );

  const clearEditContext = useCallback(() => setEditContext(null), []);

  // #127 parity — dialog confirm/cancel + memoized options for the
  // `ResendProviderDialog` render. Mirrors ChatPanel's handlers.
  const handleResendDialogConfirm = useCallback(
    (choice: ResendProviderChoice) => {
      const dialog = resendDialog;
      if (!dialog) return;
      setResendDialog(null);

      const targetId =
        choice === "original"
          ? dialog.originalConnectionId
          : dialog.currentConnectionId;

      // Resend path deletes the original response tree; edit-send never
      // deletes — it branches from the parentId captured in editContext.
      if (dialog.mode === "resend" && dialog.messageIdToDelete) {
        useChatStore
          .getState()
          .deleteMessageAndDescendants(dialog.messageIdToDelete);
      }

      // Per-dialog send opts differ by mode:
      //   - resend: always a fresh send of `dialog.content`
      //   - edit:   honor editContext.parentId so the edit branches from
      //             the right place; clear editContext after scheduling.
      const parentId =
        dialog.mode === "edit" ? editContext?.parentId ?? null : undefined;

      // Reset composer optimistically for edit sends (resend doesn't touch
      // the input — the content came straight from the message record).
      if (dialog.mode === "edit") {
        setInputValue("");
        setChips([]);
        setActivePrefix(null);
        setEditContext(null);
      }

      const runSend = () => {
        void sendChatMessage(
          dialog.content,
          messagesForSend,
          parentId !== undefined ? { parentId } : undefined,
        );
      };

      if (targetId && targetId !== (interactiveConnection?.id ?? null)) {
        // Reroute then schedule the send after React flush so the send
        // hooks pick up the rebuilt routing closure.
        setRouting("interactive", targetId);
        setTimeout(runSend, 0);
      } else {
        runSend();
      }
    },
    [
      resendDialog,
      editContext?.parentId,
      interactiveConnection?.id,
      setRouting,
      sendChatMessage,
      messagesForSend,
    ],
  );

  const handleResendDialogCancel = useCallback(() => {
    setResendDialog(null);
    // Leave editContext in place on cancel so the user can adjust or
    // abandon the edit themselves.
  }, []);

  const resendDialogOptions = useMemo<
    | { original: ResendProviderOption; current: ResendProviderOption; isEdit: boolean }
    | null
  >(() => {
    if (!resendDialog) return null;
    const originalConn =
      allConnections.find((c) => c.id === resendDialog.originalConnectionId) ??
      null;
    const currentConn = resendDialog.currentConnectionId
      ? allConnections.find((c) => c.id === resendDialog.currentConnectionId) ??
        null
      : null;

    const original: ResendProviderOption = {
      id: resendDialog.originalConnectionId,
      label:
        originalConn?.label ??
        `Removed connection (${resendDialog.originalConnectionId.slice(0, 8)}…)`,
      provider: originalConn?.provider ?? null,
      disabled: !originalConn,
      disabledReason: !originalConn
        ? `Original provider (${resendDialog.originalConnectionId}) is no longer connected.`
        : undefined,
    };
    const current: ResendProviderOption = {
      id: resendDialog.currentConnectionId,
      label: currentConn?.label ?? "No provider selected",
      provider: currentConn?.provider ?? null,
      disabled: !currentConn,
      disabledReason: !currentConn
        ? "No provider is currently selected. Configure one in Settings."
        : undefined,
    };
    return { original, current, isEdit: resendDialog.mode === "edit" };
  }, [resendDialog, allConnections]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        // #127/#126 fix — do NOT handle Esc locally. The window-level
        // `useCommandBarShortcuts` hook also fires Esc → emits a
        // `dismiss` event on the bus. Handling Esc in both places
        // raced: the local handler cleared the prefix, then the bus
        // saw no prefix and collapsed the bar. The bus subscriber is
        // now the single source of truth for the three-stage chain
        // (typed prefix → edit mode → collapse). We let the event
        // bubble untouched so the keyboard hook picks it up.
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
        // `handleSend` is async (the `/skill-name` pipeline loads the skill
        // body via Tauri before dispatching the send). Fire and forget —
        // the chat stream owns the loading state.
        void handleSend();
        return;
      }
    },
    [activePrefix, editContext, collapse, handleSend],
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
          editing={editContext !== null}
          onCancelEdit={clearEditContext}
          pendingAttachments={pendingAttachments}
          onRemoveAttachment={removeImageAttachment}
          onAddAttachment={addImageAttachment}
          onPickImage={handleImagePick}
          isLoading={isLoading}
          onStop={cancelChat}
          onSend={handleSend}
          chatView={chatView}
          onSelectConversation={handleSelectConversation}
          selectedProjectPaths={selectedProjectPaths}
          contextItems={contextItems}
          onDismissContext={dismissItem}
          explicitAttachOffer={explicitAttachOffer}
          onAttachExplicit={attachExplicit}
          isDictating={isDictating}
          interimText={interimText}
          onMicToggle={handleMicToggle}
        />
      ) : (
        <CompactContent onActivate={expand} />
      )}

      {/* #127 parity — cross-provider resend/edit confirmation dialog.
       *  Rendered inside the bar so it participates in the portal (when
       *  the bar is floating-portaled) and in-flow (when pinned).
       *  `ResendProviderDialog` itself uses a Radix `AlertDialog` which
       *  portal-mounts its content, so actual placement is handled by
       *  Radix regardless of where this JSX lives.
       */}
      {resendDialogOptions && resendDialog ? (
        <ResendProviderDialog
          open={!!resendDialog}
          onOpenChange={(next) => {
            if (!next) handleResendDialogCancel();
          }}
          original={resendDialogOptions.original}
          current={resendDialogOptions.current}
          isEdit={resendDialogOptions.isEdit}
          onConfirm={handleResendDialogConfirm}
        />
      ) : null}
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
  // Live-test 2026-04-25 — the right-aligned `⌘K` <kbd> hint was
  // removed because COMPACT_PLACEHOLDER ("Press ⌘K to ask") on the
  // left already names the chord. Showing it twice in the same pill
  // was redundant and over-informing — the user explicitly asked us
  // to "focus on simplicity" in this batch. Centering the placeholder
  // also reads better than the previous left-justified + right-kbd
  // layout for a single-line pill.
  return (
    <button
      type="button"
      onClick={onActivate}
      className={cn(
        "flex h-full w-full items-center justify-center px-4",
        "text-left text-sm text-muted-foreground",
        "hover:text-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
    >
      <span>{COMPACT_PLACEHOLDER}</span>
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
  /** Whether the composer is in edit mode (#127 — shows banner). */
  editing: boolean;
  /** Cancel edit mode (× on banner or Esc when banner is visible). */
  onCancelEdit: () => void;
  /** #126 — pending image attachments for the next send. */
  pendingAttachments: ImageAttachment[];
  /** #126 — remove a pending image attachment by id. */
  onRemoveAttachment: (id: string) => void;
  /** #126 — push a new image attachment (paste + drop handlers). */
  onAddAttachment: (attachment: ImageAttachment) => void;
  /** #126 — open the native image picker dialog. */
  onPickImage: () => void;
  /** #126 — whether a send is currently streaming (drives the Stop button). */
  isLoading: boolean;
  /** #126 — cancel the in-flight send. */
  onStop: () => void;
  /** #126 — fire the send pipeline (click-to-send button). */
  onSend: () => void;
  /** #118 — 'chat' shows the stream, 'history' shows past conversations. */
  chatView: "chat" | "history";
  /** #118 — select a conversation from the history list. */
  onSelectConversation: (id: string) => void;
  /** #118 — selected projects filter for ChatHistoryView. */
  selectedProjectPaths: string[];
  /** #134 — auto-attached context items (active tab, etc.). */
  contextItems: import("@/hooks/useChatContext").ContextItem[];
  /** #134 — dismiss a context item by id. */
  onDismissContext: (id: string) => void;
  /** #134 — offer to attach the active tab when it's out of scope. */
  explicitAttachOffer: import("@/hooks/useChatContext").ExplicitAttachOffer | null;
  /** #134 — accept the explicit-attach offer. */
  onAttachExplicit: (path: string, label: string) => void;
  /** #133 — dictation active state (drives Mic vs MicOff icon). */
  isDictating: boolean;
  /** #133 — live transcription preview shown as the input placeholder. */
  interimText: string;
  /** #133 — toggle dictation. */
  onMicToggle: () => void;
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
  editing,
  onCancelEdit,
  pendingAttachments,
  onRemoveAttachment,
  onAddAttachment,
  onPickImage,
  isLoading,
  onStop,
  onSend,
  chatView,
  onSelectConversation,
  selectedProjectPaths,
  contextItems,
  onDismissContext,
  explicitAttachOffer,
  onAttachExplicit,
  isDictating,
  interimText,
  onMicToggle,
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

      {chatView === "history" ? (
        // #118 — Past-conversation list. Reuses the legacy
        // `ChatHistoryView` so selection behaviour + per-conversation
        // metadata (date, title, message count, branch count) matches
        // the classic shell. Selecting a conversation flips back to
        // chat view via `onSelectConversation`.
        <div className="flex flex-1 flex-col min-h-0">
          <ChatHistoryView
            onSelectConversation={onSelectConversation}
            selectedProjectPaths={selectedProjectPaths}
          />
        </div>
      ) : (
        <CommandBarStream
          onSend={onStreamSend}
          onPrefill={onStreamPrefill}
          onResend={onStreamResend}
          onEdit={onStreamEdit}
        />
      )}

      {/* #134 — context chips + explicit-attach offer. Auto-attached
       *  files (active tab when in scope) render as `ContextPill`s.
       *  When the active tab sits outside the selected project scope,
       *  the explicit-attach offer becomes a dashed "+ Add … to chat"
       *  button so the user can opt in manually. Renders nothing when
       *  both are empty so the input row stays compact.
       */}
      {(contextItems.length > 0 || explicitAttachOffer) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2 pb-1">
          {contextItems.map((item) => (
            <ContextPill
              key={item.id}
              item={item}
              onDismiss={onDismissContext}
            />
          ))}
          {explicitAttachOffer && (
            <button
              type="button"
              onClick={() =>
                onAttachExplicit(
                  explicitAttachOffer.path,
                  explicitAttachOffer.label,
                )
              }
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-muted text-xs px-1.5 py-0.5 max-w-[220px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              title={`Add ${explicitAttachOffer.path} to chat (outside selected project scope)`}
              aria-label={`Add ${explicitAttachOffer.label} to chat`}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="truncate">
                Add {explicitAttachOffer.label} to chat
              </span>
            </button>
          )}
        </div>
      )}

      {/* #127 parity — edit-mode banner. Appears above the input when the
       *  user clicked Edit on a previous user message. Clicking the × or
       *  pressing Cancel abandons the edit without sending.
       */}
      {editing ? (
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-xs text-muted-foreground">Editing message</span>
          <button
            type="button"
            onClick={onCancelEdit}
            className="h-4 w-4 rounded flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            title="Cancel editing"
            aria-label="Cancel editing"
          >
            <X className="h-3 w-3" strokeWidth={1.5} />
          </button>
        </div>
      ) : null}

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

      {/* #126 parity — image attachment thumbnails. Renders nothing when
         *  `pendingAttachments` is empty. Shares the exact `AttachmentStrip`
         *  component the legacy shell uses so thumbnails + remove buttons
         *  behave identically. */}
      {pendingAttachments.length > 0 && (
        <AttachmentStrip
          attachments={pendingAttachments}
          onRemove={onRemoveAttachment}
        />
      )}

      <div
        className="border-t border-border px-3 py-2 flex items-center gap-2"
        onPaste={async (event) => {
          // #126 parity — paste handler reads the first image item off
          // the clipboard and compresses it before pushing onto the strip.
          const items = event.clipboardData?.items;
          if (!items) return;
          for (const item of items) {
            if (item.kind === "file" && item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (!file) continue;
              event.preventDefault();
              try {
                const attachment = await compressImage(file, { name: file.name });
                onAddAttachment(attachment);
              } catch (err) {
                toast.error(`Failed to attach pasted image: ${err}`);
              }
            }
          }
        }}
        onDragOver={(event) => {
          // Signal the drop target for OS file drags AND for sidebar
          // file-row drags (#135). Without `preventDefault` the drop
          // event never fires.
          const types = event.dataTransfer?.types;
          if (
            types?.includes("Files") ||
            types?.includes(FILE_DRAG_MIME)
          ) {
            event.preventDefault();
          }
        }}
        onDrop={async (event) => {
          // OS file drag (Finder etc.) — accept image files.
          const files = event.dataTransfer?.files;
          if (files && files.length > 0) {
            const images = Array.from(files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (images.length > 0) {
              event.preventDefault();
              for (const file of images) {
                try {
                  const attachment = await compressImage(file, {
                    name: file.name,
                  });
                  onAddAttachment(attachment);
                } catch (err) {
                  toast.error(`Failed to attach ${file.name}: ${err}`);
                }
              }
              return;
            }
          }

          // #135 — sidebar drag-to-chat. Sidebar file rows stamp drags
          // with `FILE_DRAG_MIME` carrying the absolute file path. If
          // the path points at an image, read its bytes via tauriApi,
          // compress, and push to the attachment strip — same shape as
          // SidebarContextMenu's "Add to chat" action.
          const sidebarPath = event.dataTransfer?.getData(FILE_DRAG_MIME);
          if (sidebarPath) {
            event.preventDefault();
            const lower = sidebarPath.toLowerCase();
            const isImage = /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(lower);
            if (!isImage) return;
            try {
              const { tauriApi } = await import("@/lib/tauri");
              const bytes = await tauriApi.readBinaryFile(sidebarPath);
              const name = sidebarPath.split("/").pop() ?? "image";
              const ext = name.split(".").pop()?.toLowerCase() ?? "";
              const mimeMap: Record<string, string> = {
                jpg: "image/jpeg",
                jpeg: "image/jpeg",
                png: "image/png",
                gif: "image/gif",
                webp: "image/webp",
                bmp: "image/bmp",
                svg: "image/svg+xml",
              };
              const blob = new Blob([new Uint8Array(bytes)], {
                type: mimeMap[ext] ?? "image/png",
              });
              const attachment = await compressImage(blob, { name });
              onAddAttachment(attachment);
            } catch (err) {
              toast.error(`Failed to attach dropped file: ${err}`);
            }
          }
        }}
      >
        <button
          type="button"
          onClick={onPickImage}
          aria-label="Attach image"
          title="Attach image"
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            "transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          )}
        >
          <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        {/* #133 — dictation toggle. Mirrors the legacy ChatInput's mic
           *  button: red + animate-pulse while dictating, idle muted
           *  otherwise. The interim text is shown as the input
           *  placeholder (below) so the user can see what the engine
           *  thinks they said before the final chunk lands. */}
        <button
          type="button"
          onClick={onMicToggle}
          aria-label={isDictating ? "Stop dictation" : "Start dictation"}
          title={isDictating ? "Stop dictation" : "Start dictation"}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
            "transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            isDictating
              ? "text-destructive animate-pulse"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          {isDictating ? (
            <MicOff className="h-3.5 w-3.5" strokeWidth={1.5} />
          ) : (
            <Mic className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </button>
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
          placeholder={
            isDictating && interimText
              ? interimText
              : "Ask, search, or type / for skills…"
          }
          className={cn(
            "flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground",
            "outline-none",
          )}
        />
        {/* #126 parity — Stop (while streaming) / Send affordance. The
           *  legacy ChatInput uses the same icon-flip pattern. Keyboard
           *  Enter still sends via the input's onKeyDown handler; this
           *  button is for mouse users + accessibility parity. */}
        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generation"
            title="Stop generation"
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
              "bg-destructive/10 text-destructive hover:bg-destructive/20",
              "transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40",
            )}
          >
            <Square className="h-3 w-3 fill-current" strokeWidth={1.5} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            aria-label="Send message"
            title="Send"
            disabled={
              inputValue.trim().length === 0 &&
              chips.length === 0 &&
              pendingAttachments.length === 0
            }
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
              "bg-[var(--color-accent-primary)] text-white hover:opacity-90",
              "transition-opacity",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            )}
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        )}
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
