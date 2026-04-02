import { create } from 'zustand';

export type AgentStatusType = 'unresponsive' | 'exited' | null;

interface AgentStatusStore {
  /** Current agent status issue, or null if healthy */
  status: AgentStatusType;
  /** When the status was set (for elapsed time display) */
  since: number;
  /** Exit code if the agent process exited */
  exitCode: number | null;
  /** Set agent status */
  setStatus: (status: AgentStatusType, exitCode?: number | null) => void;
  /** Clear status (agent resumed or user dismissed) */
  clearStatus: () => void;
}

export const useAgentStatusStore = create<AgentStatusStore>((set) => ({
  status: null,
  since: 0,
  exitCode: null,
  setStatus: (status, exitCode = null) => set({ status, since: Date.now(), exitCode }),
  clearStatus: () => set({ status: null, since: 0, exitCode: null }),
}));
