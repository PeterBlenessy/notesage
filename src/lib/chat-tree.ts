import type { ChatMessage } from '@/lib/ai/types';

/**
 * Walk from a leaf message to the root via parentId, return messages in
 * chronological order (root first). This is the linear thread that AI hooks
 * use for the API call.
 */
export function getThread(messages: ChatMessage[], leafId: string | null | undefined): ChatMessage[] {
  if (!leafId || messages.length === 0) return [];

  // Build id → message lookup
  const byId = new Map<string, ChatMessage>();
  for (const msg of messages) {
    if (msg.id) byId.set(msg.id, msg);
  }

  const leaf = byId.get(leafId);
  if (!leaf) return [];

  // Walk up the tree
  const thread: ChatMessage[] = [];
  let current: ChatMessage | undefined = leaf;
  while (current) {
    thread.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  thread.reverse();
  return thread;
}

/**
 * Resilient variant of {@link getThread}. Walks from the leaf to a root via
 * `parentId`, but detects a CORRUPTED chain — a `parentId` that references a
 * message not present in the list, or a cycle — and, rather than silently
 * returning a truncated (often single-message) thread, falls back to the full
 * message list in chronological order so history is never hidden.
 *
 * This is the safety net for the "history disappears, only the last message is
 * visible" failure: an orphaned `activeLeafId` makes the plain `getThread` stop
 * at the first missing ancestor. A genuine linear/branched conversation always
 * terminates at a real root (`parentId == null`) and reports `broken: false`,
 * so normal branching is unaffected.
 *
 * @returns `{ thread, broken }` — `broken` is true only on real corruption, so
 *   callers can log a diagnostic without firing on healthy conversations.
 */
export function getThreadResilient(
  messages: ChatMessage[],
  leafId: string | null | undefined,
): { thread: ChatMessage[]; broken: boolean } {
  if (messages.length === 0) return { thread: [], broken: false };
  const chronological = () => [...messages].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  // No leaf pointer — legacy/empty conversations show everything.
  if (!leafId) return { thread: chronological(), broken: false };

  const byId = new Map<string, ChatMessage>();
  for (const msg of messages) {
    if (msg.id) byId.set(msg.id, msg);
  }

  const leaf = byId.get(leafId);
  if (!leaf) return { thread: chronological(), broken: true };

  const thread: ChatMessage[] = [];
  const seen = new Set<string>();
  let current: ChatMessage | undefined = leaf;
  let broken = false;
  while (current) {
    if (current.id && seen.has(current.id)) {
      broken = true; // cycle
      break;
    }
    if (current.id) seen.add(current.id);
    thread.push(current);
    const pid = current.parentId;
    if (pid === null || pid === undefined) break; // reached a genuine root
    const parent = byId.get(pid);
    if (!parent) {
      broken = true; // parent referenced but missing → orphaned chain
      break;
    }
    current = parent;
  }

  if (broken) return { thread: chronological(), broken: true };
  thread.reverse();
  return { thread, broken: false };
}

/**
 * Get the direct children of a message (messages whose parentId matches the given id).
 */
export function getChildren(messages: ChatMessage[], parentId: string | null): ChatMessage[] {
  if (parentId === null) {
    // Root children: parentId is null (not undefined — undefined means legacy)
    return messages.filter((m) => m.parentId === null);
  }
  return messages.filter((m) => m.parentId === parentId);
}

/**
 * Get all sibling branches at a branch point. Returns an array of threads,
 * one per child of the given message. Each thread is the path from that child
 * down to its leaf.
 */
export function getBranches(messages: ChatMessage[], messageId: string): ChatMessage[][] {
  const children = getChildren(messages, messageId);
  if (children.length === 0) return [];

  // Build parent→children index
  const childrenIndex = new Map<string, ChatMessage[]>();
  for (const msg of messages) {
    if (msg.parentId) {
      const existing = childrenIndex.get(msg.parentId) ?? [];
      existing.push(msg);
      childrenIndex.set(msg.parentId, existing);
    }
  }

  // For each child of the branch point, collect the full sub-thread
  return children.map((child) => {
    const branch: ChatMessage[] = [child];
    const stack = [child];
    while (stack.length > 0) {
      const node = stack.pop()!;
      const nodeChildren = childrenIndex.get(node.id!) ?? [];
      for (const c of nodeChildren) {
        branch.push(c);
        stack.push(c);
      }
    }
    // Sort by timestamp for chronological order
    branch.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    return branch;
  });
}

/**
 * Get all descendant IDs of a message (the message itself + all children, grandchildren, etc.).
 */
export function getDescendants(messages: ChatMessage[], rootId: string): Set<string> {
  const ids = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    ids.add(current);
    for (const msg of messages) {
      if (msg.parentId === current && msg.id && !ids.has(msg.id)) {
        stack.push(msg.id);
      }
    }
  }
  return ids;
}

/**
 * Get all leaf messages (messages that have no children).
 */
export function getLeaves(messages: ChatMessage[]): ChatMessage[] {
  const hasChildren = new Set<string>();
  for (const msg of messages) {
    if (msg.parentId) {
      hasChildren.add(msg.parentId);
    }
  }
  return messages.filter((m) => m.id && !hasChildren.has(m.id));
}
