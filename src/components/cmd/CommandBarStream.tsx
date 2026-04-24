import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  useChatStore,
  selectMessages,
  selectPendingAgentSwitch,
  selectPendingProjectSwitch,
} from "@/stores/chat-store";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { AgentSwitchCard } from "@/components/chat/AgentSwitchCard";
import { ProjectSwitchCard } from "@/components/chat/ProjectSwitchCard";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { ChatMessage as ChatMessageType } from "@/lib/ai/types";

/**
 * CommandBarStream — chat-stream renderer for the FloatingCommandBar's
 * expanded scroll region (PRD `2026-04-21-ui-refresh`, Phase 1, task #12).
 *
 * This is a pure container. It selects the active conversation's messages
 * from `chat-store` and delegates rendering to the existing `ChatMessage`
 * component — segments, permission cards, quick replies, branching pills,
 * etc. all flow through unchanged.
 *
 * Behaviour:
 *   - Empty state ("No messages yet") when the active conversation has no
 *     messages or there is no active conversation.
 *   - One `<ChatMessage>` per message in the active branch.
 *   - Auto-scrolls the scroll region to the bottom whenever the message
 *     count changes (new chunk, new turn, branch switch).
 *   - Honours `prefers-reduced-motion: reduce` — uses `behavior: 'auto'`
 *     (instant) instead of `'smooth'`.
 *
 * The scroll region is capped at 50 vh so the bar never explodes past
 * half the viewport. Future tasks (#23 send wiring, #24 provider switch,
 * #27 history view) wire interactivity around this; the stream itself
 * stays read-only.
 */
function CommandBarStream() {
  const messages = useChatStore(selectMessages) as ChatMessageType[];
  const pendingProjectSwitch = useChatStore(selectPendingProjectSwitch);
  const pendingAgentSwitch = useChatStore(selectPendingAgentSwitch);
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastCountRef = useRef<number>(messages.length);

  useEffect(() => {
    const region = scrollRef.current;
    if (!region) return;
    // Only scroll on count change — avoids jumping when an in-flight
    // segment updates without growing the message list.
    if (messages.length === lastCountRef.current) return;
    lastCountRef.current = messages.length;

    const behavior: ScrollBehavior = reducedMotion ? "auto" : "smooth";
    if (typeof region.scrollTo === "function") {
      region.scrollTo({ top: region.scrollHeight, behavior });
    } else {
      // Fallback for environments without scrollTo (older jsdom). Setting
      // scrollTop directly is always synchronous and instant.
      region.scrollTop = region.scrollHeight;
    }
    // Always ensure scrollTop reflects the bottom — the spec asserts this
    // and `scrollTo` in jsdom is a no-op without polyfills.
    region.scrollTop = region.scrollHeight;
  }, [messages.length, reducedMotion]);

  const isEmpty =
    messages.length === 0 && !pendingProjectSwitch && !pendingAgentSwitch;

  return (
    <div
      ref={scrollRef}
      data-cmd-stream
      role="log"
      aria-live="polite"
      aria-label="Chat stream"
      className={cn(
        "flex flex-1 flex-col min-h-0",
        "max-h-[50vh] overflow-y-auto",
        "px-4 py-3",
      )}
    >
      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-muted-foreground">No messages yet</p>
        </div>
      ) : (
        <>
          {messages.map((message) => (
            <ChatMessage
              key={message.id ?? `${message.role}-${message.timestamp ?? 0}`}
              message={message}
            />
          ))}
          {/*
           * Provider context-isolation cards (PRD 2026-04-21-ui-refresh, task
           * #117). Mirrors the render condition in `ChatMessageList.tsx` so
           * both shells surface mid-conversation provider/project switches —
           * the silent-context-loss bug from the #113 functional-parity audit.
           *
           * State + resolvers live entirely in `chat-store`; this surface
           * only reads `selectPendingProjectSwitch` / `selectPendingAgentSwitch`
           * and delegates button wiring to the cards themselves (which call
           * `resolveProjectSwitch` / `resolveAgentSwitch` on the store).
           */}
          {pendingProjectSwitch && (
            <ProjectSwitchCard
              newPaths={pendingProjectSwitch.newPaths}
              previousPaths={pendingProjectSwitch.previousPaths}
            />
          )}
          {pendingAgentSwitch && (
            <AgentSwitchCard
              newAgent={pendingAgentSwitch.newAgent}
              previousAgent={pendingAgentSwitch.previousAgent}
            />
          )}
        </>
      )}
    </div>
  );
}

export default CommandBarStream;
