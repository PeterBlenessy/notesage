import { create } from 'zustand';
import { persist } from 'zustand/middleware';


export interface PermissionRequest {
  id: string;
  instanceId: string;
  sessionId: string;
  requestId: string;
  toolKind: string;
  toolTitle: string;
  toolInput: string;
  options: { optionId: string; kind: string; name: string }[];
  timestamp: number;
}

export type PermissionTier = 'none' | 'session' | 'always';

interface PermissionStore {
  /** Pending permission requests awaiting user decision. */
  requests: PermissionRequest[];

  /** Tool kinds allowed for the current session (non-persisted). */
  sessionAllowed: Set<string>;

  /** Tool kinds always allowed (persisted across restarts). */
  alwaysAllowed: string[];

  /** Skill names allowed to run scripts for the current session (non-persisted). */
  skillScriptSession: Set<string>;

  /** Skill names always allowed to run scripts (persisted). */
  skillScriptAlways: string[];

  /** Network domains allowed for session per connection (non-persisted). */
  domainSessionAllowed: Record<string, string[]>;

  /** Network domains always allowed per connection (persisted). */
  domainAlwaysAllowed: Record<string, string[]>;

  addRequest: (request: PermissionRequest) => void;
  removeRequest: (requestId: string) => void;
  clearRequestsForInstance: (instanceId: string) => void;
  clearAll: () => void;

  /** Add a tool kind to session allow-list. */
  allowSession: (toolKind: string) => void;

  /** Remove a tool kind from session allow-list. */
  removeSession: (toolKind: string) => void;

  /** Add a tool kind to persistent always-allow list. */
  allowAlways: (toolKind: string) => void;

  /** Remove a tool kind from persistent always-allow list. */
  removeAlways: (toolKind: string) => void;

  /** Check if a tool kind is auto-allowed (session or always). */
  isAutoAllowed: (toolKind: string) => boolean;

  /** Get the current permission tier for a tool kind. */
  getToolTier: (toolKind: string) => PermissionTier;

  /** Check if a skill is allowed to execute scripts. */
  isSkillScriptAllowed: (skillName: string) => PermissionTier;

  /** Allow a skill to run scripts for this session. */
  allowSkillScriptSession: (skillName: string) => void;

  /** Always allow a skill to run scripts (persisted). */
  allowSkillScriptAlways: (skillName: string) => void;

  /** Remove a skill from the persistent always-allow list. */
  removeSkillScriptAlways: (skillName: string) => void;

  /** Allow a domain for a connection (session or always). */
  allowDomain: (connectionId: string, domain: string, tier: 'session' | 'always') => void;

  /** Remove a domain from a connection's always-allowed list. */
  removeDomain: (connectionId: string, domain: string) => void;

  /** Check if a domain is allowed for a connection (including built-in domains). */
  isDomainAllowed: (connectionId: string, domain: string, builtIn: string[]) => boolean;

  /** Get all allowed domains for a connection (session + always). */
  getDomainAllowedList: (connectionId: string) => string[];

  /** Clear session domains for a connection (e.g., when network sandbox is toggled off). */
  clearDomainSession: (connectionId: string) => void;
}

export const usePermissionStore = create<PermissionStore>()(
  persist(
    (set, get) => ({
      requests: [],
      sessionAllowed: new Set<string>(),
      alwaysAllowed: [],
      skillScriptSession: new Set<string>(),
      skillScriptAlways: [],
      domainSessionAllowed: {},
      domainAlwaysAllowed: {},

      addRequest: (request) =>
        set((state) => ({
          requests: [...state.requests, request],
        })),

      removeRequest: (requestId) =>
        set((state) => ({
          requests: state.requests.filter((r) => r.requestId !== requestId),
        })),

      clearRequestsForInstance: (instanceId) =>
        set((state) => ({
          requests: state.requests.filter((r) => r.instanceId !== instanceId),
        })),

      clearAll: () => set({ requests: [], sessionAllowed: new Set<string>() }),

      allowSession: (toolKind) =>
        set((state) => {
          const next = new Set(state.sessionAllowed);
          next.add(toolKind);
          return { sessionAllowed: next };
        }),

      removeSession: (toolKind) =>
        set((state) => {
          const next = new Set(state.sessionAllowed);
          next.delete(toolKind);
          return { sessionAllowed: next };
        }),

      allowAlways: (toolKind) =>
        set((state) => {
          if (state.alwaysAllowed.includes(toolKind)) return state;
          return { alwaysAllowed: [...state.alwaysAllowed, toolKind] };
        }),

      removeAlways: (toolKind) =>
        set((state) => ({
          alwaysAllowed: state.alwaysAllowed.filter((k) => k !== toolKind),
        })),

      isAutoAllowed: (toolKind) => {
        const state = get();
        return state.sessionAllowed.has(toolKind) || state.alwaysAllowed.includes(toolKind);
      },

      getToolTier: (toolKind) => {
        const state = get();
        if (state.alwaysAllowed.includes(toolKind)) return 'always';
        if (state.sessionAllowed.has(toolKind)) return 'session';
        return 'none';
      },

      isSkillScriptAllowed: (skillName) => {
        const state = get();
        if (state.skillScriptAlways.includes(skillName)) return 'always';
        if (state.skillScriptSession.has(skillName)) return 'session';
        return 'none';
      },

      allowSkillScriptSession: (skillName) =>
        set((state) => {
          const next = new Set(state.skillScriptSession);
          next.add(skillName);
          return { skillScriptSession: next };
        }),

      allowSkillScriptAlways: (skillName) =>
        set((state) => {
          if (state.skillScriptAlways.includes(skillName)) return state;
          return { skillScriptAlways: [...state.skillScriptAlways, skillName] };
        }),

      removeSkillScriptAlways: (skillName) =>
        set((state) => ({
          skillScriptAlways: state.skillScriptAlways.filter((n) => n !== skillName),
        })),

      allowDomain: (connectionId, domain, tier) =>
        set((state) => {
          if (tier === 'session') {
            const current = state.domainSessionAllowed[connectionId] ?? [];
            if (current.includes(domain)) return state;
            return {
              domainSessionAllowed: {
                ...state.domainSessionAllowed,
                [connectionId]: [...current, domain],
              },
            };
          } else {
            const current = state.domainAlwaysAllowed[connectionId] ?? [];
            if (current.includes(domain)) return state;
            return {
              domainAlwaysAllowed: {
                ...state.domainAlwaysAllowed,
                [connectionId]: [...current, domain],
              },
            };
          }
        }),

      removeDomain: (connectionId, domain) =>
        set((state) => ({
          domainAlwaysAllowed: {
            ...state.domainAlwaysAllowed,
            [connectionId]: (state.domainAlwaysAllowed[connectionId] ?? []).filter(
              (d) => d !== domain
            ),
          },
          domainSessionAllowed: {
            ...state.domainSessionAllowed,
            [connectionId]: (state.domainSessionAllowed[connectionId] ?? []).filter(
              (d) => d !== domain
            ),
          },
        })),

      isDomainAllowed: (connectionId, domain, builtIn) => {
        const state = get();
        const lowerDomain = domain.toLowerCase();
        const matchesDomain = (pattern: string) => {
          const p = pattern.toLowerCase();
          if (p.startsWith('*.')) {
            const suffix = p.slice(1); // ".example.com"
            return lowerDomain.endsWith(suffix) && lowerDomain.length > suffix.length;
          }
          return p === lowerDomain;
        };
        return (
          builtIn.some(matchesDomain) ||
          (state.domainSessionAllowed[connectionId] ?? []).some(matchesDomain) ||
          (state.domainAlwaysAllowed[connectionId] ?? []).some(matchesDomain)
        );
      },

      getDomainAllowedList: (connectionId) => {
        const state = get();
        return [
          ...(state.domainSessionAllowed[connectionId] ?? []),
          ...(state.domainAlwaysAllowed[connectionId] ?? []),
        ];
      },

      clearDomainSession: (connectionId) =>
        set((state) => {
          const next = { ...state.domainSessionAllowed };
          delete next[connectionId];
          return { domainSessionAllowed: next };
        }),
    }),
    {
      name: 'notesage-permissions',

      partialize: (state) => ({
        alwaysAllowed: state.alwaysAllowed,
        skillScriptAlways: state.skillScriptAlways,
        domainAlwaysAllowed: state.domainAlwaysAllowed,
      }),
    }
  )
);
