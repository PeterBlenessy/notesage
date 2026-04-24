import { useChatStore, selectProjectPaths } from "@/stores/chat-store";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import type { ChatMessage as ChatMessageType } from "@/lib/ai/types";

/**
 * CommandBarStream — thin wrapper around `<ChatMessageList />` for the
 * FloatingCommandBar's expanded scroll region (PRD `2026-04-21-ui-refresh`,
 * Phase 1, task #12 — re-consolidated 2026-04-24).
 *
 * Consolidation note (2026-04-24 / supersedes #127 + #130 + #116 stream gap):
 * this component used to roll its own message loop + render a subset of
 * per-message affordances + switch cards. The #113 functional-parity audit
 * catalogued ten features missing relative to the legacy `ChatMessageList`:
 * QuickReplies, ContextDivider, BranchSwitcher, empty-state onboarding,
 * LocalAISetupCard, per-message Edit / Resend / Retry / Branch, edit-mode
 * banner, Permission / Domain / ToolCall / AgentStatus cards, streaming
 * indicator.
 *
 * Rather than re-implement each in the Quiet Composer surface, the command
 * bar now renders the same `<ChatMessageList />` the legacy ChatPanel uses —
 * identical pattern to AgentOrb wrapping `<AgentPanel />`. Single source of
 * truth for chat rendering across both shells; every future chat feature
 * lands in one place.
 *
 * Height: the wrapper uses `flex flex-1 min-h-0` and inherits its cap
 * from the enclosing FloatingCommandBar — floating mode sets the bar to
 * `h-[480px]`, pinned mode to `h-screen`. A hard `max-h-[50vh]` cap was
 * briefly tried but broke pinned mode (the input floated mid-screen);
 * removed 2026-04-24. The list itself owns its own scroll container +
 * autoscroll so internal overflow is handled.
 *
 * Adds ARIA log role for AT and passes through the prop surface
 * FloatingCommandBar provides.
 */

interface CommandBarStreamProps {
  /** Called when a QuickReply or onboarding prompt fires a send. */
  onSend: (content: string) => void;
  /** Called when the user clicks Resend on a user message. Optional — */
  /** cmd-bar-origin resend UX is pending follow-up work. */
  onResend?: (message: ChatMessageType) => void;
  /** Called when the user clicks Edit on a user message. Optional. */
  onEdit?: (message: ChatMessageType) => void;
  /** Called when the empty-state onboarding prompts are clicked. */
  onPrefill?: (text: string) => void;
}

function CommandBarStream({ onSend, onResend, onEdit, onPrefill }: CommandBarStreamProps) {
  // Scope the list to the active conversation's selected projects — same
  // read the classic ChatPanel uses to drive sandbox-scope / domain
  // auto-approval decisions inside the list.
  const selectedProjectPaths = useChatStore(selectProjectPaths);

  return (
    <div
      data-cmd-stream
      role="log"
      aria-live="polite"
      aria-label="Chat stream"
      className="flex flex-1 flex-col min-h-0"
    >
      <ChatMessageList
        onSend={onSend}
        selectedProjectPaths={selectedProjectPaths}
        onResend={onResend}
        onEdit={onEdit}
        onPrefill={onPrefill}
      />
    </div>
  );
}

export default CommandBarStream;
