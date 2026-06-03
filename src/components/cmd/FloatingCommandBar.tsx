import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";
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
import { useRoutingStore } from "@/stores/routing-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { toast } from "sonner";
import type { ChatMessage as ChatMessageType, ImageAttachment } from "@/lib/ai/types";
import { compressImage } from "@/lib/image-compress";
import {
  registerSendImageHandler,
  unregisterSendImageHandler,
} from "@/lib/ai/vision";
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
import { type AttachmentChip } from "@/components/cmd/AttachmentChips";
import {
  detectActivePrefix,
  type ActivePrefix,
} from "@/components/cmd/prefix-modes";
import {
  detectActiveVerb,
  computeTabCompletion,
  VERBS,
  type ActiveVerb,
} from "@/components/cmd/verb-modes";
import { log } from "@/lib/logger";
import { useCommandBarGeometry } from "@/hooks/useCommandBarGeometry";
import { PinnedResizeHandle } from "@/components/cmd/resize/PinnedResizeHandle";
import { ExpandedResizeHandle } from "@/components/cmd/resize/ExpandedResizeHandle";
import { TopResizeHandle } from "@/components/cmd/resize/TopResizeHandle";
import { CompactContent } from "@/components/cmd/CompactContent";
import { ExpandedContent } from "@/components/cmd/ExpandedContent";
import type { TagPickAction } from "@/components/cmd/modes/TagMode";
import type { TaskAction } from "@/components/cmd/modes/TaskMode";

/**
 * FloatingCommandBar — the unified composer shell for the Quiet Composer
 * UI refresh (PRD `2026-04-21-ui-refresh`, Phase 1, task #9).
 *
 * This file is the outer chrome orchestrator. Sub-components live in their
 * own files under `src/components/cmd/` (#412 extraction).
 */

export interface FloatingCommandBarProps {
  /**
   * When provided, overrides the persisted `cmdBarPinned` setting from
   * settings-store. Tests pass this explicitly; production call sites should
   * leave it undefined and let the store drive the mode.
   */
  isPinned?: boolean;
}

function FloatingCommandBar({ isPinned: isPinnedProp }: FloatingCommandBarProps) {
  // Read the persisted pinned flag. The prop overrides it (for tests / for
  // call sites that need to force a mode); when the prop is undefined, the
  // store wins so the pin-icon toggle in `CommandBarContext` works.
  const cmdBarPinnedSetting = useSettingsStore((s) => s.cmdBarPinned);
  const isPinned = isPinnedProp ?? cmdBarPinnedSetting;

  // Live-test 2026-04-26 — when transparent chrome is on, the collapsed
  // pill matches the title bar / status bar by going translucent over
  // the doc area. The bar portals to `document.body` and is NOT a
  // descendant of the QuietLayout root that carries the
  // `data-quiet-chrome-transparent` attribute, so we read the setting
  // directly here instead of relying on a descendant CSS selector.
  const quietChromeTransparent = useSettingsStore(
    (s) => s.quietChromeTransparent,
  );

  const [expanded, setExpanded] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [activePrefix, setActivePrefix] = useState<ActivePrefix | null>(null);
  // Mirror `activePrefix` onto a ref so the bus-subscription effect (which
  // mounts once) can read the latest value without being in its deps.
  const activePrefixRef = useRef<ActivePrefix | null>(null);
  activePrefixRef.current = activePrefix;
  // Verb-prefix mirror — same shape as `activePrefix`, separate namespace.
  const [activeVerb, setActiveVerb] = useState<ActiveVerb | null>(null);
  const activeVerbRef = useRef<ActiveVerb | null>(null);
  activeVerbRef.current = activeVerb;
  // Esc-suppression for dismissed verbs.
  const dismissedVerbRef = useRef<{ index: number } | null>(null);
  // #126 fix — suppress re-detection of the SAME prefix after Esc.
  const dismissedPrefixRef = useRef<{ index: number; char: string } | null>(
    null,
  );
  // Tracks the currently-highlighted option in the active mode picker.
  const [activeOption, setActiveOption] = useState<{
    listboxId: string;
    activeOptionId: string | null;
    count: number;
  } | null>(null);

  // Drilldown seed forwarded from the bus `focus` event.
  const [pendingTagDrilldown, setPendingTagDrilldown] = useState<string | null>(
    null,
  );
  const [pendingMentionDrilldown, setPendingMentionDrilldown] = useState<
    string | null
  >(null);
  // Scroll the highlighted picker row into view on arrow navigation.
  useEffect(() => {
    const id = activeOption?.activeOptionId;
    if (!id) return;
    const el = document.getElementById(id);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeOption?.activeOptionId]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const reducedMotion = useReducedMotion();

  // Send wiring (#23).
  const messagesForSend = useChatStore(selectMessages);
  const { sendChatMessage, cancelChat } = useAIOperations();
  const isLoading = useChatStore((s) => s.isLoading);

  // Live-test 2026-04-26 audit gap #10 — input + send must be disabled
  // while either an AgentSwitchCard or a pending-project-switch prompt
  // is awaiting the user's choice.
  const pendingProjectSwitch = useChatStore(selectPendingProjectSwitch);
  const pendingAgentSwitch = useChatStore(selectPendingAgentSwitch);
  const switchPending =
    Boolean(pendingProjectSwitch) || Boolean(pendingAgentSwitch);

  // Mount the shared switch-prompt hook so changing provider or project
  // selection mid-conversation raises the AgentSwitchCard.
  useChatSwitchPrompts();

  // #118 — chatView toggles the expanded bar between chat and history list.
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

  // #134 — context chips + explicit-attach offer.
  const {
    contextItems,
    dismissItem,
    explicitAttachOffer,
    attachExplicit,
  } = useChatContext();

  // #127 parity — connection + routing state for the cross-provider
  // resend/edit dialog.
  const interactiveConnection = useRoutingStore((s) =>
    s.getConnectionForUseCase("interactive"),
  );
  const allConnections = useConnectionsStore((s) => s.connections);
  const setRouting = useRoutingStore((s) => s.setRouting);

  // #127 parity — edit-mode state.
  const [editContext, setEditContext] = useState<{
    parentId: string | null;
    originalContent: string;
    originalConnectionId?: string;
  } | null>(null);
  const editContextRef = useRef<typeof editContext>(null);
  editContextRef.current = editContext;

  // #126 parity — image attachments.
  const [pendingAttachments, setPendingAttachments] = useState<
    ImageAttachment[]
  >([]);
  const addImageAttachment = useCallback((att: ImageAttachment) => {
    setPendingAttachments((prev) => {
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

  // Subscribe to the vision event bus so editor "Add to chat" actions
  // and sidebar drops route their images into the composer.
  useEffect(() => {
    registerSendImageHandler((attachment) => {
      addImageAttachment(attachment);
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => unregisterSendImageHandler();
  }, [addImageAttachment]);

  // #126 parity — pick images via the native dialog.
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

  // #127 parity — cross-provider resend/edit dialog state.
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

  // Attachment chips above the input (#11).
  const [chips, setChips] = useState<AttachmentChip[]>([]);
  const removeChip = useCallback((id: string) => {
    setChips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Whether the user is "composing".
  const isComposing = inputValue.trim().length > 0 || chips.length > 0;

  // Pinned mode is "always expanded".
  const effectiveExpanded = isPinned || expanded;

  // Autofocus the input whenever we transition into the expanded state.
  useEffect(() => {
    if (effectiveExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [effectiveExpanded]);

  // Drop the cached active-option info whenever the picker closes.
  useEffect(() => {
    if (!activePrefix) {
      setActiveOption(null);
      setPendingTagDrilldown(null);
      setPendingMentionDrilldown(null);
    }
  }, [activePrefix]);

  const expand = useCallback(() => {
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    // Pinned mode has no "collapsed" state.
    if (isPinned) return;
    setExpanded(false);
    setInputValue("");
    setActivePrefix(null);
    dismissedPrefixRef.current = null;
    inputRef.current?.blur();
  }, [isPinned]);

  // #114 — Subscribe to the `cmd-bar-events` bus.
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
          if (event.prefix.startsWith(':')) {
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
                source: 'chord',
              });
              setActivePrefix(null);
            }
          } else {
            const mode = Object.values(MODES).find(
              (m) => m.prefix === event.prefix,
            );
            if (mode) {
              setInputValue(event.prefix);
              setActivePrefix({
                mode,
                prefixIndex: 0,
                tokenStart: 0,
                tokenEnd: 1,
                filter: '',
                source: 'chord',
              });
            }
          }
        }
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
        // Three-stage Esc: typed prefix → edit mode → collapse.
        const currentPrefix = activePrefixRef.current;
        if (currentPrefix?.source === 'typed') {
          dismissedPrefixRef.current = {
            index: currentPrefix.prefixIndex,
            char: currentPrefix.mode.prefix,
          };
          setActivePrefix(null);
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }

        const currentVerb = activeVerbRef.current;
        if (currentVerb?.source === 'typed') {
          dismissedVerbRef.current = { index: currentVerb.verbStart };
          setActiveVerb(null);
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }

        if (editContextRef.current) {
          setEditContext(null);
          setInputValue('');
          setChips([]);
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }

        collapse();
      }

      if (event.type === 'toggle-pin') {
        useSettingsStore.getState().setCmdBarPinned(false);
      }

      if (event.type === 'toggle-history') {
        setExpanded(true);
        setChatView((prev) => (prev === 'history' ? 'chat' : 'history'));
      }

      if (event.type === 'close') {
        setExpanded(false);
        setInputValue("");
        setActivePrefix(null);
        setActiveVerb(null);
        dismissedPrefixRef.current = null;
        dismissedVerbRef.current = null;
        inputRef.current?.blur();
      }
    });
  }, [collapse]);

  // Prefix detection — runs on every input change AND on selection moves.
  const recomputePrefix = useCallback(
    (value: string, cursor: number) => {
      const next = detectActivePrefix(value, cursor);

      // Suppress re-detection of an Esc-dismissed prefix.
      const dismissed = dismissedPrefixRef.current;
      if (dismissed) {
        if (next && next.prefixIndex === dismissed.index && value[dismissed.index] === dismissed.char) {
          setActivePrefix(null);
          setActiveVerb(null);
          return;
        }
        dismissedPrefixRef.current = null;
      }

      setActivePrefix(next);

      // Verb-prefix detection runs ONLY when no single-char prefix is active.
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

  // Auto-resize the cmd-bar textarea.
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
      // Ignore Escape's keyUp — its keyDown handler already cleared the prefix.
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

  // Send (#23) — Enter (no active prefix) sends via useAIOperations.
  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (trimmed.length === 0 && chips.length === 0 && pendingAttachments.length === 0) {
      return;
    }

    const refsBlock =
      chips.length > 0
        ? `[refs: ${chips.map((c) => `${c.kind}:${c.name}`).join(", ")}] `
        : "";
    const rawContent = `${refsBlock}${trimmed}`;

    const agentResult = interpretAgentPrefix(rawContent, interactiveConnection);
    if (agentResult.skipSend) {
      setInputValue("");
      setChips([]);
      setActivePrefix(null);
      return;
    }
    const skillResult = await expandSkillPrefix(agentResult.content);
    if (skillResult.abortSend) return;
    const content = skillResult.content;

    // #127 parity — cross-provider edit dialog.
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
      return;
    }

    setInputValue("");
    setChips([]);
    setActivePrefix(null);

    const sendOpts: Record<string, unknown> = {};
    if (editContext) sendOpts.parentId = editContext.parentId;
    if (skillResult.skillName) {
      sendOpts.displayContent = rawContent;
      sendOpts.skillName = skillResult.skillName;
    }
    if (pendingAttachments.length > 0) {
      sendOpts.attachments = pendingAttachments;
      setPendingAttachments([]);
    }
    if (editContext) setEditContext(null);

    void sendChatMessage(
      content,
      messagesForSend,
      Object.keys(sendOpts).length > 0 ? sendOpts : undefined,
    );

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

  // Stream → send bridge for QuickReplies and onboarding prompts.
  const handleStreamSend = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (trimmed.length === 0) return;

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

  const handleStreamPrefill = useCallback(
    (text: string) => {
      setInputValue(text);
      setExpanded(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [],
  );

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

  // #127 parity — dialog confirm/cancel.
  const handleResendDialogConfirm = useCallback(
    (choice: ResendProviderChoice) => {
      const dialog = resendDialog;
      if (!dialog) return;
      setResendDialog(null);

      const targetId =
        choice === "original"
          ? dialog.originalConnectionId
          : dialog.currentConnectionId;

      if (dialog.mode === "resend" && dialog.messageIdToDelete) {
        useChatStore
          .getState()
          .deleteMessageAndDescendants(dialog.messageIdToDelete);
      }

      const parentId =
        dialog.mode === "edit" ? editContext?.parentId ?? null : undefined;

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
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        // Do NOT handle Esc locally — the bus subscriber is the single
        // source of truth for the three-stage chain.
        return;
      }
      if (event.key === "Tab") {
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
            recomputePrefix(completion.newInput, completion.newCursor);
          });
          return;
        }
      }
      if (event.key === "Enter") {
        if (activePrefix) {
          return;
        }
        if (event.shiftKey) return;
        event.preventDefault();
        void handleSend();
        return;
      }
    },
    [activePrefix, editContext, collapse, handleSend, inputValue, recomputePrefix],
  );

  // Mode picker dispatchers (#14–#19)
  const replaceActiveToken = useCallback(
    (replacement: string) => {
      if (!activePrefix) return;
      const before = inputValue.slice(0, activePrefix.tokenStart);
      const after = inputValue.slice(activePrefix.tokenEnd);
      const next = before + replacement + after;
      const cursor = (before + replacement).length;
      setInputValue(next);
      setActivePrefix(null);
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
    (action: TagPickAction) => {
      window.dispatchEvent(
        new CustomEvent("notesage:open-file-at-tag", {
          detail: {
            filePath: action.filePath,
            fileName: action.fileName,
            symbol: action.symbol,
            occurrenceInFile: action.occurrenceInFile,
          },
        }),
      );
    },
    [],
  );

  const handlePickReference = useCallback(
    (chip: AttachmentChip) => {
      if (chip.kind === "file") {
        const filePath = chip.id.startsWith("file:")
          ? chip.id.slice("file:".length)
          : chip.id;
        const fileName = filePath.split("/").pop() || filePath;
        window.dispatchEvent(
          new CustomEvent("notesage:open-file", {
            detail: { filePath, fileName },
          }),
        );
        return;
      }
    },
    [],
  );

  const handlePickReferenceOccurrence = useCallback(
    (action: {
      filePath: string;
      fileName: string;
      symbol: string;
      occurrenceInFile: number;
    }) => {
      window.dispatchEvent(
        new CustomEvent("notesage:open-file-at-tag", {
          detail: {
            filePath: action.filePath,
            fileName: action.fileName,
            symbol: action.symbol,
            occurrenceInFile: action.occurrenceInFile,
          },
        }),
      );
    },
    [],
  );

  const handlePickResearch = useCallback(
    (chip: AttachmentChip) => {
      const filePath = chip.id;
      const fileName = filePath.split("/").pop() || filePath;
      window.dispatchEvent(
        new CustomEvent("notesage:open-file", {
          detail: { filePath, fileName },
        }),
      );
    },
    [],
  );

  const handlePickTask = useCallback(
    (action: TaskAction) => {
      if (action.kind === "navigate") {
        const fileName =
          action.filePath.split("/").pop() || action.filePath;
        window.dispatchEvent(
          new CustomEvent("notesage:open-file", {
            detail: {
              filePath: action.filePath,
              fileName,
              scrollToText: action.text,
            },
          }),
        );
      }
    },
    [],
  );

  const handlePickPalette = useCallback(
    (commandId: string) => {
      window.dispatchEvent(
        new CustomEvent("notesage:palette-command", { detail: { commandId } }),
      );
      log.info("perf:cmdbar", "palette-execute", { commandId });
    },
    [],
  );

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
    [inputValue, recomputePrefix],
  );

  // Visual chrome — computed by the geometry hook.
  const {
    positionClasses,
    widthClasses,
    heightClasses,
    radiusClasses,
    liftClasses,
    transitionClasses,
    backgroundClasses,
    inlineStyle,
  } = useCommandBarGeometry({
    isPinned,
    expanded,
    effectiveExpanded,
    reducedMotion,
    quietChromeTransparent,
  });

  const bar = (
    <div
      data-cmd-bar
      data-cmd-bar-pinned={isPinned ? "true" : "false"}
      data-expanded={effectiveExpanded ? "true" : "false"}
      data-prefix-mode={activePrefix?.mode.id ?? ""}
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
        isPinned ? "z-30" : "z-40",
        "flex flex-col overflow-hidden",
        "border border-border shadow-lg",
        backgroundClasses,
      )}
    >
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
    return bar;
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(bar, document.body);
}

export default FloatingCommandBar;
