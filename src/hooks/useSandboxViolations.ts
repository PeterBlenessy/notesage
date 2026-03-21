import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useActivityStore } from '@/stores/activity-store';

interface SandboxViolationPayload {
  instanceId: string;
  agentId: string;
  pid: number;
  operation: string;
  resource: string;
  timestamp: string;
  count: number;
}

/**
 * Listens for sandbox-violation events from the Rust backend and appends
 * them as activity entries to the corresponding agent task in the activity store.
 */
export function useSandboxViolations() {
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<SandboxViolationPayload>('sandbox-violation', (event) => {
      const v = event.payload;

      // Find the task by instanceId pattern match
      // Instance IDs in activity store are set by the spawn caller, which uses
      // the ACP instance_id. Match by substring since task IDs may wrap it.
      const store = useActivityStore.getState();
      const task = store.tasks.find(
        (t) => t.id === v.instanceId || t.id.includes(v.instanceId)
      );

      if (!task) return;

      const countSuffix = v.count > 1 ? ` (x${v.count})` : '';
      const detail = v.resource
        ? `${v.operation} → ${v.resource}${countSuffix}`
        : `${v.operation}${countSuffix}`;

      store.appendActivity(task.id, {
        label: `Sandbox violation: ${v.operation}`,
        detail,
        status: 'error',
        timestamp: Date.now(),
      });
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, []);
}
