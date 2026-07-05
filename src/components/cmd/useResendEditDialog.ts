import { useCallback, useMemo, useRef, useState } from "react";
import { useChatStore } from "@/stores/chat-store";
import { useConnectionsStore } from "@/stores/connections-store";
import { useRoutingStore } from "@/stores/routing-store";
import type { Connection } from "@/lib/ai/connections";
import type { ChatMessage as ChatMessageType } from "@/lib/ai/types";
import type { useAIOperations } from "@/hooks/useAIOperations";
import {
  type ResendProviderChoice,
  type ResendProviderOption,
} from "@/components/chat/ResendProviderDialog";
import { type ActivePrefix } from "@/components/cmd/prefix-modes";
import { type AttachmentChip } from "@/components/cmd/AttachmentChips";

type SendChatMessage = ReturnType<typeof useAIOperations>["sendChatMessage"];

/**
 * #127 parity — edit-mode state. When the user clicks Edit on a user
 * message, we capture the original parentId + connectionId so the
 * follow-up send can (a) branch from the edited message's parent
 * instead of appending to the leaf, and (b) surface a cross-provider
 * dialog if the active connection now differs.
 */
export interface EditContext {
  parentId: string | null;
  originalContent: string;
  originalConnectionId?: string;
}

/**
 * #127 parity — cross-provider resend/edit dialog state. Opens when
 * the message's recorded connectionId differs from the active
 * `interactiveConnection`.
 */
export interface ResendDialogState {
  mode: "resend" | "edit";
  content: string;
  messageIdToDelete?: string;
  originalConnectionId: string;
  currentConnectionId: string | null;
}

export interface UseResendEditDialogArgs {
  /** Composer textarea ref — refocused after edit-mode prefills. */
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
  setChips: React.Dispatch<React.SetStateAction<AttachmentChip[]>>;
  setActivePrefix: React.Dispatch<React.SetStateAction<ActivePrefix | null>>;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  interactiveConnection: Connection | null;
  sendChatMessage: SendChatMessage;
  messagesForSend: ChatMessageType[];
}

export interface ResendEditDialog {
  editContext: EditContext | null;
  /** Render-phase mirror of `editContext` for once-mounted subscribers. */
  editContextRef: React.RefObject<EditContext | null>;
  clearEditContext: () => void;
  resendDialog: ResendDialogState | null;
  /** Open the dialog directly (handleSend's edit-mismatch path). */
  openResendDialog: (state: ResendDialogState) => void;
  handleStreamResend: (message: ChatMessageType) => void;
  handleStreamEdit: (message: ChatMessageType) => void;
  handleResendDialogConfirm: (choice: ResendProviderChoice) => void;
  handleResendDialogCancel: () => void;
  resendDialogOptions: {
    original: ResendProviderOption;
    current: ResendProviderOption;
    isEdit: boolean;
  } | null;
}

/**
 * useResendEditDialog — the FloatingCommandBar's message edit-mode +
 * cross-provider resend/edit dialog cluster (#127 parity, minus the
 * per-project `ai.provider` override layer; a follow-up can extract that
 * into a shared hook if needed).
 */
export function useResendEditDialog({
  inputRef,
  setInputValue,
  setChips,
  setActivePrefix,
  setExpanded,
  interactiveConnection,
  sendChatMessage,
  messagesForSend,
}: UseResendEditDialogArgs): ResendEditDialog {
  const allConnections = useConnectionsStore((s) => s.connections);
  const setRouting = useRoutingStore((s) => s.setRouting);

  const [editContext, setEditContext] = useState<EditContext | null>(null);
  // Mirror on a ref so the bus-subscription effect can read the latest
  // edit-mode state without being in its deps. Drives the Esc stage
  // chain: typed-prefix → clear prefix; edit mode → cancel edit; neither
  // → collapse. Same render-phase write as `activePrefixRef` —
  // post-commit useEffect mirroring left an open window where a fast
  // Esc keydown could fire with a stale ref and fall through to
  // collapse() instead of cancelling the edit (#149).
  const editContextRef = useRef<EditContext | null>(null);
  editContextRef.current = editContext;

  const [resendDialog, setResendDialog] = useState<ResendDialogState | null>(
    null,
  );

  // Resend a user message — same-provider path deletes + re-sends. On
  // cross-provider mismatch we open `ResendProviderDialog` so the user
  // can pick which connection receives the resend (#127 parity).
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
    [setInputValue, setExpanded, inputRef],
  );

  const clearEditContext = useCallback(() => setEditContext(null), []);

  // #127 parity — dialog confirm/cancel + memoized options for the
  // `ResendProviderDialog` render.
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
      setInputValue,
      setChips,
      setActivePrefix,
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

  return {
    editContext,
    editContextRef,
    clearEditContext,
    resendDialog,
    openResendDialog: setResendDialog,
    handleStreamResend,
    handleStreamEdit,
    handleResendDialogConfirm,
    handleResendDialogCancel,
    resendDialogOptions,
  };
}
