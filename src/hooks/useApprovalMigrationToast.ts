import { useEffect } from 'react';
import { toast } from 'sonner';
import { usePermissionStore } from '@/stores/permission-store';

/**
 * One-time toast on app start when the permission-store v1 → v2 migration
 * moved legacy unscoped approvals into the new (connectionId: null,
 * projectRoot: null) bucket. Mirrors the project-data-isolation PRD: users
 * see a signal that they have broad approvals worth reviewing in
 * Settings > Privacy > Approvals (the review UI itself lands in task #3).
 *
 * Idempotent: reads and clears `_pendingLegacyToastCount` on mount. Because
 * the count is excluded from `partialize`, it's only set by the migrate
 * hook at hydration time after an actual v1 → v2 migration, and only fires
 * on the subsequent render.
 */
export function useApprovalMigrationToast(): void {
  useEffect(() => {
    const count = usePermissionStore.getState()._pendingLegacyToastCount;
    if (!count || count <= 0) return;
    toast.info(
      `You have ${count} broad ${count === 1 ? 'approval' : 'approvals'} — review and scope them in Settings`,
      { duration: 10000 },
    );
    usePermissionStore.setState({ _pendingLegacyToastCount: 0 });
  }, []);
}
