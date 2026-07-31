// Context compaction — summarizing what a trim would otherwise throw away.
//
// `trimMessagesToBudget` keeps a conversation inside the window by deleting the
// oldest complete rounds. That is correct in the sense that the request fits,
// but for an agent it is amnesia: the files it already read, the approach it
// already rejected and the error it already diagnosed all vanish, and it
// happily redoes them.
//
// Compaction replaces deletion with summarization. The rounds that would have
// been dropped are condensed into a single retained note, so the narrative
// survives even though the raw transcript does not.
//
// Two properties are deliberate:
//
//   - Compaction is lossy by 90-99%, and what it loses first is exactly the
//     detail an agent needs: precise paths, exact error text, the decision it
//     made and why. `buildCompactionPrompt` therefore names those categories
//     explicitly rather than asking for a generic summary — the
//     "write-before-compaction" discipline expressed as a prompt.
//   - The final round is never compacted. Compaction firing mid-task is the
//     known failure mode, because it lands exactly when the model is juggling
//     the most fragile context.

import type { ChatMessage } from './types';
import { estimateMessagesTokens, trimMessagesToBudget } from './context-trim';

/** Marker identifying a compaction note, so repeated passes can find prior ones. */
export const COMPACTION_MARKER = '[compacted-context]';

export interface CompactionPlan {
  /** Oldest rounds that no longer fit, to be summarized. Empty when not needed. */
  toCompact: ChatMessage[];
  /** Everything retained verbatim, including the leading system message. */
  toKeep: ChatMessage[];
  /** True when there is something to summarize. */
  needed: boolean;
}

/**
 * Decide what to compact for a given budget.
 *
 * Defers to `trimMessagesToBudget` for the split so compaction and trimming can
 * never disagree about what fits — the difference is only what happens to the
 * remainder.
 */
export function planCompaction(
  messages: ChatMessage[],
  budgetTokens: number,
): CompactionPlan {
  const { messages: kept, dropped } = trimMessagesToBudget(messages, budgetTokens);
  if (dropped === 0) {
    return { toCompact: [], toKeep: messages, needed: false };
  }

  // The trim preserves a leading system message and a suffix of the original
  // list, so what it removed is the slice between them.
  const hasSystem = messages[0]?.role === 'system';
  const head = hasSystem ? 1 : 0;
  const suffixLength = hasSystem ? kept.length - 1 : kept.length;
  const toCompact = messages.slice(head, messages.length - suffixLength);

  return {
    toCompact,
    toKeep: kept,
    // A plan with nothing to summarize is not worth a model round trip.
    needed: toCompact.length > 0,
  };
}

/**
 * Render the rounds being dropped into a summarization request.
 *
 * Asks for the specific categories that generic summarization discards, because
 * those are what make the difference between an agent that resumes and one that
 * starts over.
 */
export function buildCompactionPrompt(toCompact: ChatMessage[]): string {
  const transcript = toCompact
    .map((m) => `${m.role.toUpperCase()}: ${m.content ?? ''}`)
    .join('\n\n');

  return [
    'Summarize the earlier part of this conversation so the assistant can continue working without re-reading it.',
    '',
    'Preserve, as specifically as possible:',
    '- The task or goal being worked on, and any constraints given',
    '- Exact paths of files read or modified, and what changed in each',
    '- Decisions made and the reason for them, including approaches ruled out',
    '- Exact error messages or failures encountered, and whether they were resolved',
    '- Anything still outstanding',
    '',
    'Omit pleasantries and restated instructions. Write compact prose or bullets, not a transcript.',
    '',
    '--- CONVERSATION ---',
    transcript,
  ].join('\n');
}

/**
 * Rebuild the message list with the summary standing in for what was dropped.
 *
 * The note is a `system` message placed directly after any existing system
 * prompt: it is context about the conversation rather than a turn within it, and
 * putting it in the system position keeps it clear of the user/assistant
 * alternation that tool-call pairing depends on.
 */
export function applyCompaction(plan: CompactionPlan, summary: string): ChatMessage[] {
  if (!plan.needed || !summary.trim()) return plan.toKeep;

  const note: ChatMessage = {
    role: 'system',
    content: `${COMPACTION_MARKER} Summary of earlier conversation:\n\n${summary.trim()}`,
    timestamp: Date.now(),
  } as ChatMessage;

  const hasSystem = plan.toKeep[0]?.role === 'system';
  return hasSystem
    ? [plan.toKeep[0], note, ...plan.toKeep.slice(1)]
    : [note, ...plan.toKeep];
}

/** True when a message is a compaction note produced by `applyCompaction`. */
export function isCompactionNote(message: ChatMessage): boolean {
  return message.role === 'system' && (message.content ?? '').startsWith(COMPACTION_MARKER);
}

/**
 * Whether compacting is worth a model round trip at this point.
 *
 * Compaction costs a generation call, so it should not fire for a couple of
 * stale messages. `minRounds` keeps trivial passes from happening; below it the
 * caller should just trim.
 */
export function isCompactionWorthwhile(
  plan: CompactionPlan,
  minTokens = 500,
): boolean {
  return plan.needed && estimateMessagesTokens(plan.toCompact) >= minTokens;
}
