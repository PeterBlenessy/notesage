import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChatSwitchPrompts } from "@/hooks/useChatSwitchPrompts";
import { useSettingsStore } from "@/stores/settings-store";
import {
  useChatStore,
  selectMessages,
  selectProjectPaths,
  selectPendingProjectSwitch,
  selectPendingAgentSwitch,
} from "@/stores/chat-store";
import { useChatContext } from "@/hooks/useChatContext";
import { useAIOperations } from "@/hooks/useAIOperations";
import { useForegroundLoading } from "@/hooks/useSessionManager";
import { useRoutingStore } from "@/stores/routing-store";
import { ResendProviderDialog } from "@/components/chat/ResendProviderDialog";
import {
  expandSkillPrefix,
  interpretAgentPrefix,
} from "@/lib/ai/chat-expansion";
import { type AttachmentChip } from "@/components/cmd/AttachmentChips";
import { computeTabCompletion } from "@/components/cmd/verb-modes";
import CompactContent from "@/components/cmd/CompactContent";
import ExpandedContent from "@/components/cmd/ExpandedContent";
import PinnedResizeHandle from "@/components/cmd/resize/PinnedResizeHandle";
import ExpandedResizeHandle from "@/components/cmd/resize/ExpandedResizeHandle";
import TopResizeHandle from "@/components/cmd/resize/TopResizeHandle";
import { useCommandBarGeometry } from "@/components/cmd/useCommandBarGeometry";
import { useCommandBarPrefixState } from "@/components/cmd/useCommandBarPrefixState";
import { useCommandBarBusWiring } from "@/components/cmd/useCommandBarBusWiring";
import { usePendingImageAttachments } from "@/components/cmd/usePendingImageAttachments";
import { useResendEditDialog } from "@/components/cmd/useResendEditDialog";
import {
  handlePickPalette,
  handlePickReference,
  handlePickReferenceOccurrence,
  handlePickResearch,
  handlePickTag,
  handlePickTask,
} from "@/components/cmd/picker-actions";

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
 *
 * Extracted collaborators (deep-review refactor #9 — behaviour-preserving):
 *   - `useCommandBarGeometry`      → position/width/height/lift/background
 *   - `useCommandBarPrefixState`   → prefix/verb detection state machine
 *   - `useCommandBarBusWiring`     → summon-store + cmd-bar-events bus
 *   - `usePendingImageAttachments` → image attachment strip state (#126)
 *   - `useResendEditDialog`        → edit mode + cross-provider dialog (#127)
 *   - `resize/*`                   → the three drag-resize handles
 *   - `CompactContent` / `ExpandedContent` → the two content bodies
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

function FloatingCommandBar({ isPinned: isPinnedProp }: FloatingCommandBarProps) {
  // Read the persisted pinned flag. The prop overrides it (for tests / for
  // call sites that need to force a mode); when the prop is undefined, the
  // store wins so the pin-icon toggle in `CommandBarContext` works.
  const cmdBarPinnedSetting = useSettingsStore((s) => s.cmdBarPinned);
  const isPinned = isPinnedProp ?? cmdBarPinnedSetting;

  const [expanded, setExpanded] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Prefix/verb detection state machine (`/ @ # ! ? >` + `:verbs`) — active
  // prefix + verb, Esc-dismissal suppression, `aria-activedescendant`
  // mirror, sidebar drilldown seeds, and the pick handlers that rewrite
  // the input token.
  const prefixState = useCommandBarPrefixState({
    inputValue,
    setInputValue,
    inputRef,
  });
  const {
    activePrefix,
    setActivePrefix,
    activeVerb,
    activeOption,
    setActiveOption,
    pendingTagDrilldown,
    pendingMentionDrilldown,
    recomputePrefix,
    handlePickSkill,
    handlePickVerb,
  } = prefixState;

  // Send wiring (#23). Uses `sendChatMessage` from `useAIOperations` so
  // all routing (direct API / ACP / Copilot LSP / local), provider lock
  // checks, segment isolation, and downstream streaming come "for free".
  const messagesForSend = useChatStore(selectMessages);
  const { sendChatMessage, cancelChat } = useAIOperations();
  // Per-conversation loading: the bar reflects the WATCHED conversation's run
  // state, not the global flag — so switching to an idle chat while another
  // streams in the background shows the right send/stop affordance (task #4).
  const isLoading = useForegroundLoading();

  // Live-test 2026-04-26 audit gap #10 — input + send must be disabled
  // while either an AgentSwitchCard or a pending-project-switch prompt
  // is awaiting the user's choice. Without this, users can keep
  // typing/sending mid-prompt, which races the resolver and may cause
  // messages to land on the wrong segment.
  const pendingProjectSwitch = useChatStore(selectPendingProjectSwitch);
  const pendingAgentSwitch = useChatStore(selectPendingAgentSwitch);
  const switchPending =
    Boolean(pendingProjectSwitch) || Boolean(pendingAgentSwitch);

  // Live-test 2026-04-26 audit gap #1 — mount the shared switch-prompt
  // hook so changing provider or project selection mid-conversation
  // raises the AgentSwitchCard / pending-project-switch prompt.
  // Without this, the bar would silently send messages to the new
  // provider with full prior history.
  useChatSwitchPrompts();

  // #118 — chatView toggles the expanded bar between its usual chat
  // stream and a past-conversation list. The clock icon in
  // `CommandBarContext` fires `toggle-history` on the bus; the
  // subscription below flips this state. Selecting a conversation from
  // the list returns to chat mode.
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

  // #134 — context chips + explicit-attach offer. Auto-attached files
  // appear as ContextPill rows above the input; when the active tab
  // sits outside the selected project scope, an "Add this file to
  // chat" affordance lets the user opt in.
  const {
    contextItems,
    dismissItem,
    explicitAttachOffer,
    attachExplicit,
  } = useChatContext();

  // Voice input was removed from the command bar with the voice-subsystem
  // rewrite (PRD 2026-05-30-meeting-recording). The composer has no
  // microphone affordance — meeting recording lives on the StatusTray mic.

  // #127 parity — connection + routing state for the cross-provider
  // resend/edit dialog (minus the per-project `ai.provider` override
  // layer; a follow-up can extract that into a shared hook if needed).
  const interactiveConnection = useRoutingStore((s) =>
    s.getConnectionForUseCase("interactive"),
  );

  // Attachment chips above the input (#11). Populated by the reference / task /
  // research mode pickers (#15 / #17 / #18) via the dispatchers below.
  const [chips, setChips] = useState<AttachmentChip[]>([]);
  const removeChip = useCallback((id: string) => {
    setChips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // #127 parity — edit-mode + cross-provider resend/edit dialog cluster.
  const {
    editContext,
    editContextRef,
    clearEditContext,
    resendDialog,
    openResendDialog,
    handleStreamResend,
    handleStreamEdit,
    handleResendDialogConfirm,
    handleResendDialogCancel,
    resendDialogOptions,
  } = useResendEditDialog({
    inputRef,
    setInputValue,
    setChips,
    setActivePrefix,
    setExpanded,
    interactiveConnection,
    sendChatMessage,
    messagesForSend,
  });

  // #126 parity — image attachments. Paste, drag-drop, and the file
  // picker all dump ImageAttachments into this state; `handleSend` then
  // hands them to `sendChatMessage` where the Rust backend serializes
  // them per-provider. Cleared on successful send.
  const {
    pendingAttachments,
    addImageAttachment,
    removeImageAttachment,
    clearPendingAttachments,
    handleImagePick,
  } = usePendingImageAttachments({ inputRef, setExpanded });

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

  const expand = useCallback(() => {
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    // Pinned mode has no "collapsed" state — the panel always stays docked.
    // Esc still falls through to clear the prefix (handled in `handleKeyDown`)
    // but we never tear down the bar itself.
    if (isPinned) return;
    setExpanded(false);
    // Preserve the typed draft across collapse (Esc, blur, opening Settings, and
    // the X close button) so reopening restores what the user was writing — only
    // an actual send clears it. The prefix MODE is still reset; if the draft
    // begins with a prefix char it re-engages on the next keystroke.
    setActivePrefix(null);
    // Reset the typed-prefix dismissal suppression so the next time the
    // bar expands, the picker is willing to open again on the next `/`.
    prefixState.dismissedPrefixRef.current = null;
    // Blur is a courtesy — the input itself unmounts when expanded === false,
    // but if we ever animate the input out we still want the focus released.
    inputRef.current?.blur();
  }, [isPinned, setActivePrefix, prefixState.dismissedPrefixRef]);

  // #114 — durable summon-store translation + `cmd-bar-events` bus
  // subscription (focus / dismiss / toggle-history / close). Owns the
  // three-stage Esc chain: typed prefix → edit mode → collapse.
  useCommandBarBusWiring({
    prefix: prefixState,
    inputRef,
    setInputValue,
    setChips,
    setExpanded,
    setChatView,
    editContextRef,
    clearEditContext,
    collapse,
  });

  // Live-test 2026-04-25 #151 — auto-resize the cmd-bar textarea so it
  // grows with multi-line content.
  // Caps at 160 px (~6 lines) so the bar can't push past the doc area;
  // beyond that the textarea scrolls internally. Called from
  // `handleInputChange` AND from a `useEffect` on `inputValue` so
  // programmatic value changes (e.g. prefix replacement) resize the
  // textarea too.
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [inputValue, autoResize]);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      const cursor = event.target.selectionStart ?? value.length;
      setInputValue(value);
      recomputePrefix(value, cursor);
      autoResize();
    },
    [recomputePrefix, autoResize],
  );

  const handleSelectionChange = useCallback(
    (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
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
  // streaming behaviour.
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

    // #126 parity — `@agent-name` / `/skill-name` expansion at send time
    // via the shared helpers in `src/lib/ai/chat-expansion.ts`. Skipping
    // these would send the literal prefix as model input, losing the
    // agent swap + skill-body injection the user expects.
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
      openResendDialog({
        mode: "edit",
        content,
        originalConnectionId: editContext.originalConnectionId,
        currentConnectionId: interactiveConnection?.id ?? null,
      });
      // Leave editContext in place — the dialog's confirm path clears
      // it via `doSend`.
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
    // #126 parity — image attachments reach the provider via the
    // `attachments` opt. Cleared optimistically alongside the input /
    // chips.
    if (pendingAttachments.length > 0) {
      sendOpts.attachments = pendingAttachments;
      clearPendingAttachments();
    }
    if (editContext) clearEditContext();

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
    setActivePrefix,
    openResendDialog,
    clearPendingAttachments,
    clearEditContext,
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

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      if (event.key === "Tab") {
        // Verb-name autocomplete (PRD `2026-04-28-cmd-bar-verb-prefixes`).
        // Only fires when a verb prefix is active AND the cursor is
        // in the verb-name region (not the filter slot — filter Tab
        // is the verb picker's to handle in #8). `computeTabCompletion`
        // returns null when there's nothing to do, in which case we
        // fall through and let the verb picker (or browser focus
        // traversal) take Tab.
        const el = event.currentTarget;
        const cursor = el.selectionStart ?? inputValue.length;
        const completion = computeTabCompletion(inputValue, cursor);
        if (completion) {
          event.preventDefault();
          setInputValue(completion.newInput);
          requestAnimationFrame(() => {
            const node = inputRef.current;
            if (!node) return;
            node.focus();
            node.setSelectionRange(completion.newCursor, completion.newCursor);
            // Force re-detect against the new value/cursor so the
            // verb picker (or discovery menu) updates without waiting
            // for the next input event.
            recomputePrefix(completion.newInput, completion.newCursor);
          });
          return;
        }
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
    [activePrefix, editContext, collapse, handleSend, inputValue, recomputePrefix],
  );

  // Visual chrome — position, width, height, radius, lift, transition, and
  // background are computed by the geometry hook (CSS-variable driven so the
  // resize handles can mutate size without React re-renders).
  const { barClassName, inlineStyle } = useCommandBarGeometry({
    isPinned,
    expanded,
    effectiveExpanded,
  });

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
      className={barClassName}
    >
      {/*
        Pinned-mode resize handle. A thin (6px) draggable strip on the LEFT
        edge of the panel. Floating expanded mode gets its own pair of
        edge handles (`ExpandedResizeHandle`) since the bar is centred and
        the user expects whichever edge they grab to follow the cursor.
       */}
      {isPinned ? <PinnedResizeHandle /> : null}
      {!isPinned && effectiveExpanded ? (
        <>
          <ExpandedResizeHandle side="right" />
          <ExpandedResizeHandle side="left" />
          <TopResizeHandle />
        </>
      ) : null}

      {effectiveExpanded ? (
        <ExpandedContent
          inputRef={inputRef}
          inputValue={inputValue}
          activePrefix={activePrefix}
          activeVerb={activeVerb}
          onPickVerb={handlePickVerb}
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
          onPickReferenceOccurrence={handlePickReferenceOccurrence}
          onPickTag={handlePickTag}
          initialTagDrilldown={pendingTagDrilldown}
          initialPersonDrilldown={pendingMentionDrilldown}
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
          switchPending={switchPending}
          pendingProjectSwitch={Boolean(pendingProjectSwitch)}
          pendingAgentSwitch={Boolean(pendingAgentSwitch)}
          onStop={cancelChat}
          onSend={handleSend}
          chatView={chatView}
          onSelectConversation={handleSelectConversation}
          selectedProjectPaths={selectedProjectPaths}
          contextItems={contextItems}
          onDismissContext={dismissItem}
          explicitAttachOffer={explicitAttachOffer}
          onAttachExplicit={attachExplicit}
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

export default FloatingCommandBar;
