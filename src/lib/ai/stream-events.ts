/**
 * Per-stream event-name helper for direct-API streaming (`ai_chat_stream`).
 *
 * The Rust backend emits `ai-stream-*` / `ai-tool-*` / `ai-citation` events on a
 * GLOBAL event bus. When two direct-API generations overlap in time (e.g. a
 * `generateStructured()` intent-classification call firing while a chat stream
 * is mid-flight, or a background agent task running alongside foreground chat),
 * their chunks land in each other's listeners and corrupt both — garbled chat
 * text and `JSON.parse` failures in the structured caller.
 *
 * The fix: each caller generates a unique `streamId`, passes it to
 * `ai_chat_stream`, and listens on the suffixed event names returned here. The
 * backend mirrors this with its own `stream_event(base, stream_id)` helper. An
 * empty `streamId` yields the legacy global name (back-compat).
 */
export function streamEvent(base: string, streamId: string): string {
  return streamId ? `${base}:${streamId}` : base;
}

/** Generate a fresh stream correlation id. */
export function newStreamId(): string {
  return crypto.randomUUID();
}
