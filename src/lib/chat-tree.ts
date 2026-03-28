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
