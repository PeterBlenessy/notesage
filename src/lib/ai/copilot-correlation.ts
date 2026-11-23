// ---------------------------------------------------------------------------
// Copilot LSP event correlation.
//
// Every Copilot conversation stream (a chat turn, a one-shot `generateText`,
// a background agent task) arrives on the same global `copilot-*` Tauri
// events. Two things tell one stream's events from another's:
//
// - Progress events (`copilot-chat-begin|chunk|thinking|step|tool-update|done`)
//   carry the `token` the caller generated and passed as the request's
//   `workDoneToken`. That is known before the request is sent, so it works
//   for a brand-new conversation, whose id is not known until events arrive.
// - Server requests (`copilot-tool-call`, `copilot-tool-confirmation`,
//   `copilot-context-request`) carry only a `conversationId`. A stream learns
//   its id from its own progress events (the backend emits `begin` first).
//
// An event that names neither is not addressed to any one listener. It used
// to be accepted by ALL of them, so one tool confirmation could show a card
// in chat and be answered by a background task at the same time.
// ---------------------------------------------------------------------------

/** One in-flight Copilot conversation request, as seen by its listener. */
export interface CopilotStream {
  /** Client-generated `workDoneToken`; echoed on every progress event. */
  readonly token: string;
  /** The LSP conversation id, once known. */
  conversationId: string | null;
}

/** Streams whose listeners are currently registered, in this window. */
const activeStreams = new Set<CopilotStream>();

let tokenCounter = 0;

/** Must match `CHAT_TOKEN_PREFIX` in `copilot_protocol.rs`. */
const TOKEN_PREFIX = 'copilot-chat-';

function newToken(): string {
  tokenCounter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${TOKEN_PREFIX}${Date.now()}-${tokenCounter}-${random}`;
}

/**
 * Register a stream BEFORE its listeners are attached. Pass the conversation
 * id for a follow-up turn; leave it out for a new conversation.
 */
export function openCopilotStream(conversationId: string | null = null): CopilotStream {
  const stream: CopilotStream = { token: newToken(), conversationId };
  activeStreams.add(stream);
  return stream;
}

/** Unregister a stream when its listeners are removed. Idempotent. */
export function closeCopilotStream(stream: CopilotStream): void {
  activeStreams.delete(stream);
}

/**
 * Does this progress event belong to `stream`? Matches on the token only, and
 * records the conversation id the first time the stream's own event names it.
 */
export function ownsCopilotProgress(
  stream: CopilotStream,
  payload: { token?: string | null; conversationId?: string | null },
): boolean {
  if (!payload.token || payload.token !== stream.token) return false;
  if (!stream.conversationId && payload.conversationId) {
    stream.conversationId = payload.conversationId;
  }
  return true;
}

/**
 * Does this server request (tool call, confirmation, context request) belong
 * to `stream`? At most one active stream answers `true` for a given event.
 *
 * - Named conversation: the stream bound to that id. A stream that does not
 *   know its id yet claims it only when no other stream could own it.
 * - No conversation named: only when this is the single active stream, so the
 *   event cannot be meant for anyone else.
 */
export function ownsCopilotRequest(
  stream: CopilotStream,
  payload: { conversationId?: string | null },
): boolean {
  if (!activeStreams.has(stream)) return false;
  const id = payload.conversationId;
  if (!id) return activeStreams.size === 1;
  if (stream.conversationId) return stream.conversationId === id;
  for (const other of activeStreams) {
    if (other === stream) continue;
    // Another stream owns it, or could: do not guess.
    if (other.conversationId === id || other.conversationId === null) return false;
  }
  stream.conversationId = id;
  return true;
}

/** Test helper: forget every registered stream. */
export function resetCopilotStreams(): void {
  activeStreams.clear();
}
