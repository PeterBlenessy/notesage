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
  /**
   * Conversation that owns this request (task #6). Lets the UI attribute the
   * request to its session and drive the foreground-aware auto-deny timeout
   * (task #7). `null`/absent for legacy callers (treated as foreground).
   */
  conversationId?: string | null;
}

export type PermissionTier = 'none' | 'session' | 'always';

/**
 * A scoped approval entry: identifies exactly which tool/skill is approved and
 * under what connection + project scope. `null` in either field means "any"
 * (wildcard), used by the legacy migration bucket and forward-compat slots
 * for callers that don't yet pass real scope values.
 */
export interface ScopedApproval {
  /** For ACP this is `toolKind`; for skills, the skill name; for direct-API, the tool name. */
  toolName: string;
  /** null = any connection (legacy bucket from v1 migration, or scope-less callers). */
  connectionId: string | null;
  /** null = any project. */
  projectRoot: string | null;
  /** ms since epoch; used for the Settings > Privacy > Approvals review UI. */
  grantedAt: number;
  /**
   * SHA-256 of the approved script body, for skill-script approvals only
   * (security audit HIGH #2). When set, the approval is content-pinned: a
   * later query carrying a different hash does NOT match, so a rewritten
   * script body re-prompts instead of silently running under the old "allow
   * always". `null`/absent = unpinned (legacy grants, or non-skill approvals).
   */
  contentHash?: string | null;
}

interface PermissionState {
  /** Pending permission requests awaiting user decision. */
  requests: PermissionRequest[];

  /** Tool kinds allowed for the current session (non-persisted, scope-less). */
  sessionAllowed: Set<string>;

  /** Tool kinds always allowed (persisted across restarts), scoped by connection + project. */
  alwaysAllowed: ScopedApproval[];

  /** Skill names allowed to run scripts for the current session (non-persisted, scope-less). */
  skillScriptSession: Set<string>;

  /** Skill names always allowed to run scripts (persisted), scoped by connection + project. */
  skillScriptAlways: ScopedApproval[];

  /** Network domains allowed for session per connection (non-persisted, scope-less). */
  domainSessionAllowed: Record<string, string[]>;

  /**
   * Network domains always allowed, keyed by `connectionId` then by `projectRoot`
   * bucket. The special key `'global'` holds project-less (wildcard) approvals —
   * that's also where v1 migration lands legacy entries.
   */
  domainAlwaysAllowed: Record<string, Record<string, string[]>>;

  /** Direct-API tool names allowed for the current session (non-persisted, scope-less). */
  toolCallSession: Set<string>;

  /** Direct-API tool names always allowed (persisted), scoped by connection + project. */
  toolCallAlways: ScopedApproval[];

  /**
   * Transient: set by the v1→v2 persist migration, indicating how many legacy
   * unscoped approvals were moved into the (null, null) bucket. Consumed and
   * cleared by `useApprovalMigrationToast`. Not persisted.
   */
  _pendingLegacyToastCount?: number;
}

interface PermissionStore extends PermissionState {
  addRequest: (request: PermissionRequest) => void;
  removeRequest: (requestId: string) => void;
  clearRequestsForInstance: (instanceId: string) => void;
  clearAll: () => void;

  /** Add a tool kind to session allow-list. */
  allowSession: (toolKind: string) => void;

  /** Remove a tool kind from session allow-list. */
  removeSession: (toolKind: string) => void;

  /**
   * Add a tool kind to persistent always-allow list for the given scope.
   * Pass `null` for `connectionId`/`projectRoot` to store a wildcard entry.
   */
  allowAlways: (
    toolKind: string,
    connectionId: string | null,
    projectRoot: string | null,
  ) => void;

  /**
   * Remove an entry from the persistent always-allow list. Uses strict
   * equality on the triple — null args do NOT act as wildcards when removing.
   */
  removeAlways: (
    toolKind: string,
    connectionId: string | null,
    projectRoot: string | null,
  ) => void;

  /**
   * Check if a tool kind is auto-allowed (session or any matching always entry).
   * `null` in either query arg matches any stored scope.
   */
  isAutoAllowed: (
    toolKind: string,
    connectionId: string | null,
    projectRoot: string | null,
  ) => boolean;

  /** Get the current permission tier for a tool kind under a given scope. */
  getToolTier: (
    toolKind: string,
    connectionId: string | null,
    projectRoot: string | null,
  ) => PermissionTier;

  /**
   * Check if a skill is allowed to execute scripts under a given scope.
   *
   * When `contentHash` is supplied, an `always` grant only matches if it was
   * pinned to that exact script body (security audit HIGH #2) — a grant with no
   * pinned hash, or a different hash, does NOT auto-allow, forcing a re-prompt.
   * Omitting `contentHash` preserves the legacy scope-only behaviour.
   */
  isSkillScriptAllowed: (
    skillName: string,
    connectionId: string | null,
    projectRoot: string | null,
    contentHash?: string,
  ) => PermissionTier;

  /** Allow a skill to run scripts for this session. */
  allowSkillScriptSession: (skillName: string) => void;

  /**
   * Always allow a skill to run scripts (persisted) for a given scope,
   * optionally content-pinned to `contentHash` (the SHA-256 of the approved
   * script). Re-granting the same scope replaces any prior hash.
   */
  allowSkillScriptAlways: (
    skillName: string,
    connectionId: string | null,
    projectRoot: string | null,
    contentHash?: string,
  ) => void;

  /** Remove a skill from the persistent always-allow list (strict triple match). */
  removeSkillScriptAlways: (
    skillName: string,
    connectionId: string | null,
    projectRoot: string | null,
  ) => void;

  /**
   * Allow a domain for a connection (session or always). For `always`, the
   * `projectRoot` arg selects the per-project bucket (null → `'global'`).
   * Session tier ignores `projectRoot` (session is transient and scope-less).
   */
  allowDomain: (
    connectionId: string,
    domain: string,
    tier: 'session' | 'always',
    projectRoot?: string | null,
  ) => void;

  /**
   * Remove a domain from a connection's always-allowed list under the
   * given project bucket (null → `'global'`). Also removes from the session
   * list (scope-less).
   */
  removeDomain: (
    connectionId: string,
    domain: string,
    projectRoot?: string | null,
  ) => void;

  /**
   * Check if a domain is allowed for a connection (including built-in,
   * session, `'global'` bucket, and the queried project's bucket).
   */
  isDomainAllowed: (
    connectionId: string,
    domain: string,
    builtIn: string[],
    projectRoot?: string | null,
  ) => boolean;

  /**
   * Get all allowed domains for a connection = session + `'global'` bucket +
   * the queried project's bucket (deduplicated). Excludes built-in.
   */
  getDomainAllowedList: (connectionId: string, projectRoot?: string | null) => string[];

  /** Clear session domains for a connection (e.g., when network sandbox is toggled off). */
  clearDomainSession: (connectionId: string) => void;

  /** Check if a tool is auto-allowed (built-in read-only tools list). */
  isToolAutoAllowed: (toolName: string) => boolean;

  /** Allow a direct-API tool for this session. */
  allowToolSession: (toolName: string) => void;

  /** Always allow a direct-API tool (persisted) for a given scope. */
  allowToolAlways: (
    toolName: string,
    connectionId: string | null,
    projectRoot: string | null,
  ) => void;

  /** Remove a direct-API tool from always-allowed list (strict triple match). */
  removeToolAlways: (
    toolName: string,
    connectionId: string | null,
    projectRoot: string | null,
  ) => void;

  /** Check if a direct-API tool is allowed (auto → always → session → 'none'). */
  isToolAllowed: (
    toolName: string,
    connectionId: string | null,
    projectRoot: string | null,
  ) => PermissionTier;
}

/**
 * Predicate: does a stored `ScopedApproval` match a query triple? `null` in
 * either the stored entry OR the query acts as a wildcard — so a legacy
 * (null, null) bucket matches any query, and a null-null query matches any
 * stored entry with the same toolName.
 */
function matchesScope(
  entry: ScopedApproval,
  toolName: string,
  connectionId: string | null,
  projectRoot: string | null,
): boolean {
  if (entry.toolName !== toolName) return false;
  if (entry.connectionId !== null && connectionId !== null && entry.connectionId !== connectionId) {
    return false;
  }
  if (entry.projectRoot !== null && projectRoot !== null && entry.projectRoot !== projectRoot) {
    return false;
  }
  return true;
}

/**
 * Skill-script matcher: scope must match AND, when a `contentHash` is supplied
 * by the caller, the stored entry must be pinned to that exact hash. An
 * unpinned entry (`contentHash` null/absent) does NOT satisfy a hashed query —
 * that's the content-pin enforcement (security audit HIGH #2). When the caller
 * omits `contentHash`, hashing is ignored (legacy scope-only behaviour).
 */
function matchesSkillScope(
  entry: ScopedApproval,
  skillName: string,
  connectionId: string | null,
  projectRoot: string | null,
  contentHash: string | undefined,
): boolean {
  if (!matchesScope(entry, skillName, connectionId, projectRoot)) return false;
  if (contentHash === undefined) return true;
  return entry.contentHash != null && entry.contentHash === contentHash;
}

function hasExactTriple(
  list: ScopedApproval[],
  toolName: string,
  connectionId: string | null,
  projectRoot: string | null,
): boolean {
  return list.some(
    (a) =>
      a.toolName === toolName &&
      a.connectionId === connectionId &&
      a.projectRoot === projectRoot,
  );
}

function filterExactTriple(
  list: ScopedApproval[],
  toolName: string,
  connectionId: string | null,
  projectRoot: string | null,
): ScopedApproval[] {
  return list.filter(
    (a) =>
      !(
        a.toolName === toolName &&
        a.connectionId === connectionId &&
        a.projectRoot === projectRoot
      ),
  );
}

/**
 * v1 → v2 migration. Exported for direct testing; also wired through the
 * Zustand persist middleware's `migrate` option. Treats anything with
 * `version < 2` as the legacy flat shape: `string[]` for always-allow lists,
 * `Record<connId, string[]>` for domain allowlists. Legacy entries move into
 * the null-null bucket (and `'global'` for domains), and the total count is
 * stashed in `_pendingLegacyToastCount` for the one-time review toast.
 */
export function _migrateLegacyState(persistedState: unknown, version: number): PermissionState {
  if (version >= 2 && persistedState && typeof persistedState === 'object') {
    return persistedState as PermissionState;
  }
  const old = (persistedState && typeof persistedState === 'object'
    ? (persistedState as Record<string, unknown>)
    : {});
  const now = Date.now();
  const toScoped = (names: unknown): ScopedApproval[] =>
    Array.isArray(names)
      ? names
          .filter((n): n is string => typeof n === 'string')
          .map((toolName) => ({
            toolName,
            connectionId: null,
            projectRoot: null,
            grantedAt: now,
          }))
      : [];

  const alwaysAllowed = toScoped(old.alwaysAllowed);
  const skillScriptAlways = toScoped(old.skillScriptAlways);
  const toolCallAlways = toScoped(old.toolCallAlways);

  const oldDomains = (old.domainAlwaysAllowed && typeof old.domainAlwaysAllowed === 'object'
    ? (old.domainAlwaysAllowed as Record<string, unknown>)
    : {});
  const newDomains: Record<string, Record<string, string[]>> = {};
  for (const [connId, value] of Object.entries(oldDomains)) {
    if (Array.isArray(value)) {
      const filtered = value.filter((d): d is string => typeof d === 'string');
      if (filtered.length > 0) {
        newDomains[connId] = { global: filtered };
      }
    } else if (value && typeof value === 'object') {
      // Already-migrated shape encountered at a lower version (shouldn't happen,
      // but be defensive): pass it through.
      const byProj: Record<string, string[]> = {};
      for (const [bucket, list] of Object.entries(value as Record<string, unknown>)) {
        if (Array.isArray(list)) {
          byProj[bucket] = list.filter((d): d is string => typeof d === 'string');
        }
      }
      if (Object.keys(byProj).length > 0) newDomains[connId] = byProj;
    }
  }

  const legacyDomainCount = Object.values(newDomains).reduce(
    (sum, byProj) => sum + (byProj.global?.length ?? 0),
    0,
  );
  const legacyCount =
    alwaysAllowed.length +
    skillScriptAlways.length +
    toolCallAlways.length +
    legacyDomainCount;

  const next: PermissionState = {
    requests: [],
    sessionAllowed: new Set<string>(),
    alwaysAllowed,
    skillScriptSession: new Set<string>(),
    skillScriptAlways,
    domainSessionAllowed: {},
    domainAlwaysAllowed: newDomains,
    toolCallSession: new Set<string>(),
    toolCallAlways,
    _pendingLegacyToastCount: legacyCount > 0 ? legacyCount : undefined,
  };
  return next;
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
      toolCallSession: new Set<string>(),
      toolCallAlways: [],

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

      allowAlways: (toolKind, connectionId, projectRoot) =>
        set((state) => {
          if (hasExactTriple(state.alwaysAllowed, toolKind, connectionId, projectRoot)) {
            return state;
          }
          const entry: ScopedApproval = {
            toolName: toolKind,
            connectionId,
            projectRoot,
            grantedAt: Date.now(),
          };
          return { alwaysAllowed: [...state.alwaysAllowed, entry] };
        }),

      removeAlways: (toolKind, connectionId, projectRoot) =>
        set((state) => ({
          alwaysAllowed: filterExactTriple(
            state.alwaysAllowed,
            toolKind,
            connectionId,
            projectRoot,
          ),
        })),

      isAutoAllowed: (toolKind, connectionId, projectRoot) => {
        const state = get();
        if (state.sessionAllowed.has(toolKind)) return true;
        return state.alwaysAllowed.some((a) =>
          matchesScope(a, toolKind, connectionId, projectRoot),
        );
      },

      getToolTier: (toolKind, connectionId, projectRoot) => {
        const state = get();
        if (
          state.alwaysAllowed.some((a) =>
            matchesScope(a, toolKind, connectionId, projectRoot),
          )
        ) {
          return 'always';
        }
        if (state.sessionAllowed.has(toolKind)) return 'session';
        return 'none';
      },

      isSkillScriptAllowed: (skillName, connectionId, projectRoot, contentHash) => {
        const state = get();
        if (
          state.skillScriptAlways.some((a) =>
            matchesSkillScope(a, skillName, connectionId, projectRoot, contentHash),
          )
        ) {
          return 'always';
        }
        if (state.skillScriptSession.has(skillName)) return 'session';
        return 'none';
      },

      allowSkillScriptSession: (skillName) =>
        set((state) => {
          const next = new Set(state.skillScriptSession);
          next.add(skillName);
          return { skillScriptSession: next };
        }),

      allowSkillScriptAlways: (skillName, connectionId, projectRoot, contentHash) =>
        set((state) => {
          // Re-granting the same scope replaces any prior entry so the pinned
          // hash is updated (and a re-grant after a legitimate edit re-pins).
          const entry: ScopedApproval = {
            toolName: skillName,
            connectionId,
            projectRoot,
            grantedAt: Date.now(),
            contentHash: contentHash ?? null,
          };
          return {
            skillScriptAlways: [
              ...filterExactTriple(state.skillScriptAlways, skillName, connectionId, projectRoot),
              entry,
            ],
          };
        }),

      removeSkillScriptAlways: (skillName, connectionId, projectRoot) =>
        set((state) => ({
          skillScriptAlways: filterExactTriple(
            state.skillScriptAlways,
            skillName,
            connectionId,
            projectRoot,
          ),
        })),

      allowDomain: (connectionId, domain, tier, projectRoot = null) =>
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
          }
          const bucket = projectRoot ?? 'global';
          const connBuckets = state.domainAlwaysAllowed[connectionId] ?? {};
          const current = connBuckets[bucket] ?? [];
          if (current.includes(domain)) return state;
          return {
            domainAlwaysAllowed: {
              ...state.domainAlwaysAllowed,
              [connectionId]: {
                ...connBuckets,
                [bucket]: [...current, domain],
              },
            },
          };
        }),

      removeDomain: (connectionId, domain, projectRoot = null) =>
        set((state) => {
          const bucket = projectRoot ?? 'global';
          const connBuckets = state.domainAlwaysAllowed[connectionId] ?? {};
          const currentAlways = connBuckets[bucket] ?? [];
          const nextAlwaysForBucket = currentAlways.filter((d) => d !== domain);

          const nextConnBuckets: Record<string, string[]> = { ...connBuckets };
          if (nextAlwaysForBucket.length > 0) {
            nextConnBuckets[bucket] = nextAlwaysForBucket;
          } else {
            delete nextConnBuckets[bucket];
          }

          return {
            domainAlwaysAllowed: {
              ...state.domainAlwaysAllowed,
              [connectionId]: nextConnBuckets,
            },
            domainSessionAllowed: {
              ...state.domainSessionAllowed,
              [connectionId]: (state.domainSessionAllowed[connectionId] ?? []).filter(
                (d) => d !== domain,
              ),
            },
          };
        }),

      isDomainAllowed: (connectionId, domain, builtIn, projectRoot = null) => {
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
        const connBuckets = state.domainAlwaysAllowed[connectionId] ?? {};
        const globalBucket = connBuckets.global ?? [];
        const projectBucket = projectRoot ? connBuckets[projectRoot] ?? [] : [];
        return (
          builtIn.some(matchesDomain) ||
          (state.domainSessionAllowed[connectionId] ?? []).some(matchesDomain) ||
          globalBucket.some(matchesDomain) ||
          projectBucket.some(matchesDomain)
        );
      },

      getDomainAllowedList: (connectionId, projectRoot = null) => {
        const state = get();
        const connBuckets = state.domainAlwaysAllowed[connectionId] ?? {};
        const globalBucket = connBuckets.global ?? [];
        const projectBucket = projectRoot ? connBuckets[projectRoot] ?? [] : [];
        const session = state.domainSessionAllowed[connectionId] ?? [];
        // Deduplicate across the three sources while preserving order:
        // session first, then global, then project bucket.
        const seen = new Set<string>();
        const out: string[] = [];
        for (const d of [...session, ...globalBucket, ...projectBucket]) {
          if (seen.has(d)) continue;
          seen.add(d);
          out.push(d);
        }
        return out;
      },

      clearDomainSession: (connectionId) =>
        set((state) => {
          const next = { ...state.domainSessionAllowed };
          delete next[connectionId];
          return { domainSessionAllowed: next };
        }),

      isToolAutoAllowed: (toolName) => {
        return (
          toolName === 'read_file' ||
          toolName === 'read_skill_content' ||
          toolName === 'list_directory' ||
          toolName === 'web_search' ||
          toolName === 'list_comments'
        );
      },

      allowToolSession: (toolName) =>
        set((state) => {
          const next = new Set(state.toolCallSession);
          next.add(toolName);
          return { toolCallSession: next };
        }),

      allowToolAlways: (toolName, connectionId, projectRoot) =>
        set((state) => {
          if (hasExactTriple(state.toolCallAlways, toolName, connectionId, projectRoot)) {
            return state;
          }
          const entry: ScopedApproval = {
            toolName,
            connectionId,
            projectRoot,
            grantedAt: Date.now(),
          };
          return { toolCallAlways: [...state.toolCallAlways, entry] };
        }),

      removeToolAlways: (toolName, connectionId, projectRoot) =>
        set((state) => ({
          toolCallAlways: filterExactTriple(
            state.toolCallAlways,
            toolName,
            connectionId,
            projectRoot,
          ),
        })),

      isToolAllowed: (toolName, connectionId, projectRoot) => {
        const state = get();
        if (state.isToolAutoAllowed(toolName)) return 'always';
        if (
          state.toolCallAlways.some((a) =>
            matchesScope(a, toolName, connectionId, projectRoot),
          )
        ) {
          return 'always';
        }
        if (state.toolCallSession.has(toolName)) return 'session';
        return 'none';
      },
    }),
    {
      name: 'notesage-permissions',
      version: 2,
      migrate: (persistedState: unknown, version: number) =>
        _migrateLegacyState(persistedState, version),

      partialize: (state) => ({
        alwaysAllowed: state.alwaysAllowed,
        skillScriptAlways: state.skillScriptAlways,
        domainAlwaysAllowed: state.domainAlwaysAllowed,
        toolCallAlways: state.toolCallAlways,
      }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Pure selectors (task #6)
// ---------------------------------------------------------------------------

/** ACP permission requests owned by a given conversation. A request with no
 *  `conversationId` (legacy) matches nothing here — callers that need the
 *  unattributed ones read `requests` directly. */
export function pendingForConversation(
  state: Pick<PermissionState, 'requests'>,
  conversationId: string,
): PermissionRequest[] {
  return state.requests.filter((r) => r.conversationId === conversationId);
}
