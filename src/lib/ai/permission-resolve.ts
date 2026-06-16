// Shared resolution for tool-call permission requests (PRD
// `2026-06-14-command-bar-session-multitasking`, task #10). Extracted so the
// inline history-row card, the ACP `PermissionCard`, and the direct-API
// `ToolCallPermissionCard` resolve requests through ONE implementation — no
// drift between the in-stream and the history-inline approval forms.

import { invoke } from '@tauri-apps/api/core';
import { log } from '@/lib/logger';
import { usePermissionStore, type PermissionRequest } from '@/stores/permission-store';
import { useChatStore } from '@/stores/chat-store';
import type { PendingToolPermission } from '@/stores/tool-permission-store';

/** The four tiers every tool-call approval surface offers. */
export type ApprovalTier = 'allow' | 'session' | 'always' | 'deny';

// ---------------------------------------------------------------------------
// ACP (permission-store) requests
// ---------------------------------------------------------------------------

/** Approve a single ACP request with its first (affirmative) option. */
function approveAcpRequest(req: PermissionRequest): void {
  const firstOptionId = req.options.length > 0 ? req.options[0].optionId : null;
  invoke('acp_permission_respond', {
    instanceId: req.instanceId,
    requestId: req.requestId,
    optionId: firstOptionId,
  }).catch((err) => log.warn('ai', 'Failed to send permission approval', err));
  usePermissionStore.getState().removeRequest(req.requestId);
}

/**
 * Resolve an ACP permission request at the given tier. Mirrors `PermissionCard`:
 * `session`/`always` persist the tool kind and clear every pending request of
 * that kind; `deny` responds with no option and posts a denial message.
 *
 * @param denyLabel Friendly tool label for the denial chat message.
 */
export function resolveAcpPermission(
  request: PermissionRequest,
  tier: ApprovalTier,
  denyLabel: string,
): void {
  const store = usePermissionStore.getState();
  switch (tier) {
    case 'allow':
      approveAcpRequest(request);
      return;
    case 'session':
      store.allowSession(request.toolKind);
      for (const req of store.requests.filter((r) => r.toolKind === request.toolKind)) {
        approveAcpRequest(req);
      }
      return;
    case 'always':
      store.allowAlways(request.toolKind, null, null);
      for (const req of usePermissionStore.getState().requests.filter((r) => r.toolKind === request.toolKind)) {
        approveAcpRequest(req);
      }
      return;
    case 'deny':
      invoke('acp_permission_respond', {
        instanceId: request.instanceId,
        requestId: request.requestId,
        optionId: null,
      }).catch((err) => log.warn('ai', 'Failed to send permission denial', err));
      useChatStore.getState().addMessage({
        role: 'assistant',
        content: `Tool call "${denyLabel}" was denied.`,
      });
      store.removeRequest(request.requestId);
      return;
  }
}

// ---------------------------------------------------------------------------
// Direct-API (tool-permission-store) requests
// ---------------------------------------------------------------------------

/**
 * Resolve a direct-API tool permission at the given tier. The tier maps 1:1 to
 * the request's `resolve` callback; the session/always PERSISTENCE happens in
 * `useDirectApiChat`'s tool loop off the resolved decision (matching the
 * in-stream card), so this just forwards the decision and clears `pending`.
 */
export function resolveDirectPermission(
  pending: PendingToolPermission,
  tier: ApprovalTier,
): void {
  pending.resolve(tier);
}
