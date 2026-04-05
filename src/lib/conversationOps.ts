import type { Conversation } from '@/stores/chat-store';

/**
 * Generate a conversation title from the first line of a message.
 * Truncates to 50 characters with an ellipsis if needed.
 */
export function autoTitle(content: string): string {
  const first = content.split('\n')[0] || content;
  return first.length > 50 ? first.slice(0, 50) + '\u2026' : first;
}

/**
 * Remove the oldest inactive conversations until count <= maxConversations.
 * The active conversation (by ID) is never pruned.
 */
export function pruneConversations(
  conversations: Conversation[],
  activeId: string | null,
  maxConversations: number,
): Conversation[] {
  if (conversations.length <= maxConversations) return conversations;
  // Sort by updatedAt ascending (oldest first) to find prune candidates
  const sorted = [...conversations].sort((a, b) => a.updatedAt - b.updatedAt);
  const toRemove = new Set<string>();
  for (const conv of sorted) {
    if (conversations.length - toRemove.size <= maxConversations) break;
    if (conv.id !== activeId) {
      toRemove.add(conv.id);
    }
  }
  return toRemove.size > 0
    ? conversations.filter((c) => !toRemove.has(c.id))
    : conversations;
}

/**
 * Remove project paths that no longer exist from all conversations.
 * Returns { conversations, changed } where changed indicates whether any
 * conversation was modified.
 */
export function pruneStaleProjectPaths(
  conversations: Conversation[],
  validPaths: Set<string>,
): { conversations: Conversation[]; changed: boolean } {
  let changed = false;
  const updated = conversations.map((c) => {
    const filtered = c.projectPaths.filter((p) => validPaths.has(p));
    if (filtered.length === c.projectPaths.length) return c;
    changed = true;
    return { ...c, projectPaths: filtered };
  });
  return { conversations: updated, changed };
}
