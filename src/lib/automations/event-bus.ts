// Internal workflow/app event bus (Phase 3). A tiny frontend pub/sub for app
// events that workflow-trigger automations subscribe to — there is no such bus
// elsewhere, and these events all originate in the frontend (a save, an agent
// task finishing, a transcription completing). Mirrors src/lib/cmd-bar-events.ts.
//
// PRD: docs/prds/2026-06-28-automations.md (Task #1)

export type WorkflowEvent =
  | { event: 'document-saved'; file: string }
  | { event: 'agent-task-complete'; taskId: string; label?: string; output?: string }
  | { event: 'transcription-done'; transcriptPath?: string };

type Handler = (e: WorkflowEvent) => void;

const handlers = new Set<Handler>();

/** Publish a workflow event to all subscribers (one bad subscriber can't break the rest). */
export function emitWorkflowEvent(e: WorkflowEvent): void {
  for (const h of handlers) {
    try {
      h(e);
    } catch {
      /* swallow — a throwing subscriber must not stop delivery to others */
    }
  }
}

/** Subscribe to workflow events; returns an unsubscribe fn. */
export function onWorkflowEvent(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
